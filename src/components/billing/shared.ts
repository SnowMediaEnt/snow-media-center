import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useToast } from '@/hooks/use-toast';
import i18n from '@/i18n';
import { toBillingError, billingErrorText, type BillingErrorInfo } from '@/lib/billing';

/** Layout classes shared by every billing screen (matches the Player's sub-screens). */
export const SCREEN = 'min-h-screen flex flex-col text-white bg-black/70';
export const HEADER = 'flex items-center justify-between gap-3 px-6 py-4 border-b border-white/10 bg-black/30';
export const BODY = 'flex-1 overflow-auto p-6 flex items-start justify-center';
export const BTN = 'tv-ring rounded-xl h-12 px-5 transition-transform duration-150 ease-out';
export const BTN_GOLD = 'tv-ring tv-ring-contrast rounded-xl h-12 px-5 transition-transform duration-150 ease-out';
export const CARD = 'rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 border border-slate-700 shadow-xl';
export const INPUT = 'rounded-xl h-12 bg-black/30 text-white border-white/20';

/**
 * Attributes for a useTVFocus-managed control. `data-tv-focus-id` is what the
 * hook drives; `data-focused` mirrors it so the white contrast ring shows on
 * gold buttons (the global gold ring is invisible on gold).
 */
export const focusAttrs = (current: string | null, id: string) => ({
  'data-tv-focus-id': id,
  'data-focused': current === id ? 'true' : 'false',
  tabIndex: 0,
});

export const scaleIf = (current: string | null, id: string): string => (current === id ? 'scale-105 z-10' : '');

/**
 * 429 handling: the server says how long to wait; every action button on the
 * screen disables until then and the note counts down.
 */
export function useRateLimit() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= Date.now()) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [until]);
  const block = useCallback((seconds: number) => {
    setUntil(Date.now() + Math.max(1, seconds) * 1000);
    setNow(Date.now());
  }, []);
  const secondsLeft = Math.max(0, Math.ceil((until - now) / 1000));
  return { blocked: secondsLeft > 0, secondsLeft, block };
}

/**
 * One place that turns a rejected bridge call into what the screen does:
 * a toast with the right sentence, a rate-limit countdown, and — when the
 * token is dead — a jump back to sign-in.
 */
export function useBillingErrorHandler(opts: { onAuthLost?: () => void; block?: (seconds: number) => void }) {
  const { toast } = useToast();
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; }, [opts]);
  return useCallback((e: unknown, title = i18n.t('billing.errors.defaultTitle')): BillingErrorInfo => {
    const err = toBillingError(e);
    if (err.isAuthError) {
      optsRef.current.onAuthLost?.();
      toast({ title: i18n.t('billing.errors.signInAgainTitle'), description: i18n.t('billing.errors.signInExpiredDesc'), variant: 'destructive' });
      return err;
    }
    if (err.code === 'rate_limited') optsRef.current.block?.(err.retryAfter ?? 30);
    if (err.code !== 'cancelled') {
      toast({ title, description: billingErrorText(err), variant: 'destructive' });
    }
    return err;
  }, [toast]);
}

/**
 * useTVFocus keeps the id of the focused control, but a control can vanish
 * mid-screen (a "Renew" button turning into "Choose a plan", a banner going
 * away after payment). With nothing focused, the remote's keys would fall
 * through to whatever screen is underneath — on the dashboard that means a
 * Back press pops the route out from under this screen. So after every
 * render: if the focused id is gone, land on [fallbackId] (or the first
 * control).
 */
export function useFocusRecovery(
  containerRef: RefObject<HTMLElement>,
  currentFocusId: string | null,
  focusById: (id?: string | null) => boolean,
  fallbackId: string,
) {
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    // A disabled control is still THE control (a button busy with its own
    // action); only one that left the DOM counts as gone.
    const has = (id: string | null) => !!id && !!root.querySelector(`[data-tv-focus-id="${id}"]`);
    const usable = (id: string) => !!root.querySelector(`[data-tv-focus-id="${id}"]:not([disabled])`);
    if (has(currentFocusId)) return;
    const raf = requestAnimationFrame(() => {
      if (has(currentFocusId)) return;
      if (usable(fallbackId)) { focusById(fallbackId); return; }
      const first = root.querySelector<HTMLElement>('[data-tv-focus-id]:not([disabled])');
      if (first) focusById(first.dataset.tvFocusId);
    });
    return () => cancelAnimationFrame(raf);
  });
}

/**
 * Heading of the payment sheet. Built from the plan name at draw time (never stored),
 * so it follows the language; "kind" is 'renew' for a renewal, anything else is a purchase.
 */
export function payTitle(kind: string, planName: string | null | undefined): string {
  const renew = kind === 'renew';
  if (planName) return i18n.t(renew ? 'billing.pay.renewTitle' : 'billing.pay.payForTitle', { plan: planName });
  return i18n.t(renew ? 'billing.pay.renewYourPlan' : 'billing.pay.payForYourPlan');
}
