import { memo, useEffect, useState } from 'react';
import { Loader2, Tv, AlertTriangle, LogIn, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlexStatus } from '@/hooks/usePlexAuth';

interface Props {
  status: PlexStatus;
  pinCode: string | null;
  error: string | null;
  /** Why the last Live TV → Plex link failed, or null. */
  providerNote?: string | null;
  /** A Live TV line is saved on this box, so Plex can be linked through it. */
  providerAvailable?: boolean;
  onStartLink: () => void;
  onLinkWithProvider?: () => void;
  /** Take the viewer to the Live TV sign-in, the normal way into Plex. */
  onNeedLiveTV?: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onSignOut: () => void;
}

const PlexAuthScreen = memo(({ status, pinCode, error, providerNote = null, providerAvailable = false, onStartLink, onLinkWithProvider, onNeedLiveTV, onCancel, onRetry, onSignOut }: Props) => {
  // Two-button screens: unreachable (0=Retry, 1=Sign out), signed-out with a
  // Live TV line (0=Connect with Live TV, 1=own server code) and signed-out
  // without one (0=Sign into Live TV, 1=own server code).
  const [focusIdx, setFocusIdx] = useState(0);
  const twoButtons = status === 'unreachable' || (status === 'signed-out' && (providerAvailable || !!onNeedLiveTV));

  useEffect(() => { setFocusIdx(0); }, [status, providerAvailable]);

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
      if (twoButtons) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          setFocusIdx((i) => (i === 0 ? 1 : 0));
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          if (status === 'unreachable') { if (focusIdx === 0) onRetry(); else onSignOut(); }
          else if (focusIdx === 0) { if (providerAvailable) onLinkWithProvider?.(); else onNeedLiveTV?.(); }
          else onStartLink();
          return;
        }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (status === 'signed-out' || status === 'error') onStartLink();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [status, focusIdx, twoButtons, providerAvailable, onStartLink, onLinkWithProvider, onNeedLiveTV, onCancel, onRetry, onSignOut]);

  return (
    <div className="min-h-screen flex items-center justify-center p-8 text-white">
      <div className="w-full max-w-lg rounded-3xl bg-slate-900/90 border border-white/10 p-8 text-center shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-brand-gold/20 flex items-center justify-center mx-auto mb-5">
          {status === 'unreachable' ? <WifiOff className="w-9 h-9 text-brand-gold" /> : status === 'error' ? <AlertTriangle className="w-9 h-9 text-brand-gold" /> : <Tv className="w-9 h-9 text-brand-gold" />}
        </div>

        {(status === 'signed-out' && providerAvailable) && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">Connect your Plex</h2>
            <p className="text-brand-ice/80 font-nunito mb-2">
              Plex comes with your Live TV account. Press <span className="text-brand-gold font-semibold">Connect with Live TV</span> and this device links itself. Snow Media members never need a code.
            </p>
            {providerNote ? (
              <p className="text-brand-gold/90 font-nunito text-sm mb-6 max-w-sm mx-auto">{providerNote}</p>
            ) : (
              <p className="text-brand-ice/70 font-nunito text-sm mb-6">
                The second button is only for people who run their own Plex server.
              </p>
            )}
            <div className="flex items-center justify-center gap-3">
              <Button variant="gold" data-focused={focusIdx === 0 ? 'true' : 'false'} onClick={onLinkWithProvider}
                className={`tv-ring tv-ring-contrast relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out ${focusIdx === 0 ? 'scale-105 z-10' : ''}`}>
                <LogIn className="w-4 h-4 mr-2" /> Connect with Live TV
              </Button>
              <Button variant="white" data-focused={focusIdx === 1 ? 'true' : 'false'} onClick={onStartLink}
                className={`tv-ring relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out ${focusIdx === 1 ? 'scale-105 z-10' : ''}`}>
                I run my own Plex server
              </Button>
            </div>
          </>
        )}

        {(status === 'signed-out' && !providerAvailable) && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">Sign into Live TV first</h2>
            <p className="text-brand-ice/80 font-nunito mb-2">
              Plex comes with your Live TV account. Sign into Live TV in the Player, then come back here and Plex connects on its own. Snow Media members never need a code.
            </p>
            <p className="text-brand-ice/70 font-nunito text-sm mb-6">
              The second button is only for people who run their own Plex server.
            </p>
            <div className="flex items-center justify-center gap-3">
              {onNeedLiveTV && (
                <Button variant="gold" data-focused={focusIdx === 0 ? 'true' : 'false'} onClick={onNeedLiveTV}
                  className={`tv-ring tv-ring-contrast relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out ${focusIdx === 0 ? 'scale-105 z-10' : ''}`}>
                  <LogIn className="w-4 h-4 mr-2" /> Sign into Live TV
                </Button>
              )}
              <Button variant={onNeedLiveTV ? 'white' : 'gold'} data-focused={focusIdx === (onNeedLiveTV ? 1 : 0) ? 'true' : 'false'} onClick={onStartLink}
                className={`tv-ring relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out ${onNeedLiveTV ? '' : 'tv-ring-contrast'} ${focusIdx === (onNeedLiveTV ? 1 : 0) ? 'scale-105 z-10' : ''}`}>
                I run my own Plex server
              </Button>
            </div>
          </>
        )}

        {status === 'linking' && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">Link this device</h2>
            <p className="text-brand-ice/70 font-nunito mb-4">
              On your phone or computer, go to <span className="text-brand-gold font-semibold">plex.tv/link</span> and enter this code:
            </p>
            <div className="text-5xl font-quicksand font-black tracking-[0.3em] text-white bg-black/40 rounded-2xl py-6 mb-4 select-all">
              {pinCode || '····'}
            </div>
            <div className="flex items-center justify-center gap-2 text-brand-ice/70 font-nunito text-sm mb-3">
              <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> Waiting for you to sign in…
            </div>
            <p className="text-brand-ice/70 font-nunito text-sm mb-6 max-w-sm mx-auto">
              Enter it signed into the Plex account that owns your server. Codes expire in about 10 minutes.
              <span className="block mt-2 text-brand-gold/90">Snow Media member? You do not need a code. Press Cancel and use Connect with Live TV.</span>
            </p>
            <Button variant="white" autoFocus data-focused="true" onClick={onCancel} className="tv-ring relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out scale-105 z-10">
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

        {status === 'unreachable' && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">Can't reach your Plex server</h2>
            <p className="text-brand-ice/80 font-nunito text-sm mb-4">{error || 'Your Plex server did not respond.'}</p>
            <p className="text-brand-ice/70 font-nunito text-sm mb-6 max-w-sm mx-auto">
              Wrong account? If you signed in with your personal Plex account by mistake, sign out and choose Connect with Live TV instead.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button variant="gold" data-focused={focusIdx === 0 ? 'true' : 'false'} onClick={onRetry}
                className={`tv-ring tv-ring-contrast relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out ${focusIdx === 0 ? 'scale-105 z-10' : ''}`}>
                Retry connection
              </Button>
              <Button variant="white" data-focused={focusIdx === 1 ? 'true' : 'false'} onClick={onSignOut}
                className={`tv-ring relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out ${focusIdx === 1 ? 'scale-105 z-10' : ''}`}>
                Sign out of Plex
              </Button>
            </div>
          </>
        )}

        {status === 'error' && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">Plex connection problem</h2>
            <p className="text-brand-ice/80 font-nunito text-sm mb-6">{error || 'Something went wrong.'}</p>
            <Button variant="gold" autoFocus data-focused="true" onClick={onStartLink} className="tv-ring tv-ring-contrast relative h-12 rounded-xl px-8 transition-transform duration-150 ease-out scale-105 z-10">
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
