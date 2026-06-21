import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { BrowserRouter, Routes, Route } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import QRLogin from "./pages/QRLogin";
import SsoConsume from "./pages/SsoConsume";
import AdminKnowledge from "./pages/AdminKnowledge";
import NotFound from "./pages/NotFound";
import Welcome from "./pages/Welcome";
import { initAnalytics } from "@/lib/analytics";
import { onFirstInteraction, runWhenIdle } from "@/utils/idle";
import { TenantProvider, useTenant } from "@/contexts/TenantContext";
import { useCachedImage, useCachedImages } from "@/hooks/useCachedImage";
import TenantCodeEntry from "@/components/TenantCodeEntry";

// Kick off silent background analytics AFTER first interaction (or 3.5s idle
// fallback) so it never competes with the boot/render path on weak boxes.
onFirstInteraction(() => { try { initAnalytics(); } catch { /* noop */ } });
runWhenIdle(() => { try { initAnalytics(); } catch { /* noop */ } }, 3500);


const SNOW_BACKGROUND =
  'linear-gradient(45deg, #ffd700 0%, #9370db 20%, #87ceeb 40%, #e5e5e5 60%, #ffa500 80%, #ffd700 100%)';

// Manifest = JSON array of image URLs the tenant wants to rotate through.
function useManifest(url: string | null): string[] {
  const [urls, setUrls] = useState<string[]>(() => {
    if (!url) return [];
    try {
      const raw = localStorage.getItem('smc-bg-manifest:' + url);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr.filter((x) => typeof x === 'string');
      }
    } catch { /* ignore */ }
    return [];
  });

  useEffect(() => {
    if (!url) { setUrls([]); return; }
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data)) {
          const next = data.filter((x) => typeof x === 'string');
          setUrls(next);
          try { localStorage.setItem('smc-bg-manifest:' + url, JSON.stringify(next)); } catch { /* ignore */ }
        }
      } catch { /* offline — keep cached */ }
    };
    load();
    const interval = window.setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [url]);

  return urls;
}

// Renders a tenant-specific background. Priority:
//   1. branding.background_manifest_url → rotate every 25s with cross-fade
//   2. branding.background_image_url     → single full-cover image
//   3. background_style === 'plain'      → neutral dark gradient
//   4. default 'snow'                    → original SMC gradient
const TenantBackground = () => {
  const { branding } = useTenant();
  const singleSrc = useCachedImage(branding.background_image_url);
  const manifestUrls = useManifest(branding.background_manifest_url);
  const rotationSrcs = useCachedImages(manifestUrls);
  const [rotIdx, setRotIdx] = useState(0);

  // Rotate every 25s when we have ≥2 usable images.
  useEffect(() => {
    const usable = rotationSrcs.filter(Boolean).length;
    if (usable < 2) return;
    const id = window.setInterval(() => {
      setRotIdx((i) => (i + 1) % rotationSrcs.length);
    }, 25_000);
    return () => window.clearInterval(id);
  }, [rotationSrcs.length, rotationSrcs.filter(Boolean).length]);

  // Manifest mode
  if (branding.background_manifest_url && rotationSrcs.some(Boolean)) {
    return (
      <div className="fixed inset-0 -z-10 bg-black">
        {rotationSrcs.map((src, i) => (
          <div
            key={i}
            className="absolute inset-0 transition-opacity duration-1000 bg-center bg-cover"
            style={{
              opacity: i === rotIdx && src ? 1 : 0,
              backgroundImage: src ? `url("${src}")` : undefined,
            }}
          />
        ))}
        <div className="absolute inset-0 bg-black/40" />
      </div>
    );
  }

  // Single image mode
  if (branding.background_image_url && singleSrc) {
    return (
      <div className="fixed inset-0 -z-10 bg-black">
        <div
          className="absolute inset-0 bg-center bg-cover"
          style={{ backgroundImage: `url("${singleSrc}")` }}
        />
        <div className="absolute inset-0 bg-black/40" />
      </div>
    );
  }

  // Style modes (snowmedia: 'snow' gradient; others: plain dark)
  const bg = branding.background_style === 'plain'
    ? `linear-gradient(180deg, ${branding.splash_bg || '#0b1220'} 0%, #000000 100%)`
    : SNOW_BACKGROUND;
  return <div className="fixed inset-0 -z-10" style={{ background: bg }} />;
};


const AppShell = () => {
  // NOTE: Android back-button is handled exclusively in `src/hooks/useNavigation.ts`
  // (which scopes back behavior to the current view). Adding a second listener
  // here used to fight that handler and produced extra D-pad/back work that
  // contributed to perceived stutter — leaving it out on purpose.

  useEffect(() => { try { if ((window as any).__SMC_BOOT__) (window as any).__SMC_BOOT__('mounted'); } catch(e){} }, []);

  // Deep link handler — open snowmedia://sso?token=... or https://snowmediaent.com/sso?token=...
  // and route into the in-app /sso consumer page so the magic link signs the user in.
  useEffect(() => {
    let urlListener: any = null;

    const setupUrlListener = async () => {
      urlListener = await CapApp.addListener("appUrlOpen", (event: { url: string }) => {
        try {
          const incoming = new URL(event.url);
          const isSsoScheme = incoming.protocol === "snowmedia:" && incoming.host === "sso";
          const isSsoWeb =
            (incoming.protocol === "https:" || incoming.protocol === "http:") &&
            /(^|\.)snowmediaent\.com$/i.test(incoming.host) &&
            incoming.pathname.startsWith("/sso");

          if (!isSsoScheme && !isSsoWeb) return;

          const target = `/sso${incoming.search}${incoming.hash}`;
          window.history.replaceState(null, "", target);
          window.dispatchEvent(new PopStateEvent("popstate"));
        } catch (err) {
          console.error("[App] Failed to handle deep link:", event.url, err);
        }
      });
    };

    setupUrlListener();

    return () => {
      if (urlListener) urlListener.remove();
    };
  }, []);

  const { needsTenantCode } = useTenant();

  return (
    <TooltipProvider>
      <TenantBackground />
      <div
        data-app-scroll-root
        className="min-h-dvh max-h-dvh overflow-y-auto overscroll-contain"
      >
        <div className="min-h-dvh bg-black/10">
          <Toaster />

          <Sonner />
          {needsTenantCode ? (
            <TenantCodeEntry />
          ) : (
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/qr-login" element={<QRLogin />} />
                <Route path="/sso" element={<SsoConsume />} />
                <Route path="/admin/knowledge" element={<AdminKnowledge />} />
                <Route path="/welcome" element={<Welcome />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
};

const App = () => (
  <TenantProvider>
    <AppShell />
  </TenantProvider>
);

export default App;
