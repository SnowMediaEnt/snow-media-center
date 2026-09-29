import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { Browser } from '@capacitor/browser';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2, CheckCircle2, XCircle, RefreshCw, ExternalLink, ArrowLeft } from 'lucide-react';
import { useTVFocus } from '@/hooks/useTVFocus';
import { SmcBilling, type BillingInvoice } from '@/capacitor/SmcBilling';
import { toBillingError, formatMoney } from '@/lib/billing';
import { BTN, BTN_GOLD, CARD, SCREEN, focusAttrs, scaleIf, useBillingErrorHandler, useFocusRecovery } from './shared';

interface Props {
  invoiceId: number;
  /**
   * The one-time pay_url that came back with the renew/order call. It is
   * opened the moment this mounts and never kept; when it is null (resuming a
   * pending invoice) a fresh one is minted.
   */
  initialUrl: string | null;
  amount: number | null;
  currency: string;
  title: string;
  onPaid: (invoice: BillingInvoice) => void;
  /** The invoice stays pending; the viewer can come back to it later. */
  onClose: () => void;
  onAuthLost: () => void;
}

type Phase = 'opening' | 'tab' | 'qr' | 'waiting' | 'paid' | 'closed' | 'timeout' | 'error';

const QR_OPTS = { width: 360, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } };

/**
 * The payment step for RENEW, Finish payment and Buy a plan.
 *
 * On a device with a browser the pay_url opens in a Chrome Custom Tab (saved
 * PayPal / card sessions work there; a WebView would lose them). When the tab
 * closes the invoice is polled every 3 s for up to 2 minutes. Fire TV usually
 * has no browser at all, so there the same link is shown as a QR code for
 * the viewer's phone and the poll starts straight away.
 *
 * pay_url is one-time: it is used once, here, immediately. "Open again"
 * mints a new one.
 */
