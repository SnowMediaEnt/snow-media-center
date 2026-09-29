import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Browser } from '@capacitor/browser';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2, ExternalLink, ArrowLeft, KeyRound } from 'lucide-react';
import { useTVFocus } from '@/hooks/useTVFocus';
import { BTN, BTN_GOLD, CARD, SCREEN } from '@/components/billing/shared';
import { focusAttrs, scaleIf, useFocusRecovery } from '@/components/billing/shared';
import type { SignupLink } from '@/lib/signupLinks';
import { linkLabel } from '@/lib/signupLinks';
import { writePending } from './pending';
import { tierLabel } from './tierText';

interface Props {
  link: SignupLink;
  /** The viewer says they have their emailed login and wants to type it in. */
  onHaveLogin: () => void;
  onBack: () => void;
}

const QR_OPTS = { width: 360, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } };

/**
 * Hand the customer to a Vibez page and let them come back.
 *
 * There is nothing to poll: the panel has no API, so the TV can never learn
 * that a payment happened. Two consequences shape this screen.
 *
 * First, progress is NEVER gated on `browserFinished`. On a Fire TV with no
 * browser no Custom Tab is ever opened, so that event never fires — a screen
 * waiting for it would hang forever. "I have my login" is focusable from the
 * first frame, on every branch.
 *
 * Second, everything is shown at once — the QR, the raw URL as selectable
 * text, and the buttons — rather than switching on a detected capability. A
 * detection that guesses wrong on one device model would otherwise leave that
 * device with no way through. The URL in text is the last resort when even the
 * QR fails to render, and the only way an operator can read back a changed
 * panel account number from the couch.
 */
const VibezHandoff = memo(({ link, onHaveLogin, onBack }: Props) => {
  const { t } = useTranslation();
  const [qr, setQr] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const openedRef = useRef(false);
  const mountedRef = useRef(true);

  const { containerRef, currentFocusId, focusById } = useTVFocus({
    initialFocusId: 'vh-continue',
    onBack,
    scrollBlock: 'center',
  });
  useFocusRecovery(containerRef, currentFocusId, focusById, 'vh-continue');

  const open = useCallback(async () => {
    setOpening(true);
    try {
      await Browser.open({ url: link.url, presentationStyle: 'fullscreen' });
    } catch {
      // No browser on this device (common on Fire TV). The QR and the printed
      // URL are already on screen, so there is nothing to recover from.
    } finally {
      if (mountedRef.current) setOpening(false);
    }
  }, [link.url]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Record the hand-off, but do NOT launch a browser. Opening one on mount
  // threw Fire TV viewers into Silk the instant they picked a package, over
  // the top of the app and with no way back to the QR. The phone is the
  // intended path; "Open on this TV" is there for anyone who wants it.
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    writePending({ linkId: link.id, label: linkLabel(link), url: link.url });
  }, [link]);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(link.url, QR_OPTS)
      .then((d) => { if (!cancelled) setQr(d); })
      .catch(() => { /* the printed URL below still works */ });
    return () => { cancelled = true; };
  }, [link.url]);

  return (
    <div ref={containerRef} className={SCREEN}>
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className={`${CARD} w-full max-w-4xl p-8`}>
          <h2 className="text-2xl font-quicksand font-bold text-white">{t('getStarted.handoff.title')}</h2>
          <p className="text-brand-ice/80 font-nunito mt-1">
            {t('getStarted.handoff.intro', { label: tierLabel(link) })}
          </p>

          <div className="mt-6 flex flex-col md:flex-row gap-6 items-center">
            <div className="bg-white p-3 rounded-xl shadow-lg shrink-0">
              {qr ? (
                <img src={qr} alt={t('getStarted.handoff.qrAlt')} className="w-[min(42vh,13rem)] h-[min(42vh,13rem)]" />
              ) : (
                <div className="w-[min(42vh,13rem)] h-[min(42vh,13rem)] flex items-center justify-center">
                  <Loader2 className="w-10 h-10 text-slate-700 animate-spin" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs uppercase tracking-wide text-white/60 mb-1">{t('getStarted.handoff.orType')}</div>
              <div className="text-sm text-white font-mono break-all rounded-xl bg-black/30 border border-white/10 px-4 py-3">
                {link.url}
              </div>
              <p className="text-brand-ice/60 text-xs font-nunito mt-3">
                {t('getStarted.handoff.nothingChanges')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mt-8">
            <Button variant="gold" onClick={onHaveLogin}
              className={`${BTN_GOLD} ${scaleIf(currentFocusId, 'vh-continue')}`} {...focusAttrs(currentFocusId, 'vh-continue')}>
              <KeyRound className="w-4 h-4 mr-2 shrink-0" />
              <span className="min-w-0 truncate">{t('getStarted.handoff.haveLoginBtn')}</span>
            </Button>
            <Button variant="white" disabled={opening} onClick={() => { void open(); }}
              className={`${BTN} ${scaleIf(currentFocusId, 'vh-open')}`} {...focusAttrs(currentFocusId, 'vh-open')}>
              {opening ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ExternalLink className="w-4 h-4 mr-2" />}
              <span className="min-w-0 truncate">{t('getStarted.handoff.openBtn')}</span>
            </Button>
            <Button variant="white" onClick={onBack}
              className={`${BTN} ${scaleIf(currentFocusId, 'vh-back')}`} {...focusAttrs(currentFocusId, 'vh-back')}>
              <ArrowLeft className="w-4 h-4 mr-2" /> {t('common.back')}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
});

VibezHandoff.displayName = 'VibezHandoff';
export default VibezHandoff;
