import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft,
  MonitorSmartphone,
  CheckCircle2,
  Loader2,
  Download,
  RefreshCw,
  Settings,
  Accessibility,
  Play,
  ShieldAlert,
  MessageCircle,
  Smartphone,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useTVFocus, TVFocusNavigationMap } from '@/hooks/useTVFocus';
import { isFireTV, getPlatform } from '@/utils/platform';
import { AppManager } from '@/capacitor/AppManager';
import { downloadApkToCache } from '@/utils/downloadApk';
import QRCheckoutDialog from '@/components/QRCheckoutDialog';
import { trackEvent } from '@/lib/analytics';
import type { Tables } from '@/integrations/supabase/types';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';

const SUPPORT_PACKAGE = 'com.snowmedia.support';
const SUPPORT_APK_URL = 'https://smcdreamstreams.store/support/snow-support.apk';
const SUPPORT_APK_FILE = 'snow-support-latest.apk';
const PAY_BASE_URL = 'https://snowmediaent.com/support-session';
const PRICE_LABEL = '$25';
const SETUP_STORAGE_KEY = 'smc-remote-setup-v1';
/** Server reason codes from redeem_remote_support_code -> the message key to show. */
const CODE_REASON_KEYS: Record<string, string> = {
  invalid: 'remoteHelp.toast.codeInvalid',
  expired: 'remoteHelp.toast.codeExpired',
  used_up: 'remoteHelp.toast.codeUsedUp',
  too_many: 'remoteHelp.toast.codeTooMany',
  no_request: 'remoteHelp.toast.codeNoRequest',
  signed_out: 'remoteHelp.toast.codeSignedOut',
};
// Parsed by AppManagerPlugin.openUrl via Intent.parseUri (intent:// scheme).
const OVERLAY_SETTINGS_INTENT =
  'intent://#Intent;action=android.settings.action.MANAGE_OVERLAY_PERMISSION;end';

type RemoteRequest = Tables<'remote_support_requests'>;

type Step =
  | 'loading'
  | 'blocked-firetv'
  | 'not-native'
  | 'noauth'
  | 'form'
  | 'pay'
  | 'setup-app'
  | 'setup-overlay'
  | 'setup-accessibility'
  | 'ready'
  | 'started';

interface SetupFlags {
  overlay: boolean;
  a11y: boolean;
}

const loadSetupFlags = (): SetupFlags => {
  try {
    const raw = localStorage.getItem(SETUP_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { overlay: !!p?.overlay, a11y: !!p?.a11y };
    }
  } catch { /* ignore */ }
  return { overlay: false, a11y: false };
};

const saveSetupFlags = (flags: SetupFlags) => {
  try { localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(flags)); } catch { /* ignore */ }
};

/** Best-effort device model / Android version from the WebView UA. */
const parseDeviceInfo = (): { model: string | null; android: string | null } => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const android = /Android\s+([\d.]+)/i.exec(ua)?.[1] ?? null;
  let model: string | null = null;
  const m = /Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build\/|\s*\)|;|\s*$)/i.exec(ua);
  if (m && m[1]) model = m[1].trim() || null;
  return { model, android };
};

/** A comped (free) session is treated exactly like a paid one customer-side. */
const isPaidLike = (s: string | null | undefined): boolean => s === 'paid' || s === 'comped';

interface RemoteSupportProps {
  onBack: () => void;
  onOpenTickets: () => void;
}

