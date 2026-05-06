import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { App as CapApp } from "@capacitor/app";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import QRLogin from "./pages/QRLogin";
import SsoConsume from "./pages/SsoConsume";
import AdminKnowledge from "./pages/AdminKnowledge";
import NotFound from "./pages/NotFound";
import Welcome from "./pages/Welcome";
import { useDynamicBackground } from "@/hooks/useDynamicBackground";

const queryClient = new QueryClient();

const App = () => {
  const { backgroundUrl } = useDynamicBackground();

  // NOTE: Android back-button is handled exclusively in `src/hooks/useNavigation.ts`
  // (which scopes back behavior to the current view). Adding a second listener
  // here used to fight that handler and produced extra D-pad/back work that
  // contributed to perceived stutter — leaving it out on purpose.

  // Deep link handler — open snowmedia://sso?token=... or https://snowmediaent.com/sso?token=...
  // and route into the in-app /sso consumer page so the magic link signs the user in.
  useEffect(() => {
    let urlListener: any = null;

    const setupUrlListener = async () => {
      urlListener = await CapApp.addListener("appUrlOpen", (event: { url: string }) => {
        try {
          const incoming = new URL(event.url);
          // Match either snowmedia://sso/... OR https://(www.)snowmediaent.com/sso...
          const isSsoScheme = incoming.protocol === "snowmedia:" && incoming.host === "sso";
          const isSsoWeb =
            (incoming.protocol === "https:" || incoming.protocol === "http:") &&
            /(^|\.)snowmediaent\.com$/i.test(incoming.host) &&
            incoming.pathname.startsWith("/sso");

          if (!isSsoScheme && !isSsoWeb) return;

          // Preserve search + hash (Supabase puts tokens in either)
          const target = `/sso${incoming.search}${incoming.hash}`;
          window.history.replaceState(null, "", target);
          // Force a soft reload of the route
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
  
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div 
          data-app-scroll-root
          className="min-h-dvh max-h-dvh overflow-y-auto overscroll-contain"
          style={backgroundUrl ? {
            backgroundImage: `url(${backgroundUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundAttachment: 'fixed'
          } : {
            background: 'linear-gradient(45deg, #ffd700 0%, #9370db 20%, #87ceeb 40%, #e5e5e5 60%, #ffa500 80%, #ffd700 100%)'
          }}
        >
          <div className="min-h-dvh bg-black/20">
            <Toaster />
            <Sonner />
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
          </div>
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;