const PaymentSheet = memo(({ invoiceId, initialUrl, amount, currency, title, onPaid, onClose, onAuthLost }: Props) => {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('opening');
  const [qr, setQr] = useState<string | null>(null);
  // A translation key, not text: it is looked up when drawn, so it follows the language.
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollId = useRef(`invoice:${invoiceId}:${Date.now()}`).current;
  const mountedRef = useRef(true);
  const openedRef = useRef(false);
  const handleError = useBillingErrorHandler({ onAuthLost });
  const onPaidRef = useRef(onPaid);
  useEffect(() => { onPaidRef.current = onPaid; }, [onPaid]);

  const { containerRef, currentFocusId, focusById } = useTVFocus({
    initialFocusId: 'pay-check',
    onBack: () => { if (!busy) onClose(); },
    scrollBlock: 'center',
  });
  useFocusRecovery(containerRef, currentFocusId, focusById, 'pay-cancel');

  /** Poll until paid/closed/timeout. Safe to call again after a timeout. */
  const startPoll = useCallback(async () => {
    setPhase('waiting');
    setMessage(null);
    try {
      const r = await SmcBilling.pollInvoice({ invoiceId, pollId });
      if (!mountedRef.current) return;
      if (r.outcome === 'paid' && r.invoice) {
        setPhase('paid');
        onPaidRef.current(r.invoice);
      } else if (r.outcome === 'closed') {
        setPhase('closed');
        setMessage('billing.pay.invoiceCancelled');
      } else if (r.outcome === 'timeout') {
        setPhase('timeout');
        setMessage('billing.pay.noPaymentYet');
      }
      // cancelled: the sheet is closing; say nothing.
    } catch (e) {
      if (!mountedRef.current) return;
      const err = handleError(e, t('billing.pay.checkFailedTitle'));
      if (!err.isAuthError) { setPhase('error'); setMessage('billing.pay.checkFailed'); }
    }
  }, [invoiceId, pollId, handleError, t]);

  /** Open (Custom Tab) or show (QR) a link; then arrange for polling. */
  const present = useCallback(async (url: string) => {
    let canOpen = false;
    try { canOpen = (await SmcBilling.canOpenUrl({ url })).available; } catch { canOpen = false; }
    if (canOpen) {
      try {
        await Browser.open({ url, presentationStyle: 'fullscreen' });
        if (!mountedRef.current) return;
        setPhase('tab');
        setMessage('billing.pay.finishInWindow');
        return;
      } catch {
        // The browser refused after all: fall through to the QR.
      }
    }
    try {
      const data = await QRCode.toDataURL(url, QR_OPTS);
      if (!mountedRef.current) return;
      setQr(data);
    } catch { /* QR failed: the poll still runs and the buttons still work */ }
    setPhase('qr');
    void startPoll();
  }, [startPoll]);

  const mint = useCallback(async (): Promise<string | null> => {
    try {
      const r = await SmcBilling.payUrl({ invoiceId });
      return r.pay_url;
    } catch (e) {
      const err = toBillingError(e);
      if (err.code === 'invoice_not_payable') {
        // Already paid, or cancelled. Ask the invoice which.
        try {
          const inv = await SmcBilling.invoice({ invoiceId });
          if (inv.status === 'paid') { setPhase('paid'); onPaidRef.current(inv); return null; }
        } catch { /* fall through */ }
        setPhase('closed');
        setMessage('billing.pay.notPayable');
        return null;
      }
      const info = handleError(e, t('billing.pay.openFailedTitle'));
      if (!info.isAuthError) { setPhase('error'); setMessage('billing.pay.openFailed'); }
      return null;
    }
  }, [invoiceId, handleError, t]);

  // Open immediately on mount — once. StrictMode double-mounts in dev only.
  useEffect(() => {
    mountedRef.current = true;
    if (openedRef.current) return;
    openedRef.current = true;
    (async () => {
      const url = initialUrl ?? (await mint());
      if (url && mountedRef.current) await present(url);
    })();
    return () => { mountedRef.current = false; };
  }, [initialUrl, mint, present]);

  // The Custom Tab closed: now poll.
  useEffect(() => {
    let handle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;
    Browser.addListener('browserFinished', () => {
      if (cancelled || !mountedRef.current) return;
      void startPoll();
    }).then((h) => { if (cancelled) void h.remove(); else handle = h; }).catch(() => undefined);
    return () => {
      cancelled = true;
      if (handle) void handle.remove();
    };
  }, [startPoll]);

  // Leaving the sheet stops the native poll.
  useEffect(() => () => { void SmcBilling.cancelPoll({ pollId }); }, [pollId]);

  const reopen = async () => {
    if (busy) return;
    setBusy(true);
    try {
      void SmcBilling.cancelPoll({ pollId });
      const url = await mint();
      if (url) await present(url);
    } finally {
      setBusy(false);
    }
  };

  const check = () => {
    if (busy || phase === 'waiting') return;
    void startPoll();
  };

  const close = () => {
    void SmcBilling.cancelPoll({ pollId });
    onClose();
  };

  const waiting = phase === 'waiting' || phase === 'opening';
  const done = phase === 'paid' || phase === 'closed';

  return (
    <div ref={containerRef} className={SCREEN}>
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className={`${CARD} w-full max-w-3xl p-8`}>
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <h2 className="text-2xl font-quicksand font-bold text-white">{title}</h2>
              <p className="text-brand-ice/80 font-nunito mt-1">
                <Trans i18nKey="billing.pay.invoiceAmount" values={{ id: invoiceId, amount: formatMoney(amount, currency) }} components={[<span key="amount" className="font-semibold text-white" />]} />
              </p>
            </div>
            {phase === 'paid' ? <CheckCircle2 className="w-10 h-10 text-emerald-400 shrink-0" /> : null}
            {(phase === 'closed' || phase === 'error') ? <XCircle className="w-10 h-10 text-red-400 shrink-0" /> : null}
          </div>

          <div className="mt-6 flex flex-col md:flex-row gap-6 items-center">
            {phase === 'qr' || (qr && !done) ? (
              <div className="bg-white p-3 rounded-xl shadow-lg shrink-0">
                {qr ? (
                  <img src={qr} alt={t('billing.pay.qrAlt')} className="w-[min(45vh,14rem)] h-[min(45vh,14rem)]" />
                ) : (
                  <div className="w-[min(45vh,14rem)] h-[min(45vh,14rem)] flex items-center justify-center">
                    <Loader2 className="w-10 h-10 text-slate-700 animate-spin" />
                  </div>
                )}
              </div>
            ) : null}
            <div className="flex-1 min-w-0 space-y-3">
              {qr && !done && (
                <p className="text-white font-nunito">
                  {t('billing.pay.scanToPay')}
                </p>
              )}
              {phase === 'opening' ? <p className="text-brand-ice/90 font-nunito">{t('billing.pay.opening')}</p> : null}
              {phase === 'paid' ? <p className="text-emerald-200 font-nunito text-lg">{t('billing.pay.received')}</p> : null}
              {message && <p className="text-brand-ice/90 font-nunito">{t(message)}</p>}
              {waiting && phase !== 'opening' ? (
                <div className="flex items-center gap-3 text-brand-ice/90 font-nunito text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />
                  <span>{t('billing.pay.waiting')}</span>
                </div>
              ) : null}
              {phase === 'tab' ? (
                <div className="flex items-center gap-3 text-brand-ice/90 font-nunito text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />
                  <span>{t('billing.pay.waitingBrowser')}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 mt-8">
            {!done && (
              <Button variant="gold" disabled={busy || waiting} onClick={check}
                className={`${BTN_GOLD} ${scaleIf(currentFocusId, 'pay-check')}`}
                {...focusAttrs(currentFocusId, 'pay-check')}>
                <RefreshCw className={`w-4 h-4 mr-2 ${waiting ? 'animate-spin' : ''}`} />
                {phase === 'timeout' ? t('billing.pay.checkAgainBtn') : t('billing.pay.paidCheckBtn')}
              </Button>
            )}
            {!done && (
              <Button variant="white" disabled={busy} onClick={reopen}
                className={`${BTN} ${scaleIf(currentFocusId, 'pay-reopen')}`}
                {...focusAttrs(currentFocusId, 'pay-reopen')}>
                <ExternalLink className="w-4 h-4 mr-2" />
                {t('billing.pay.reopenBtn')}
              </Button>
            )}
            <Button variant="white" disabled={busy} onClick={close}
              className={`${BTN} ${scaleIf(currentFocusId, 'pay-cancel')}`}
              {...focusAttrs(currentFocusId, 'pay-cancel')}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              {done ? t('common.back') : t('billing.pay.notNowBtn')}
            </Button>
          </div>
          {!done && (
            <p className="text-brand-ice/60 text-xs font-nunito mt-4">
              {t('billing.pay.leaveHint')}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
});

PaymentSheet.displayName = 'PaymentSheet';
export default PaymentSheet;
