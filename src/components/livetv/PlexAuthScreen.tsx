import { memo, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Loader2, Tv, AlertTriangle, LogIn, WifiOff, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PlexStatus } from '@/hooks/usePlexAuth';
import { kidsLevel } from '@/lib/kidsFilter';

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
  // A Kids profile gets one button on each: it signs nothing in or out (no
  // own-server code, no Sign out of Plex, no way to the Live TV sign-in).
  // Only the household's line links Plex, as it does on its own.
  const { t } = useTranslation();
  const kids = !!kidsLevel();
  const [focusIdx, setFocusIdx] = useState(0);
  const isSignedOut = status === 'signed-out';
  const isLinking = status === 'linking';
  const isConnecting = status === 'connecting';
  const isUnreachable = status === 'unreachable';
  const isError = status === 'error';
  const twoButtons = !kids && (status === 'unreachable' || (status === 'signed-out' && (providerAvailable || !!onNeedLiveTV)));

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
        if (kids) {
          if (status === 'signed-out') { if (providerAvailable) onLinkWithProvider?.(); else onCancel(); }
          else if (status === 'unreachable' || status === 'error') onRetry();
          return;
        }
        if (status === 'signed-out' || status === 'error') onStartLink();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [kids, status, focusIdx, twoButtons, providerAvailable, onStartLink, onLinkWithProvider, onNeedLiveTV, onCancel, onRetry, onSignOut]);

  return (
    <div className="min-h-screen flex items-center justify-center p-8 text-white">
      <div className="w-full max-w-lg rounded-3xl bg-slate-900/90 border border-white/10 p-8 text-center shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-brand-gold/20 flex items-center justify-center mx-auto mb-5">
          {isUnreachable ? <WifiOff className="w-9 h-9 text-brand-gold" /> : isError ? <AlertTriangle className="w-9 h-9 text-brand-gold" /> : <Tv className="w-9 h-9 text-brand-gold" />}
        </div>

        {(isSignedOut && providerAvailable) && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">{t('plex.auth.connectTitle')}</h2>
            <p className={`text-brand-ice/80 font-nunito ${kids && !providerNote ? 'mb-6' : 'mb-2'}`}>
              <Trans i18nKey="plex.auth.connectBody" components={{ 1: <span className="text-brand-gold font-semibold" /> }} />
            </p>
            {providerNote ? (
              <p className="text-brand-gold/90 font-nunito text-sm mb-6 max-w-sm mx-auto">{providerNote}</p>
            ) : kids ? null : (
              <p className="text-brand-ice/70 font-nunito text-sm mb-6">
                {t('plex.auth.secondButtonNote')}
              </p>
            )}
            <div className="flex items-center justify-center gap-3">
              <Button variant="gold" data-focused={focusIdx === 0 ? 'true' : 'false'} onClick={onLinkWithProvider}
                className={`tv-ring tv-ring-contrast relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out ${focusIdx === 0 ? 'scale-105 z-10' : ''}`}>
                <LogIn className="w-4 h-4 mr-2 shrink-0" /> <span className="min-w-0 truncate">{t('plex.auth.connectBtn')}</span>
              </Button>
              {!kids && (
                <Button variant="white" data-focused={focusIdx === 1 ? 'true' : 'false'} onClick={onStartLink}
                  className={`tv-ring relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out ${focusIdx === 1 ? 'scale-105 z-10' : ''}`}>
                  <span className="min-w-0 truncate">{t('plex.auth.ownServerBtn')}</span>
                </Button>
              )}
            </div>
          </>
        )}

        {/* Kids, no line on the box: who to ask, and Back. */}
        {(isSignedOut && !providerAvailable && kids) && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">{t('plex.auth.kidsTitle')}</h2>
            <p className="text-brand-ice/80 font-nunito mb-6">
              {t('plex.auth.kidsBody')}
            </p>
            <Button variant="gold" data-focused="true" onClick={onCancel}
              className="tv-ring tv-ring-contrast relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out scale-105 z-10">
              <ArrowLeft className="w-4 h-4 mr-2 shrink-0" /> <span className="min-w-0 truncate">{t('common.back')}</span>
            </Button>
          </>
        )}

        {(isSignedOut && !providerAvailable && !kids) && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">{t('plex.auth.signInFirstTitle')}</h2>
            <p className="text-brand-ice/80 font-nunito mb-2">
              {t('plex.auth.signInFirstBody')}
            </p>
            <p className="text-brand-ice/70 font-nunito text-sm mb-6">
              {t('plex.auth.secondButtonNote')}
            </p>
            <div className="flex items-center justify-center gap-3">
              {onNeedLiveTV && (
                <Button variant="gold" data-focused={focusIdx === 0 ? 'true' : 'false'} onClick={onNeedLiveTV}
                  className={`tv-ring tv-ring-contrast relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out ${focusIdx === 0 ? 'scale-105 z-10' : ''}`}>
                  <LogIn className="w-4 h-4 mr-2 shrink-0" /> <span className="min-w-0 truncate">{t('plex.auth.signInLiveTvBtn')}</span>
                </Button>
              )}
              <Button variant={onNeedLiveTV ? 'white' : 'gold'} data-focused={focusIdx === (onNeedLiveTV ? 1 : 0) ? 'true' : 'false'} onClick={onStartLink}
                className={`tv-ring relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out ${onNeedLiveTV ? '' : 'tv-ring-contrast'} ${focusIdx === (onNeedLiveTV ? 1 : 0) ? 'scale-105 z-10' : ''}`}>
                <span className="min-w-0 truncate">{t('plex.auth.ownServerBtn')}</span>
              </Button>
            </div>
          </>
        )}

        {isLinking && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">{t('plex.auth.linkTitle')}</h2>
            <p className="text-brand-ice/70 font-nunito mb-4">
              <Trans i18nKey="plex.auth.linkBody" components={{ 1: <span className="text-brand-gold font-semibold" /> }} />
            </p>
            <div className="text-5xl font-quicksand font-black tracking-[0.3em] text-white bg-black/40 rounded-2xl py-6 mb-4 select-all">
              {pinCode || '····'}
            </div>
            <div className="flex items-center justify-center gap-2 text-brand-ice/70 font-nunito text-sm mb-3">
              <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> {t('plex.auth.waiting')}
            </div>
            <p className="text-brand-ice/70 font-nunito text-sm mb-6 max-w-sm mx-auto">
              {t('plex.auth.linkNote')}
              <span className="block mt-2 text-brand-gold/90">{t('plex.auth.memberNote')}</span>
            </p>
            <Button variant="white" autoFocus data-focused="true" onClick={onCancel} className="tv-ring relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out scale-105 z-10">
              {t('common.cancel')}
            </Button>
          </>
        )}

        {isConnecting && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">{t('plex.auth.connectingTitle')}</h2>
            <p className="text-brand-ice/70 font-nunito mb-4">{t('plex.auth.connectingBody')}</p>
            <Loader2 className="w-8 h-8 animate-spin text-brand-gold mx-auto" />
          </>
        )}

        {isUnreachable && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">{t('plex.auth.unreachableTitle')}</h2>
            <p className={`text-brand-ice/80 font-nunito text-sm ${kids ? 'mb-6' : 'mb-4'}`}>{error || t('plex.auth.unreachableFallback')}</p>
            {!kids && (
              <p className="text-brand-ice/70 font-nunito text-sm mb-6 max-w-sm mx-auto">
                {t('plex.auth.wrongAccount')}
              </p>
            )}
            <div className="flex items-center justify-center gap-3">
              <Button variant="gold" data-focused={focusIdx === 0 ? 'true' : 'false'} onClick={onRetry}
                className={`tv-ring tv-ring-contrast relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out ${focusIdx === 0 ? 'scale-105 z-10' : ''}`}>
                <span className="min-w-0 truncate">{t('plex.auth.retryBtn')}</span>
              </Button>
              {!kids && (
                <Button variant="white" data-focused={focusIdx === 1 ? 'true' : 'false'} onClick={onSignOut}
                  className={`tv-ring relative h-12 rounded-xl px-6 transition-transform duration-150 ease-out ${focusIdx === 1 ? 'scale-105 z-10' : ''}`}>
                  <span className="min-w-0 truncate">{t('plex.auth.signOutBtn')}</span>
                </Button>
              )}
            </div>
          </>
        )}

        {isError && (
          <>
            <h2 className="text-2xl font-quicksand font-bold mb-2">{t('plex.auth.errorTitle')}</h2>
            <p className="text-brand-ice/80 font-nunito text-sm mb-6">{error || t('plex.auth.errorFallback')}</p>
            <Button variant="gold" autoFocus data-focused="true" onClick={kids ? onRetry : onStartLink} className="tv-ring tv-ring-contrast relative h-12 rounded-xl px-8 transition-transform duration-150 ease-out scale-105 z-10">
              {t('common.tryAgain')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
});

PlexAuthScreen.displayName = 'PlexAuthScreen';
export default PlexAuthScreen;
