import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Trans, useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Check, CreditCard, Gem, Gift, Loader2, RefreshCw, Sparkles, Star, Zap } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useTVFocus } from '@/hooks/useTVFocus';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { trackEvent } from '@/lib/analytics';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';
import { formatCurrency, formatNumber } from '@/i18n/format';

/**
 * The private page on snowmediaent.com that the QR opens. It is not linked
 * from anywhere on the site and shows nothing without a live order ref, so
 * gems are never on sale on the website itself — only from this screen.
 */
const GEMS_PAGE = 'https://snowmediaent.com/gems';
const buildGemsUrl = (ref: string): string => `${GEMS_PAGE}?ref=${encodeURIComponent(ref)}`;

/** A code older than this is treated as abandoned; the viewer starts a fresh one. */
const ORDER_TTL_MS = 30 * 60 * 1000;
const POLL_MS = 4000;

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  description: string | null;
  is_active: boolean | null;
}

interface GemOrder {
  id: string;
  package_name: string;
  credits: number;
  price: number;
  status: string;
  created_at: string;
  order_number: string | null;
}

interface CreditStoreProps {
  onBack: () => void;
}

const STORE_FOCUSABLE = '[data-tv-focus-id], button:not([disabled])';
const PANEL = 'bg-gradient-to-br from-brand-navy/85 via-[#12204a]/85 to-slate-950/90 border-brand-ice/20 shadow-xl rounded-3xl';

const iconFor = (index: number) => [Zap, CreditCard, Star, Gift][index] ?? Gem;

const fmtMoney = (n: number) => formatCurrency(n, 'USD');

/**
 * Snow Gems store. Nothing is charged on the TV: the viewer picks a pack, the
 * app records a pending order, and a QR code opens a private checkout on
 * snowmediaent.com carrying that order. The website pays through PayPal and
 * tells the SMC backend, which credits the gems and flips the order to paid.
 * This screen polls its own order and celebrates the moment they land.
 */