const RemoteSupport = ({ onBack, onOpenTickets }: RemoteSupportProps) => {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [step, setStep] = useState<Step>('loading');
  const [request, setRequest] = useState<RemoteRequest | null>(null);

  // Form
  const [issue, setIssue] = useState('');
  const [needs, setNeeds] = useState('');
  const [contact, setContact] = useState('');
  const [saving, setSaving] = useState(false);

  // Payment
  const [qrOpen, setQrOpen] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);

  // Wizard
  const [appInstalled, setAppInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [rechecking, setRechecking] = useState(false);
  const [setupFlags, setSetupFlags] = useState<SetupFlags>(() => loadSetupFlags());
  const [starting, setStarting] = useState(false);

  const requestRef = useRef<RemoteRequest | null>(null);
  requestRef.current = request;

  // ---------- Device gate (Fire TV first, then native-only) + resume ----------
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    (async () => {
      // 1. Fire TV / Firestick — Fire OS blocks the accessibility APIs the
      //    remote session depends on. Nothing else of the flow is shown.
      if (isFireTV()) {
        if (!cancelled) setStep('blocked-firetv');
        return;
      }
      if (getPlatform() !== 'web') {
        try {
          const { installed } = await AppManager.isInstalled({
            packageName: 'com.amazon.device.controllermanager',
          });
          if (installed) {
            if (!cancelled) setStep('blocked-firetv');
            return;
          }
        } catch { /* probe failed — fall through */ }
      }
      // NOTE: no mount-time dead-end for the web build any more. Requesting a
      // session and paying use only Supabase + a QR code, so they work in any
      // browser (including TV-box browsers that spoof desktop user agents).
      // Only the install/launch wizard is native — gated where it starts.


      // 2. Auth required — requests are tied to the signed-in user.
      if (!user) {
        if (!cancelled) setStep('noauth');
        return;
      }
      setContact((c) => c || user.email || '');

      // 3. Returning with a paid/comped request from the last 24h? Skip payment.
      //    Scoped to THIS user explicitly — an admin's select-all RLS would
      //    otherwise resume a random customer's request.
      try {
        const sinceMs = Date.now() - 24 * 3600 * 1000;
        const { data } = await supabase
          .from('remote_support_requests')
          .select('*')
          .eq('user_id', user.id)
          .in('status', ['paid', 'comped', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(5);
        if (cancelled) return;
        // Comped rows have no paid_at — their comp stamp starts the 24h window.
        const recent = (data ?? []).find((r) => {
          const stamp = r.paid_at ?? r.comped_at ?? r.created_at;
          return !!stamp && new Date(stamp).getTime() >= sinceMs;
        });
        if (recent) {
          setRequest(recent);
          // The install/launch wizard is native-only; in a browser, hand the
          // user to the app on their box (their paid request resumes there).
          setStep(getPlatform() === 'web' ? 'not-native' : 'setup-app');
          return;
        }
      } catch (err) {
        console.error('[RemoteSupport] resume lookup failed:', err);
      }
      if (!cancelled) setStep('form');
    })();

    return () => { cancelled = true; };
  }, [user, authLoading]);

  // ---------- Form ----------
  const submitForm = useCallback(async () => {
    if (!user || !issue.trim() || saving) return;
    setSaving(true);
    try {
      const { model, android } = parseDeviceInfo();
      const payload = {
        issue: issue.trim(),
        needs: needs.trim() || null,
        contact: contact.trim() || null,
        device_model: model,
        android_version: android,
      };
      const existing = requestRef.current;
      let row: RemoteRequest | null = null;
      if (existing && existing.status === 'pending_payment') {
        // Back-and-forth between pay and form edits the SAME pending row
        // instead of stacking duplicates.
        const { data, error } = await supabase
          .from('remote_support_requests')
          .update(payload)
          .eq('id', existing.id)
          .select()
          .single();
        if (error) throw error;
        row = data;
      } else {
        const { data, error } = await supabase
          .from('remote_support_requests')
          .insert({ ...payload, user_id: user.id, status: 'pending_payment' })
          .select()
          .single();
        if (error) throw error;
        row = data;
      }
      setRequest(row);
      try { trackEvent('remote_support_request', 'support', {}); } catch { /* ignore */ }
      setStep('pay');
      setQrOpen(true);
    } catch (err) {
      console.error('[RemoteSupport] submit failed:', err);
      toast({
        title: t('remoteHelp.toast.saveFailedTitle'),
        description: t('remoteHelp.toast.saveFailedDesc'),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [user, issue, needs, contact, saving, toast, t]);

  // ---------- Payment ----------
  const payUrl = useMemo(() => {
    if (!request) return null;
    const email = (contact || user?.email || '').trim();
    return `${PAY_BASE_URL}?ref=${encodeURIComponent(request.id)}&email=${encodeURIComponent(email)}`;
  }, [request, contact, user?.email]);

  // Returns WHICH paid-like status the row landed on, or null while pending.
  const checkPaid = useCallback(async (): Promise<'paid' | 'comped' | null> => {
    const current = requestRef.current;
    if (!current) return null;
    try {
      const { data } = await supabase
        .from('remote_support_requests')
        .select('status, paid_at, comped_at, order_number')
        .eq('id', current.id)
        .maybeSingle();
      if (data?.status === 'paid' || data?.status === 'comped') {
        setRequest((prev) => (prev ? { ...prev, ...data } : prev));
        return data.status === 'comped' ? 'comped' : 'paid';
      }
    } catch (err) {
      console.error('[RemoteSupport] payment check failed:', err);
    }
    return null;
  }, []);

  const advanceAfterPayment = useCallback((kind: 'paid' | 'comped') => {
    setQrOpen(false);
    // Payment worked wherever we are; the install/launch wizard needs the
    // native app. In a browser, show the "finish on your box" screen — the
    // paid request auto-resumes when they open Remote Access in the app.
    setStep(getPlatform() === 'web' ? 'not-native' : 'setup-app');
    try { trackEvent('remote_support_paid', 'support', {}); } catch { /* ignore */ }
    toast(
      kind === 'comped'
        ? {
            title: t('remoteHelp.toast.waivedTitle'),
            description: t('remoteHelp.toast.readyDesc'),
          }
        : {
            title: t('remoteHelp.toast.receivedTitle'),
            description: t('remoteHelp.toast.readyDesc'),
          },
    );
  }, [toast, t]);

  // Auto-advance the moment the bridge flips the row to paid.
  useEffect(() => {
    if (!qrOpen || !request?.id) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      const kind = await checkPaid();
      if (kind) advanceAfterPayment(kind);
    };
    const t = window.setInterval(tick, 4000);
    return () => { stopped = true; window.clearInterval(t); };
  }, [qrOpen, request?.id, checkPaid, advanceAfterPayment]);

  // A free-session code from the Admin Hub. The backend decides whether it
  // is good (redeem_remote_support_code): nothing about codes is in the app.
  const [code, setCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const redeemCode = useCallback(async () => {
    const current = requestRef.current;
    const typed = code.trim();
    if (!current?.id || !typed || redeeming) return;
    setRedeeming(true);
    try {
      const { data, error } = await supabase.rpc('redeem_remote_support_code', { p_request_id: current.id, p_code: typed });
      if (error) throw error;
      const res = (data ?? {}) as { ok?: boolean; reason?: string };
      if (res.ok) {
        try { trackEvent('remote_support_code', 'support', { ok: true }); } catch { /* ignore */ }
        setRequest({ ...current, status: 'comped', comped_at: new Date().toISOString() });
        advanceAfterPayment('comped');
        return;
      }
      try { trackEvent('remote_support_code', 'support', { ok: false, reason: res.reason ?? 'unknown' }); } catch { /* ignore */ }
      const whyKey = CODE_REASON_KEYS[res.reason ?? ''] ?? 'remoteHelp.toast.tryAgain';
      toast({ title: t('remoteHelp.toast.codeRejectedTitle'), description: t(whyKey), variant: 'destructive' });
    } catch (err) {
      toast({ title: t('remoteHelp.toast.codeCheckFailedTitle'), description: (err as Error).message || t('remoteHelp.toast.tryAgain'), variant: 'destructive' });
    } finally {
      setRedeeming(false);
    }
  }, [code, redeeming, advanceAfterPayment, toast, t]);

  // Manual fallback — the dialog's "I've completed payment" button.
  const handleConfirmPaid = useCallback(async () => {
    if (checkingPayment) return;
    setCheckingPayment(true);
    try {
      const kind = await checkPaid();
      if (!kind) {
        toast({
          title: t('remoteHelp.toast.notYetTitle'),
          description: t('remoteHelp.toast.notYetDesc'),
        });
      } else {
        advanceAfterPayment(kind);
      }
    } finally {
      setCheckingPayment(false);
    }
  }, [checkingPayment, checkPaid, advanceAfterPayment, toast, t]);

  // D-pad inside the QR dialog (it lives in a portal outside our container):
  // clamp arrows between its buttons, Back/Escape closes it.
  useEffect(() => {
    if (!qrOpen) return;
    const handler = (e: KeyboardEvent) => {
      const isBack = e.key === 'Escape' || e.keyCode === 4 || e.code === 'GoBack';
      if (isBack) {
        e.preventDefault();
        e.stopPropagation();
        setQrOpen(false);
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return;
      const buttons = Array.from(
        dialog.querySelectorAll<HTMLElement>('button:not([disabled])'),
      );
      if (!buttons.length) return;
      e.preventDefault();
      e.stopPropagation();
      const dir = e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1;
      const idx = buttons.indexOf(document.activeElement as HTMLElement);
      const start = idx < 0 ? (dir > 0 ? -1 : buttons.length) : idx;
      const next = buttons[Math.min(buttons.length - 1, Math.max(0, start + dir))];
      next?.focus();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [qrOpen]);

  // ---------- Wizard: step A (install Support app) ----------
  const recheckApp = useCallback(async () => {
    setRechecking(true);
    try {
      const { installed } = await AppManager.isInstalled({ packageName: SUPPORT_PACKAGE });
      setAppInstalled(installed);
      return installed;
    } catch {
      return false;
    } finally {
      setRechecking(false);
    }
  }, []);

  useEffect(() => {
    if (step !== 'setup-app') return;
    void recheckApp();
    const onResume = () => { void recheckApp(); };
    const onVis = () => { if (document.visibilityState === 'visible') void recheckApp(); };
    window.addEventListener('focus', onResume);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onResume);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [step, recheckApp]);

  // Step A auto-advances as soon as the app reads installed.
  useEffect(() => {
    if (step === 'setup-app' && appInstalled) setStep('setup-overlay');
  }, [step, appInstalled]);

  const installSupportApp = useCallback(async () => {
    if (installing) return;
    setInstalling(true);
    try {
      const uri = await downloadApkToCache(SUPPORT_APK_URL, SUPPORT_APK_FILE);
      await AppManager.installApk({ filePath: uri });
      // The system install dialog takes over; recheckApp fires on resume.
    } catch (err) {
      console.error('[RemoteSupport] install failed:', err);
      toast({
        title: t('remoteHelp.toast.installFailedTitle'),
        description: err instanceof Error ? err.message : t('remoteHelp.toast.installFailedDesc'),
        variant: 'destructive',
      });
    } finally {
      setInstalling(false);
    }
  }, [installing, toast, t]);

  // ---------- Wizard: steps B / C (settings deep-links + user confirm) ----------
  const openOverlaySettings = useCallback(async () => {
    try {
      await AppManager.openUrl({ url: OVERLAY_SETTINGS_INTENT });
    } catch (err) {
      console.error('[RemoteSupport] overlay settings failed:', err);
      toast({
        title: t('remoteHelp.toast.settingsFailedTitle'),
        description: t('remoteHelp.toast.overlayManual'),
        variant: 'destructive',
      });
    }
  }, [toast, t]);

  const openAccessibilitySettings = useCallback(async () => {
    try {
      await AppManager.openAccessibilitySettings();
    } catch (err) {
      console.error('[RemoteSupport] accessibility settings failed:', err);
      toast({
        title: t('remoteHelp.toast.settingsFailedTitle'),
        description: t('remoteHelp.toast.a11yManual'),
        variant: 'destructive',
      });
    }
  }, [toast, t]);

  const confirmOverlay = useCallback(() => {
    const next = { ...setupFlags, overlay: true };
    setSetupFlags(next);
    saveSetupFlags(next);
    setStep('setup-accessibility');
  }, [setupFlags]);

  const confirmA11y = useCallback(() => {
    const next = { ...setupFlags, a11y: true };
    setSetupFlags(next);
    saveSetupFlags(next);
    setStep('ready');
  }, [setupFlags]);

  // ---------- Hand off ----------
  const startSession = useCallback(async () => {
    const current = requestRef.current;
    if (!current || starting) return;
    setStarting(true);
    try {
      if (isPaidLike(current.status)) {
        // Security-definer RPC: flips THEIR OWN row paid/comped -> in_progress
        // and stamps session_started_at. False just means it was already moved.
        await supabase.rpc('start_remote_support_session', { p_id: current.id });
      }
      await AppManager.launch({ packageName: SUPPORT_PACKAGE });
      try { trackEvent('remote_support_start', 'support', {}); } catch { /* ignore */ }
      setStep('started');
    } catch (err) {
      console.error('[RemoteSupport] launch failed:', err);
      toast({
        title: t('remoteHelp.toast.startFailedTitle'),
        description: t('remoteHelp.toast.startFailedDesc'),
        variant: 'destructive',
      });
    } finally {
      setStarting(false);
    }
  }, [starting, toast, t]);

  // ---------- D-pad ----------
  const handleBack = useCallback(() => {
    switch (step) {
      case 'pay':
        setQrOpen(false);
        setStep('form');
        return;
      case 'setup-overlay':
        setStep('setup-app');
        return;
      case 'setup-accessibility':
        setStep('setup-overlay');
        return;
      case 'ready':
        setStep('setup-accessibility');
        return;
      default:
        onBack();
    }
  }, [step, onBack]);

  const navigation = useMemo<TVFocusNavigationMap>(() => {
    const chains: Partial<Record<Step, string[]>> = {
      'blocked-firetv': ['rs-back', 'rs-tickets'],
      'not-native': ['rs-back'],
      noauth: ['rs-back'],
      form: ['rs-back', 'rs-issue', 'rs-needs', 'rs-contact', 'rs-submit'],
      pay: ['rs-back', 'rs-show-qr', 'rs-code', 'rs-use-code'],
      'setup-app': ['rs-back', 'rs-install', 'rs-recheck'],
      'setup-overlay': ['rs-back', 'rs-open-settings', 'rs-confirm'],
      'setup-accessibility': ['rs-back', 'rs-open-settings', 'rs-confirm'],
      ready: ['rs-back', 'rs-start'],
      started: ['rs-back'],
    };
    const chain = chains[step] || ['rs-back'];
    const map: TVFocusNavigationMap = {};
    chain.forEach((id, i) => {
      map[id] = {
        up: i > 0 ? chain[i - 1] : null,
        down: i < chain.length - 1 ? chain[i + 1] : null,
      };
    });
    return map;
  }, [step]);

  const focusActive = step !== 'loading' && !qrOpen;
  const tvFocus = useTVFocus({
    initialFocusId: 'rs-back',
    navigation,
    onBack: handleBack,
    enabled: focusActive,
    scrollBlock: 'nearest',
  });

  // Focus the primary control whenever the screen changes.
  useEffect(() => {
    if (!focusActive) return;
    const primary: Partial<Record<Step, string>> = {
      'blocked-firetv': 'rs-tickets',
      form: 'rs-issue',
      pay: 'rs-show-qr',
      'setup-app': 'rs-install',
      'setup-overlay': 'rs-open-settings',
      'setup-accessibility': 'rs-open-settings',
      ready: 'rs-start',
    };
    const id = primary[step] || 'rs-back';
    const raf = requestAnimationFrame(() => tvFocus.focusById(id, 'nearest'));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, focusActive]);

  // ---------- Shared bits ----------
  const StatusChip = ({ done }: { done: boolean }) => (
    <span
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xl font-semibold ${
        done ? 'bg-green-600/25 text-green-300 border border-green-400/50' : 'bg-slate-700/60 text-slate-300 border border-slate-500/50'
      }`}
    >
      {done ? <CheckCircle2 className="w-6 h-6" /> : <span className="w-6 h-6 rounded-full border-2 border-current inline-block" />}
      {done ? t('remoteHelp.chip.done') : t('remoteHelp.chip.notYet')}
    </span>
  );

  const Header = ({ title, subtitle }: { title: string; subtitle?: string }) => (
    <div className="mt-6 mb-8">
      <h1 className="text-4xl font-bold text-white flex items-center gap-3">
        <MonitorSmartphone className="w-9 h-9 text-rose-400" />
        {title}
      </h1>
      {subtitle && <p className="text-xl text-blue-200 mt-2">{subtitle}</p>}
      {request?.status === 'comped' ? (
        <p className="text-lg text-green-300 mt-2">
          {t('remoteHelp.header.waived')}
        </p>
      ) : (
        request?.order_number && (
          <p className="text-lg text-green-300 mt-2">
            {t('remoteHelp.header.paid', { number: request.order_number })}
          </p>
        )
      )}
    </div>
  );

  const backButton = (
    <BackButton onClick={handleBack} label={t('common.back')} data-tv-focus-id="rs-back" />
  );

  const wizardShell = (
    stepLabel: string,
    title: string,
    reason: React.ReactNode,
    status: React.ReactNode,
    actions: React.ReactNode,
    extra?: React.ReactNode,
  ) => (
    <>
      <div className="flex items-center w-full justify-start">
        {backButton}
      </div>
      <div className="max-w-2xl mx-auto px-6 pb-24">
        <Header title={t('remoteHelp.title')} subtitle={stepLabel} />
        <div className="bg-slate-800/50 border border-slate-600 rounded-xl p-6 space-y-6">
          <h2 className="text-3xl font-bold text-white">{title}</h2>
          <div className="text-xl text-slate-200 space-y-3">{reason}</div>
          <div>{status}</div>
          <div className="flex flex-col gap-4 pt-2">{actions}</div>
          {extra}
        </div>
      </div>
    </>
  );

  const bigAction =
    'h-16 px-6 text-xl font-medium justify-start transition-all duration-200';

  // ---------- Screens ----------
  let content: React.ReactNode;

  if (step === 'loading') {
    content = (
      <div className="max-w-2xl mx-auto px-6 pb-24 flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-10 h-10 animate-spin text-rose-400" />
      </div>
    );
  } else if (step === 'blocked-firetv') {
    content = (
      <>
        <div className="flex items-center w-full justify-start">
          {backButton}
        </div>
        <div className="max-w-2xl mx-auto px-6 pb-24">
          <Header title={t('remoteHelp.title')} />
          <div className="bg-slate-800/50 border border-slate-600 rounded-xl p-6 space-y-6">
            <div className="flex items-start gap-4">
              <ShieldAlert className="w-10 h-10 text-amber-400 shrink-0 mt-1" />
              <p className="text-2xl text-white font-medium">
                {t('remoteHelp.blocked.title')}
              </p>
            </div>
            <p className="text-xl text-slate-300">
              {t('remoteHelp.blocked.body')}
            </p>
            <Button
              onClick={onOpenTickets}
              size="lg"
              data-tv-focus-id="rs-tickets"
              className={`${bigAction} bg-orange-700/60 border border-orange-400/70 text-white hover:bg-orange-600/70 w-full`}
            >
              <MessageCircle className="w-6 h-6 mr-3" />
              {t('remoteHelp.blocked.ticketsBtn')}
            </Button>
          </div>
        </div>
      </>
    );
  } else if (step === 'not-native') {
    content = (
      <>
        <div className="flex items-center w-full justify-start">
          {backButton}
        </div>
        <div className="max-w-2xl mx-auto px-6 pb-24">
          <Header title={t('remoteHelp.title')} />
          <div className="bg-slate-800/50 border border-slate-600 rounded-xl p-6">
            {request ? (
              <>
                <p className="text-xl text-slate-200">
                  {t('remoteHelp.notNative.paid')}
                </p>
                <p className="mt-3 text-slate-300">
                  <Trans i18nKey="remoteHelp.notNative.paidNext" components={{ 1: <b /> }} />
                </p>
              </>
            ) : (
              <p className="text-xl text-slate-200">
                <Trans i18nKey="remoteHelp.notNative.unpaid" components={{ 1: <b /> }} />
              </p>
            )}
            <p className="mt-4 text-xs font-mono text-slate-500 break-all">
              {/* i18n-ignore: developer diagnostics line, not for customers */}
              {`platform=${getPlatform()} cap=${typeof (window as any).Capacitor} fn=${typeof (window as any).Capacitor?.isNativePlatform} bridge=${!!(window as any).androidBridge} ua=${(navigator.userAgent || '').slice(0, 80)}`}
            </p>
          </div>
        </div>
      </>
    );
  } else if (step === 'noauth') {
    content = (
      <>
        <div className="flex items-center w-full justify-start">
          {backButton}
        </div>
        <div className="max-w-2xl mx-auto px-6 pb-24">
          <Header title={t('remoteHelp.title')} />
          <div className="bg-slate-800/50 border border-slate-600 rounded-xl p-6">
            <p className="text-xl text-slate-200">
              {t('remoteHelp.noauth.body')}
            </p>
          </div>
        </div>
      </>
    );
  } else if (step === 'form') {
    content = (
      <>
        <div className="flex items-center w-full justify-start">
          {backButton}
        </div>
        <div className="max-w-2xl mx-auto px-6 pb-24">
          <Header
            title={t('remoteHelp.title')}
            subtitle={t('remoteHelp.form.subtitle', { price: PRICE_LABEL })}
          />
          <div className="bg-slate-800/50 border border-slate-600 rounded-xl p-6 space-y-6">
            <div>
              <label className="text-xl font-semibold text-white block mb-2">
                {t('remoteHelp.form.issueLabel')} <span className="text-rose-400">*</span>
              </label>
              <Textarea
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                placeholder={t('remoteHelp.form.issuePlaceholder')}
                rows={4}
                data-tv-focus-id="rs-issue"
                className="bg-slate-700 border-slate-500 text-white text-xl placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="text-xl font-semibold text-white block mb-2">
                <Trans i18nKey="remoteHelp.form.needsLabel" components={{ 1: <span className="text-slate-400 text-lg" /> }} />
              </label>
              <Textarea
                value={needs}
                onChange={(e) => setNeeds(e.target.value)}
                placeholder={t('remoteHelp.form.needsPlaceholder')}
                rows={3}
                data-tv-focus-id="rs-needs"
                className="bg-slate-700 border-slate-500 text-white text-xl placeholder:text-slate-400"
              />
            </div>
            <div>
              <label className="text-xl font-semibold text-white block mb-2">
                {t('remoteHelp.form.contactLabel')}
              </label>
              <Input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={t('remoteHelp.form.contactPlaceholder')}
                data-tv-focus-id="rs-contact"
                className="bg-slate-700 border-slate-500 text-white text-xl h-14 placeholder:text-slate-400"
              />
            </div>
            <Button
              onClick={submitForm}
              disabled={!issue.trim() || saving}
              size="lg"
              data-tv-focus-id="rs-submit"
              className={`${bigAction} bg-rose-600 hover:bg-rose-700 text-white w-full justify-center`}
            >
              {saving ? (
                <><Loader2 className="w-6 h-6 mr-3 animate-spin" /> {t('remoteHelp.form.saving')}</>
              ) : (
                <>{t('remoteHelp.form.continueBtn', { price: PRICE_LABEL })}</>
              )}
            </Button>
          </div>
        </div>
      </>
    );
  } else if (step === 'pay') {
    content = (
      <>
        <div className="flex items-center w-full justify-start">
          {backButton}
        </div>
        <div className="max-w-2xl mx-auto px-6 pb-24">
          <Header title={t('remoteHelp.pay.title')} subtitle={t('remoteHelp.pay.subtitle')} />
          <div className="bg-slate-800/50 border border-slate-600 rounded-xl p-6 space-y-6">
            <div className="flex items-start gap-4">
              <Smartphone className="w-10 h-10 text-rose-400 shrink-0 mt-1" />
              <p className="text-xl text-slate-200">
                {t('remoteHelp.pay.scan', { price: PRICE_LABEL })}
              </p>
            </div>
            <Button
              onClick={() => setQrOpen(true)}
              size="lg"
              data-tv-focus-id="rs-show-qr"
              className={`${bigAction} bg-rose-600 hover:bg-rose-700 text-white w-full justify-center`}
            >
              {t('remoteHelp.pay.showQrBtn')}
            </Button>
            <div className="border-t border-slate-600 pt-5">
              <label className="text-xl font-semibold text-white block mb-2">
                {t('remoteHelp.pay.codeLabel')}
              </label>
              <p className="text-slate-300 mb-3">{t('remoteHelp.pay.codeHint')}</p>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={t('remoteHelp.pay.codePlaceholder')}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                data-tv-focus-id="rs-code"
                className="bg-slate-700 border-slate-500 text-white text-xl h-14 tracking-widest placeholder:text-slate-400 placeholder:tracking-normal"
              />
              <Button
                onClick={() => void redeemCode()}
                disabled={!code.trim() || redeeming}
                size="lg"
                data-tv-focus-id="rs-use-code"
                className={`${bigAction} mt-3 bg-emerald-600 hover:bg-emerald-700 text-white w-full justify-center`}
              >
                {redeeming ? (<><Loader2 className="w-6 h-6 mr-3 animate-spin" /> {t('remoteHelp.pay.checking')}</>) : t('remoteHelp.pay.useCodeBtn')}
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  } else if (step === 'setup-app') {
    content = wizardShell(
      t('remoteHelp.setup.stepOf', { step: 1 }),
      t('remoteHelp.setup.app.title'),
      <p>
        {t('remoteHelp.setup.app.body')}
      </p>,
      <StatusChip done={appInstalled} />,
      <>
        <Button
          onClick={installSupportApp}
          disabled={installing}
          size="lg"
          data-tv-focus-id="rs-install"
          className={`${bigAction} bg-rose-600 hover:bg-rose-700 text-white`}
        >
          {installing ? (
            <><Loader2 className="w-6 h-6 mr-3 animate-spin" /> {t('remoteHelp.setup.app.downloading')}</>
          ) : (
            <><Download className="w-6 h-6 mr-3" /> {t('remoteHelp.setup.app.installBtn')}</>
          )}
        </Button>
        <Button
          onClick={recheckApp}
          disabled={rechecking}
          size="lg"
          data-tv-focus-id="rs-recheck"
          className={`${bigAction} bg-blue-600/20 border border-blue-400/50 text-white hover:bg-blue-600/30`}
        >
          {rechecking ? (
            <><Loader2 className="w-6 h-6 mr-3 animate-spin" /> {t('remoteHelp.setup.app.rechecking')}</>
          ) : (
            <><RefreshCw className="w-6 h-6 mr-3" /> {t('remoteHelp.setup.app.recheckBtn')}</>
          )}
        </Button>
      </>,
    );
  } else if (step === 'setup-overlay') {
    content = wizardShell(
      t('remoteHelp.setup.stepOf', { step: 2 }),
      t('remoteHelp.setup.overlay.title'),
      <>
        <p>
          {t('remoteHelp.setup.overlay.why')}
        </p>
        <p>
          <Trans i18nKey="remoteHelp.setup.overlay.how" components={{ 1: <span className="font-semibold text-white" /> }} />
        </p>
      </>,
      <StatusChip done={setupFlags.overlay} />,
      <>
        <Button
          onClick={openOverlaySettings}
          size="lg"
          data-tv-focus-id="rs-open-settings"
          className={`${bigAction} bg-rose-600 hover:bg-rose-700 text-white`}
        >
          <Settings className="w-6 h-6 mr-3" />
          {t('remoteHelp.setup.openSettingsBtn')}
        </Button>
        <Button
          onClick={confirmOverlay}
          size="lg"
          data-tv-focus-id="rs-confirm"
          className={`${bigAction} bg-green-600/25 border border-green-400/50 text-white hover:bg-green-600/40`}
        >
          <CheckCircle2 className="w-6 h-6 mr-3" />
          {setupFlags.overlay ? t('remoteHelp.setup.continueBtn') : t('remoteHelp.setup.confirmBtn')}
        </Button>
      </>,
    );
  } else if (step === 'setup-accessibility') {
    content = wizardShell(
      t('remoteHelp.setup.stepOf', { step: 3 }),
      t('remoteHelp.setup.a11y.title'),
      <>
        <p>
          {t('remoteHelp.setup.a11y.why')}
        </p>
        <p>
          <Trans i18nKey="remoteHelp.setup.a11y.how" components={{ 1: <span className="font-semibold text-white" /> }} />
        </p>
      </>,
      <StatusChip done={setupFlags.a11y} />,
      <>
        <Button
          onClick={openAccessibilitySettings}
          size="lg"
          data-tv-focus-id="rs-open-settings"
          className={`${bigAction} bg-rose-600 hover:bg-rose-700 text-white`}
        >
          <Accessibility className="w-6 h-6 mr-3" />
          {t('remoteHelp.setup.a11y.openBtn')}
        </Button>
        <Button
          onClick={confirmA11y}
          size="lg"
          data-tv-focus-id="rs-confirm"
          className={`${bigAction} bg-green-600/25 border border-green-400/50 text-white hover:bg-green-600/40`}
        >
          <CheckCircle2 className="w-6 h-6 mr-3" />
          {setupFlags.a11y ? t('remoteHelp.setup.continueBtn') : t('remoteHelp.setup.confirmBtn')}
        </Button>
      </>,
      <div className="bg-amber-600/15 border border-amber-400/40 rounded-lg p-4">
        <p className="text-lg text-amber-200">
          <Trans i18nKey="remoteHelp.setup.a11y.important" components={{ 1: <span className="font-semibold" /> }} />
        </p>
      </div>,
    );
  } else if (step === 'ready') {
    content = (
      <>
        <div className="flex items-center w-full justify-start">
          {backButton}
        </div>
        <div className="max-w-2xl mx-auto px-6 pb-24">
          <Header title={t('remoteHelp.ready.title')} subtitle={t('remoteHelp.ready.subtitle')} />
          <div className="bg-slate-800/50 border border-slate-600 rounded-xl p-6 space-y-6">
            <ul className="text-xl text-slate-200 space-y-4">
              <li className="flex gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-400 shrink-0 mt-1" />
                {t('remoteHelp.ready.point1')}
              </li>
              <li className="flex gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-400 shrink-0 mt-1" />
                {t('remoteHelp.ready.point2')}
              </li>
              <li className="flex gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-400 shrink-0 mt-1" />
                {t('remoteHelp.ready.point3')}
              </li>
            </ul>
            <Button
              onClick={startSession}
              disabled={starting}
              size="lg"
              data-tv-focus-id="rs-start"
              className={`${bigAction} bg-green-600 hover:bg-green-700 text-white w-full justify-center`}
            >
              {starting ? (
                <><Loader2 className="w-6 h-6 mr-3 animate-spin" /> {t('remoteHelp.ready.starting')}</>
              ) : (
                <><Play className="w-6 h-6 mr-3" /> {t('remoteHelp.ready.startBtn')}</>
              )}
            </Button>
          </div>
        </div>
      </>
    );
  } else {
    // started
    content = (
      <>
        <div className="flex items-center w-full justify-start">
          {backButton}
        </div>
        <div className="max-w-2xl mx-auto px-6 pb-24">
          <Header title={t('remoteHelp.started.title')} />
          <div className="bg-slate-800/50 border border-slate-600 rounded-xl p-6 space-y-4">
            <p className="text-xl text-slate-200">
              {t('remoteHelp.started.body1')}
            </p>
            <p className="text-xl text-slate-200">
              {t('remoteHelp.started.body2')}
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <div
      ref={tvFocus.containerRef}
      className="fixed inset-0 tv-scroll-container tv-safe text-white overflow-y-auto overscroll-contain"
    >
      {content}

      <QRCheckoutDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        url={payUrl}
        title={t('remoteHelp.pay.dialogTitle', { price: PRICE_LABEL })}
        description={t('remoteHelp.pay.dialogDesc')}
        checkoutNotice={{
          title: t('remoteHelp.pay.guestTitle'),
          body: t('remoteHelp.pay.guestBody'),
        }}
        onConfirmPaid={handleConfirmPaid}
        confirming={checkingPayment}
        confirmLabel={t('remoteHelp.pay.confirmedLabel')}
      />
    </div>
  );
};

export default RemoteSupport;
