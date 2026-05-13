import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Smartphone, Store, Video, MessageCircle, Sparkles } from 'lucide-react';
import { useVersion } from '@/hooks/useVersion';

/**
 * Per-version "What's New" entries. When a new build ships, add a new entry
 * here keyed by versionName. Users will see it once after upgrading.
 *
 * Keep entries SHORT and user-facing — no internal/code talk.
 */
const CHANGELOG: Record<string, string[]> = {
  '1.0.3': [
    'New Content Bar — now connects directly to your Plex library for movies, shows, and Continue Watching',
    'Live TV events now show only what is actually airing right now (Live TV streaming connection coming soon)',
    'Small fixes and polish to the Buffering Guide',
    'Layout tweaks across the home screen for a cleaner look',
  ],
  '1.0.2': [
    'Added the built-in Speed Test',
    'Added the interactive Buffering Guide in Main Apps',
    'Fine-tuned the Snow Media AI assistant',
  ],
};

const STORAGE_KEY = 'smc-welcome-shown-version';

const WelcomePopup = () => {
  const { version, isLoading } = useVersion();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'first' | 'whatsnew'>('first');

  useEffect(() => {
    if (isLoading) return;
    try {
      const last = localStorage.getItem(STORAGE_KEY);
      if (!last) {
        // First install (or storage cleared)
        setMode('first');
        setOpen(true);
      } else if (last !== version && CHANGELOG[version]) {
        // Updated to a version that has a changelog entry
        setMode('whatsnew');
        setOpen(true);
      }
    } catch {
      // ignore — show nothing if storage is unavailable
    }
  }, [version, isLoading]);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, version);
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  // Auto-focus the primary button so D-pad / Enter dismisses immediately
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-welcome-primary="true"]');
      btn?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [open]);

  // Trap input: arrows keep focus on button, Back/Escape dismisses
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const key = e.key;
      const code = (e as any).keyCode;
      if (key === 'Escape' || key === 'Backspace' || key === 'GoBack' || code === 4 || code === 27) {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
        return;
      }
      if (key === 'Enter' || key === ' ' || code === 13 || code === 23 || code === 66) {
        // Activate the popup button ourselves and stop the event from
        // reaching the underlying page handler (which would also activate
        // the focused card behind the popup).
        e.preventDefault();
        e.stopPropagation();
        dismiss();
        return;
      }
      if (
        key === 'ArrowUp' || key === 'ArrowDown' ||
        key === 'ArrowLeft' || key === 'ArrowRight' ||
        key === 'Tab'
      ) {
        e.preventDefault();
        e.stopPropagation();
        const btn = document.querySelector<HTMLButtonElement>('[data-welcome-primary="true"]');
        btn?.focus();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open]);

  const changelog = useMemo(() => CHANGELOG[version] || [], [version]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/85 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <Card className="w-full max-w-lg bg-gradient-to-br from-blue-900 to-slate-900 border-blue-500/40 p-6 relative shadow-2xl">

        {mode === 'first' ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-6 h-6 text-yellow-300" />
              <h2 className="text-2xl font-bold text-white">Welcome to Snow Media Center</h2>
            </div>
            <p className="text-sm text-white/80 mb-4">
              Here's what each section does:
            </p>
            <ul className="space-y-3 text-sm text-white/95">
              <li className="flex gap-3">
                <Smartphone className="w-5 h-5 mt-0.5 text-cyan-300 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Main Apps</p>
                  <p className="text-white/75">Download all apps pertaining to Snow Media.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <Store className="w-5 h-5 mt-0.5 text-yellow-300 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Store</p>
                  <p className="text-white/75">Takes you to the Snow Media store.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <Video className="w-5 h-5 mt-0.5 text-purple-300 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Support Videos</p>
                  <p className="text-white/75">Step-by-step videos on devices and services.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <MessageCircle className="w-5 h-5 mt-0.5 text-green-300 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Chat &amp; Community</p>
                  <p className="text-white/75">
                    Submit tickets for help or questions — AI chat bot also available.
                  </p>
                </div>
              </li>
            </ul>
            <div className="mt-4 bg-white/5 border border-white/10 rounded-md p-3 text-xs text-white/80">
              Sign in with your <strong>snowmediaent.com</strong> account, or create a new one to
              keep track of purchases and AI credits.
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-6 h-6 text-yellow-300" />
              <h2 className="text-2xl font-bold text-white">What's New in v{version}</h2>
            </div>
            <ul className="space-y-2 text-sm text-white/95 list-disc list-inside">
              {changelog.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-sm italic text-yellow-300/90 font-quicksand">
            Stay Streamin — Stay Dreamin
          </p>
          <Button
            data-welcome-primary="true"
            onClick={dismiss}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-6 focus:ring-4 focus:ring-yellow-300 focus:scale-105 transition-all"
          >
            {mode === 'first' ? "Let's go" : 'Got it'}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default WelcomePopup;