const CreditStore = ({ onBack }: CreditStoreProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { profile, fetchProfile, fetchTransactions } = useUserProfile();
  const { toast } = useToast();

  const [packages, setPackages] = useState<CreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'packages' | 'qr' | 'paid'>('packages');
  const [order, setOrder] = useState<GemOrder | null>(null);
  const [pending, setPending] = useState<GemOrder | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [review, setReview] = useState(false);
  const [landed, setLanded] = useState<{ credits: number; balance: number | null } | null>(null);

  useEffect(() => {
    try { trackEvent('gems_store_open', 'store', { balance: profile?.credits ?? null }); } catch { /* ignore */ }
    // Once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The packs, and any code the viewer walked away from in the last half hour.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('credit_packages')
          .select('*')
          .eq('is_active', true)
          .order('price', { ascending: true });
        if (error) throw error;
        if (!cancelled) setPackages((data ?? []) as CreditPackage[]);
      } catch (e) {
        console.error('[CreditStore] packages:', e);
        if (!cancelled) toast({ title: t('billing.gems.packsFailedTitle'), description: t('billing.gems.tryAgainMoment'), variant: 'destructive' });
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (!user) return;
      try {
        const since = new Date(Date.now() - ORDER_TTL_MS).toISOString();
        const { data } = await supabase
          .from('gem_orders')
          .select('id, package_name, credits, price, status, created_at, order_number')
          .eq('user_id', user.id)
          .eq('status', 'pending_payment')
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(1);
        const row = (data ?? [])[0] as GemOrder | undefined;
        if (!cancelled && row) setPending(row);
      } catch { /* no resume offer, nothing lost */ }
    })();
    return () => { cancelled = true; };
  }, [user, toast, t]);

  // ---- starting an order ----------------------------------------------------

  const showCode = useCallback((row: GemOrder) => {
    setOrder(row);
    setExpired(false);
    setReview(false);
    setView('qr');
    try { trackEvent('gems_qr_shown', 'store', { package: row.package_name, credits: row.credits, price: row.price }); } catch { /* ignore */ }
  }, []);

  const startOrder = useCallback(async (pkg: CreditPackage) => {
    if (!user || starting) return;
    setStarting(pkg.id);
    try { trackEvent('gems_package_pick', 'store', { package: pkg.name, credits: pkg.credits, price: pkg.price }); } catch { /* ignore */ }
    try {
      const { data, error } = await supabase
        .from('gem_orders')
        .insert({
          user_id: user.id,
          package_id: pkg.id,
          package_name: pkg.name,
          credits: pkg.credits,
          price: pkg.price,
        })
        .select('id, package_name, credits, price, status, created_at, order_number')
        .single();
      if (error) throw error;
      setPending(null);
      showCode(data as GemOrder);
    } catch (e) {
      console.error('[CreditStore] start order:', e);
      toast({ title: t('billing.gems.startFailedTitle'), description: e instanceof Error ? e.message : t('billing.gems.tryAgain'), variant: 'destructive' });
    } finally {
      setStarting(null);
    }
  }, [user, starting, showCode, toast, t]);

  // ---- the QR, and waiting for the phone --------------------------------------

  useEffect(() => {
    if (view !== 'qr' || !order) { setQrDataUrl(null); return; }
    let cancelled = false;
    QRCode.toDataURL(buildGemsUrl(order.id), { width: 420, margin: 2, color: { dark: '#092145', light: '#ffffff' } })
      .then((d) => { if (!cancelled) setQrDataUrl(d); })
      .catch((e) => console.error('[CreditStore] QR failed', e));
    return () => { cancelled = true; };
  }, [view, order]);

  const landedRef = useRef(false);
  useEffect(() => {
    if (view !== 'qr' || !order) return;
    landedRef.current = false;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - new Date(order.created_at).getTime() > ORDER_TTL_MS) {
        setExpired(true);
        try { trackEvent('gems_qr_expired', 'store', { package: order.package_name }); } catch { /* ignore */ }
        return;
      }
      try {
        const { data } = await supabase
          .from('gem_orders')
          .select('status, credits, order_number')
          .eq('id', order.id)
          .maybeSingle();
        if (cancelled || !data) return;
        if (data.status === 'paid' && !landedRef.current) {
          landedRef.current = true;
          await Promise.all([fetchProfile(), fetchTransactions()]);
          const { data: fresh } = await supabase.from('profiles').select('credits').eq('user_id', user?.id ?? '').maybeSingle();
          const balance = typeof fresh?.credits === 'number' ? fresh.credits : null;
          setLanded({ credits: Number(data.credits), balance });
          setView('paid');
          toast({ title: t('billing.gems.addedTitle'), description: t('billing.gems.addedDesc', { amount: formatNumber(Number(data.credits)) }) });
          try { trackEvent('gems_paid', 'store', { package: order.package_name, credits: Number(data.credits), price: order.price, order: data.order_number }); } catch { /* ignore */ }
        } else if (data.status === 'review') {
          setReview(true);
        }
      } catch { /* try again next tick */ }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [view, order, user?.id, fetchProfile, fetchTransactions, toast, t]);

  const backToPacks = useCallback(() => {
    setView('packages');
    setOrder(null);
    setLanded(null);
  }, []);

  const focus = useTVFocus({
    focusableSelector: STORE_FOCUSABLE,
    initialFocusId: 'gems-back',
    scrollWhenStuck: true,
    onBack: () => { if (view === 'packages') onBack(); else backToPacks(); },
  });

  // Land the highlight somewhere useful when the view changes.
  useEffect(() => {
    const id = view === 'qr' ? 'gems-qr-back' : view === 'paid' ? 'gems-done' : 'gems-back';
    const timer = window.setTimeout(() => focus.focusById(id), 80);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const popularIndex = useMemo(() => (packages.length > 1 ? 1 : -1), [packages.length]);

  // ---- screens ----------------------------------------------------------------

  const header = (label: string, onPress: () => void, focusId: string) => (
    <div className={BACK_ROW}>
      <BackButton onClick={onPress} label={label} data-tv-focus-id={focusId} />
    </div>
  );

  if (view === 'paid' && landed) {
    return (
      <div ref={focus.containerRef} className="fixed inset-0 tv-scroll-container tv-safe text-white overflow-y-auto overscroll-contain">
        {header(t('billing.gems.backToDashboard'), onBack, 'gems-done-back')}
        <div className="max-w-2xl mx-auto pb-16">
          <Card className={`${PANEL} p-8 text-center`}>
            <div className="w-20 h-20 rounded-full [background:var(--gradient-gold)] mx-auto mb-5 flex items-center justify-center shadow-xl">
              <Check className="w-10 h-10 text-black/80" />
            </div>
            <h1 className="text-3xl font-quicksand font-bold mb-2">{t('billing.gems.addedTitle')}</h1>
            <p className="text-xl text-brand-ice mb-1">
              <Trans i18nKey="billing.gems.addedBody" values={{ amount: formatNumber(landed.credits) }} components={[<span key="amt" className="text-brand-gold font-semibold" />]} />
            </p>
            {landed.balance != null && (
              <p className="text-white/70 mb-6">{t('billing.gems.balanceNow', { amount: formatNumber(landed.balance) })}</p>
            )}
            <Button
              onClick={onBack}
              size="lg"
              data-tv-focus-id="gems-done"
              className="tv-ring tv-ring-contrast h-14 px-8 rounded-xl border-0 text-black font-semibold [background:var(--gradient-gold)] hover:brightness-110"
            >
              <Sparkles className="w-5 h-5 mr-2" /> {t('billing.gems.doneBtn')}
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  if (view === 'qr' && order) {
    return (
      <div ref={focus.containerRef} className="fixed inset-0 tv-scroll-container tv-safe text-white overflow-y-auto overscroll-contain">
        {header(t('billing.gems.chooseDifferent'), backToPacks, 'gems-qr-back')}
        <div className="max-w-5xl mx-auto pb-16 grid gap-6 md:grid-cols-[auto_1fr] items-start">
          <div className="bg-white p-4 rounded-2xl shadow-xl justify-self-center">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt={t('billing.gems.qrAlt')} className="w-[min(55vh,20rem)] h-[min(55vh,20rem)]" />
            ) : (
              <div className="w-[min(55vh,20rem)] h-[min(55vh,20rem)] flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-brand-navy animate-spin" />
              </div>
            )}
          </div>
          <Card className={`${PANEL} p-6`}>
            <p className="text-xs uppercase tracking-wide text-brand-gold/90 mb-1">{t('billing.gems.scanWithPhone')}</p>
            <h1 className="text-3xl font-quicksand font-bold mb-2">{order.package_name}</h1>
            <p className="text-2xl mb-4">
              <Trans i18nKey="billing.gems.priceFor" values={{ price: fmtMoney(order.price), amount: formatNumber(Number(order.credits)) }} components={[<span key="price" className="text-brand-gold font-bold" />, <span key="for" className="text-brand-ice/80 text-lg" />]} />
            </p>
            <ol className="space-y-2 text-white/85 mb-5">
              <li className="flex gap-3"><span className="text-brand-gold font-bold">1.</span> {t('billing.gems.step1')}</li>
              <li className="flex gap-3"><span className="text-brand-gold font-bold">2.</span> {t('billing.gems.step2')}</li>
              <li className="flex gap-3"><span className="text-brand-gold font-bold">3.</span> {t('billing.gems.step3')}</li>
            </ol>
            {expired ? (
              <div className="rounded-xl border border-amber-400/50 bg-amber-400/10 p-4 mb-4">
                <p className="font-semibold text-amber-200">{t('billing.gems.expiredTitle')}</p>
                <p className="text-white/75 text-sm">{t('billing.gems.expiredDesc')}</p>
              </div>
            ) : review ? (
              <div className="rounded-xl border border-brand-ice/30 bg-brand-ice/10 p-4 mb-4">
                <p className="font-semibold">{t('billing.gems.reviewTitle')}</p>
                <p className="text-white/75 text-sm">{t('billing.gems.reviewDesc')}</p>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-brand-ice/80 mb-4">
                <Loader2 className="w-4 h-4 animate-spin" /> {t('billing.gems.waiting')}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={backToPacks}
                variant="outline"
                size="lg"
                data-tv-focus-id="gems-qr-change"
                className="tv-ring h-12 rounded-xl border-brand-ice/30 bg-white/5 text-white"
              >
                <ArrowLeft className="w-4 h-4 mr-2" /> {t('billing.gems.differentPackBtn')}
              </Button>
              {expired && (
                <Button
                  onClick={() => {
                    const pkg = packages.find((p) => p.name === order.package_name);
                    if (pkg) void startOrder(pkg); else backToPacks();
                  }}
                  size="lg"
                  data-tv-focus-id="gems-qr-again"
                  className="tv-ring tv-ring-contrast h-12 rounded-xl border-0 text-black font-semibold [background:var(--gradient-gold)]"
                >
                  <RefreshCw className="w-4 h-4 mr-2" /> {t('billing.gems.newCodeBtn')}
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div ref={focus.containerRef} className="fixed inset-0 tv-scroll-container tv-safe text-white overflow-y-auto overscroll-contain">
      {header(t('common.back'), onBack, 'gems-back')}
      <div className="max-w-6xl mx-auto pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-4xl font-quicksand font-bold text-shadow-strong mb-1">{t('billing.gems.title')}</h1>
            <p className="text-xl text-brand-ice">{t('billing.gems.subtitle')}</p>
          </div>
          {profile && (
            <div className="rounded-2xl border border-brand-gold/50 bg-brand-gold/15 px-5 py-3">
              <div className="text-xs uppercase tracking-wide text-brand-gold/90">{t('billing.gems.yourBalance')}</div>
              <div className="text-2xl font-quicksand font-bold"><Trans i18nKey="billing.gems.balanceValue" values={{ amount: formatNumber(Number(profile.credits ?? 0)) }} components={[<span key="unit" className="text-base font-normal text-brand-ice" />]} /></div>
            </div>
          )}
        </div>

        {pending && (
          <Card className={`${PANEL} p-5 mb-6 flex flex-wrap items-center justify-between gap-4`}>
            <div>
              <p className="font-semibold">{t('billing.gems.pendingTitle', { name: pending.package_name, price: fmtMoney(pending.price) })}</p>
              <p className="text-brand-ice/75 text-sm">{t('billing.gems.pendingDesc')}</p>
            </div>
            <Button
              onClick={() => showCode(pending)}
              size="lg"
              data-tv-focus-id="gems-resume"
              className="tv-ring tv-ring-contrast h-12 rounded-xl border-0 text-black font-semibold [background:var(--gradient-gold)]"
            >
              {t('billing.gems.showCodeBtn')}
            </Button>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {loading ? (
            [...Array(4)].map((_, i) => (
              <Card key={i} className={`${PANEL} p-6 animate-pulse h-72`} />
            ))
          ) : packages.length === 0 ? (
            <Card className={`${PANEL} p-6 md:col-span-2 lg:col-span-4 text-center text-brand-ice/80`}>
              {t('billing.gems.noPacks')}
            </Card>
          ) : (
            packages.map((pkg, index) => {
              const Icon = iconFor(index);
              const popular = index === popularIndex;
              const busy = starting === pkg.id;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => void startOrder(pkg)}
                  disabled={!!starting}
                  data-tv-focus-id={`gems-pkg-${index}`}
                  className={`${PANEL} tv-ring relative text-left p-6 flex flex-col transition-transform duration-150 ease-out ${popular ? 'border-brand-gold/70' : ''}`}
                >
                  {popular && (
                    <span className="absolute top-3 right-3 text-[11px] font-bold uppercase tracking-wide bg-brand-gold text-black px-2 py-1 rounded-full">
                      {t('billing.gems.mostPopularChip')}
                    </span>
                  )}
                  <div className="w-14 h-14 rounded-2xl [background:var(--gradient-blue)] flex items-center justify-center mb-4 shadow-lg">
                    <Icon className="w-7 h-7 text-white" />
                  </div>
                  <h2 className="text-xl font-quicksand font-bold">{pkg.name}</h2>
                  <p className="text-3xl font-quicksand font-bold text-brand-gold my-1">{fmtMoney(pkg.price)}</p>
                  <p className="text-brand-ice mb-3">{t('billing.gems.gemsAmount', { amount: formatNumber(Number(pkg.credits)) })}</p>
                  {pkg.description && <p className="text-white/70 text-sm mb-3">{pkg.description}</p>}
                  <p className="text-xs text-white/55 mt-auto">
                    {t('billing.gems.approx', { images: formatNumber(Math.floor(pkg.credits)), chats: formatNumber(Math.floor(pkg.credits / 0.01)) })}
                  </p>
                  <span className="mt-4 inline-flex items-center justify-center h-11 rounded-xl border border-brand-gold/60 bg-brand-gold/15 text-brand-gold font-semibold">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : t('billing.gems.buyWithPhone')}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Focusable so Down from the last pack lands here and brings it on screen. */}
        <Card tabIndex={0} data-tv-focus-id="gems-info" className={`${PANEL} tv-ring p-6 mt-6`}>
          <h3 className="text-lg font-quicksand font-semibold text-brand-gold mb-3">{t('billing.gems.howTitle')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-white/80">
            <p><Trans i18nKey="billing.gems.howImage" components={[<strong key="b" className="text-white" />]} /></p>
            <p><Trans i18nKey="billing.gems.howChat" components={[<strong key="b" className="text-white" />]} /></p>
            <p>{t('billing.gems.howNoExpire')}</p>
            <p>{t('billing.gems.howPhone')}</p>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default CreditStore;
