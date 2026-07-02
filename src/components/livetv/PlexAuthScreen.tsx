import { memo, useEffect } from 'react';
import { Loader2, Tv, AlertTriangle, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlexStatus } from '@/hooks/usePlexAuth';

interface Props {
  status: PlexStatus;
  pinCode: string | null;
  error: string | null;
  onStartLink: () => void;
  onCancel: () => void;
}

const PlexAuthScreen = memo(({ status, pinCode, error, onStartLink, onCancel }: Props) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      if (isBack) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        onCancel();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (status === 'signed-out' || status === 'error') onStartLink();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [status, onStartLink, onCancel]);

  return (
    <div className="min-h-screen flex items-center justify-center p-8 text-white">
      <div className="w-full max-w-lg rounded-3xl bg-slate-900/90 border border-white/10 p-8 text-center shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-brand-gold/20 flex items-center justify-center mx-auto mb-5">
          <Tv className="w-9 h-9 text-brand-gold" />
        </div>

        {(status === 'signed-out') && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">Connect your Plex</h2>
            <p className="text-brand-ice/70 font-nunito mb-6">Sign in to stream Movies &amp; Shows from your own Plex server.</p>
            <Button variant="gold" autoFocus data-focused="true" onClick={onStartLink} className="tv-focusable home-focus-surface px-8">
              <LogIn className="w-4 h-4 mr-2" /> Sign in with Plex
            </Button>
          </>
        )}

        {status === 'linking' && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">Link this device</h2>
            <p className="text-brand-ice/70 font-nunito mb-4">
              On your phone or computer, go to <span className="text-brand-gold font-semibold">plex.tv/link</span> and enter this code:
            </p>
            <div className="text-5xl font-quicksand font-black tracking-[0.3em] text-white bg-black/40 rounded-2xl py-5 mb-4 select-all">
              {pinCode || '····'}
            </div>
            <div className="flex items-center justify-center gap-2 text-brand-ice/70 font-nunito text-sm mb-3">
              <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> Waiting for you to sign in…
            </div>
            <p className="text-brand-ice/50 font-nunito text-xs mb-6 max-w-sm mx-auto">
              Don't have your own Plex account? Send this code to your provider and they'll connect you.
            </p>
            <Button variant="white" autoFocus data-focused="true" onClick={onCancel} className="tv-focusable home-focus-surface px-6">
              Cancel
            </Button>
          </>
        )}

        {status === 'connecting' && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">Connecting…</h2>
            <p className="text-brand-ice/70 font-nunito mb-4">Finding your Plex server.</p>
            <Loader2 className="w-8 h-8 animate-spin text-brand-gold mx-auto" />
          </>
        )}

        {status === 'error' && (
          <>
            <AlertTriangle className="w-10 h-10 text-brand-gold mx-auto mb-3" />
            <h2 className="text-xl font-quicksand font-bold mb-2">Plex connection problem</h2>
            <p className="text-brand-ice/80 font-nunito text-sm mb-6">{error || 'Something went wrong.'}</p>
            <Button variant="gold" autoFocus data-focused="true" onClick={onStartLink} className="tv-focusable home-focus-surface px-8">
              Try again
            </Button>
          </>
        )}
      </div>
    </div>
  );
});

PlexAuthScreen.displayName = 'PlexAuthScreen';
export default PlexAuthScreen;
