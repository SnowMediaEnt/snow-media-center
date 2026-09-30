import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Trans, useTranslation } from 'react-i18next';
import { Check, Loader2, Monitor, ShoppingBag, Smartphone, Sparkles, Tv } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { AppManager } from '@/capacitor/AppManager';
import { trackEvent } from '@/lib/analytics';
import { supabase } from '@/integrations/supabase/client';
import { BackButton } from '@/components/ui/BackButton';
import SnowLoader from '@/components/SnowLoader';
import {
  STORE_ORIGIN, SERVICES, SERVICE_LABEL_KEYS, SERVICE_BLURB_KEYS,
  buildShelf, connectionsFor, createPhoneCheckoutUrl, deviceModels, durationsFor, durationText,
  fetchStoreProducts, fromPrice, money, quoteSetup,
  type CartLine, type DisplayOverride, type ServiceSlug, type ShelfItem, type StoreProduct, type TextRef,
} from '@/lib/store';

/**
 * TV storefront for the Snow Media store (snowmediaent.com).
 *
 * Two ways in:
 *   - BUILD A SETUP — the same guided flow as the website: pick a service,
 *     options (connections / duration), optionally a device (+ model), see the
 *     exact total, then check out on your phone via QR.
 *   - BROWSE — Devices / Services / Accessories shelves; each item opens a
 *     detail panel with its variant picker and the same phone checkout.
 *
 * Checkout happens on the customer's PHONE: the TV asks the store to save a
 * cart (variant-aware; the store re-prices server-side) and QRs
 * /checkout?cart=<id>. When the viewer is signed into SMC their email and user
 * id ride along so the order lands on their customer record — the app's
 * "My Devices & Services" and a provisioning ticket appear automatically.
 *
 * What the TV shows for each item (title, blurb, badge, image, shelf, order,
 * hidden) is editable in SMC Hub → Store (`store_display`).
 */

type Tab = 'build' | 'device' | 'service' | 'accessory';
// Values the screen compares with (not text to translate).
const BUILD_TAB: Tab = 'build';
const VIBEZTV: ServiceSlug = 'vibeztv';
const PLEX: ServiceSlug = 'plex';
// Text keys (translated when drawn), never text: a constant would go stale on a language change.
const TABS: Array<{ id: Tab; labelKey: string }> = [
  { id: 'build', labelKey: 'store.tabs.buildTab' },
  { id: 'device', labelKey: 'store.tabs.devicesTab' },
  { id: 'service', labelKey: 'store.tabs.servicesTab' },
  { id: 'accessory', labelKey: 'store.tabs.accessoriesTab' },
];

interface Focusable { key: string; onEnter: () => void }
interface Focus { r: number; c: number }
const GRID_COLS = 3;
// Matches the `grid-cols-2` the device tiles render in — see the rows builder.
const DEVICE_COLS = 2;

interface Props { onBack: () => void }

const StoreScreen = memo(({ onBack }: Props) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useAuth();

  // ── Data ────────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<StoreProduct[] | null>(null);
  const [overrides, setOverrides] = useState<DisplayOverride[]>([]);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const [rows, disp] = await Promise.all([
          fetchStoreProducts(ac.signal),
          supabase.from('store_display').select('product_slug,title,blurb,badge,image_url,group_kind,sort,hidden,highlight')
            .then((r) => (r.data as DisplayOverride[] | null) ?? []),
        ]);
        if (cancelled) return;
        setProducts(rows);
        setOverrides(disp);
      } catch (e) {
        console.error('[Store] load failed:', e);
        if (!cancelled) { setLoadError(true); setProducts([]); }
      }
    })();
    try { trackEvent('store_open', 'store', {}); } catch { /* ignore */ }
    return () => { cancelled = true; ac.abort(); };
  }, []);

  const shelf = useMemo(() => buildShelf(products ?? [], overrides), [products, overrides]);
  const byGroup = useMemo(() => ({
    device: shelf.filter((s) => s.group === 'device'),
    service: shelf.filter((s) => s.group === 'service'),
    accessory: shelf.filter((s) => s.group === 'accessory' || s.group === 'digital'),
  }), [shelf]);
  const plans = useMemo(() => (products ?? []).filter((p) => p.category === 'plan'), [products]);
  const devices = useMemo(() => byGroup.device.map((s) => s.product), [byGroup.device]);

  // ── View state ─────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('build');
  const [detail, setDetail] = useState<ShelfItem | null>(null);
  const [detailChoice, setDetailChoice] = useState<Record<string, string>>({});
  const [detailLabel, setDetailLabel] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrBusy, setQrBusy] = useState(false);

  // Build-a-setup state (mirrors the website's SetupBuilder).
  const [service, setService] = useState<ServiceSlug>('dreamstreams');
  const [connections, setConnections] = useState<string | null>('2');
  const [duration, setDuration] = useState<string>('12 months');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);

  const plan = plans.find((p) => p.slug === service);
  const device = devices.find((d) => d.id === deviceId) ?? null;
  const connectionOptions = useMemo(
    () => (service === 'dreamstreams' ? (connectionsFor(plan).length ? connectionsFor(plan) : ['2', '6']) : []),
    [service, plan],
  );
  const durationOptions = durationsFor(service, plan);
  const models = useMemo(() => (device ? deviceModels(device) : []), [device]);
  const quote = useMemo(
    () => quoteSetup({ service, plan, connections: connectionOptions.length ? connections : null, duration, device, model }),
    [service, plan, connections, connectionOptions.length, duration, device, model],
  );

  const selectService = useCallback((s: ServiceSlug) => {
    setService(s);
    setConnections('2');
    setDuration('12 months');
  }, []);

  // ── Checkout ───────────────────────────────────────────────────────────
  const openCheckout = useCallback(async (lines: CartLine[], fallbackSlug: string | undefined, what: string) => {
    if (qrBusy) return;
    setQrBusy(true);
    try {
      const { url, viaCart } = await createPhoneCheckoutUrl({
        lines, fallbackSlug, email: user?.email ?? null, smcUserId: user?.id ?? null,
      });
      const dataUrl = await QRCode.toDataURL(url, { width: 360, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
      setQrUrl(dataUrl);
      try { trackEvent('store_checkout_qr', 'store', { what, viaCart, lines: lines.length }); } catch { /* ignore */ }
    } catch (e) {
      console.error('[Store] QR failed:', e);
      toast({ title: t('store.toast.qrFailedTitle'), description: t('store.toast.qrFailedDesc'), variant: 'destructive' });
    } finally {
      setQrBusy(false);
    }
  }, [qrBusy, toast, t, user?.email, user?.id]);

  const openOnDevice = useCallback(async () => {
    try { await AppManager.openUrl({ url: `${STORE_ORIGIN}/plans?src=smc-tv` }); }
    catch { toast({ title: t('store.toast.noBrowserTitle'), description: t('store.toast.noBrowserDesc') }); }
  }, [toast, t]);

  // ── Detail variant helpers ─────────────────────────────────────────────
  const detailVariants = useMemo(() => detail?.product.variants ?? [], [detail]);
  const detailChoiceKeys = useMemo(() => {
    const keys: string[] = [];
    for (const v of detailVariants) for (const k of Object.keys(v.choices ?? {})) if (!keys.includes(k)) keys.push(k);
    return keys;
  }, [detailVariants]);
  const detailChoiceValues = useCallback((key: string) => {
    const vals: string[] = [];
    for (const v of detailVariants) { const x = v.choices?.[key]; if (x && !vals.includes(x)) vals.push(x); }
    return vals;
  }, [detailVariants]);
  const detailVariant = useMemo(() => {
    if (!detail) return undefined;
    if (detailChoiceKeys.length) {
      return detailVariants.find((v) => detailChoiceKeys.every((k) => !detailChoice[k] || v.choices?.[k] === detailChoice[k])
        && detailChoiceKeys.every((k) => !!detailChoice[k]));
    }
    if (detailVariants.length > 1) return detailVariants.find((v) => v.label === detailLabel);
    return detailVariants[0];
  }, [detail, detailVariants, detailChoiceKeys, detailChoice, detailLabel]);
  const detailPrice = detail ? (detailVariant?.tbd ? null : (detailVariant?.price ?? fromPrice(detail.product))) : null;

  const openDetail = useCallback((item: ShelfItem) => {
    setDetail(item);
    // Preselect the first value of every choice so a price shows immediately.
    const first: Record<string, string> = {};
    const keys: string[] = [];
    for (const v of item.product.variants) for (const k of Object.keys(v.choices ?? {})) if (!keys.includes(k)) keys.push(k);
    for (const k of keys) { const v = item.product.variants.find((x) => x.choices?.[k]); if (v?.choices?.[k]) first[k] = v.choices[k]; }
    setDetailChoice(first);
    setDetailLabel(item.product.variants[0]?.label ?? null);
  }, []);

  // ── Focus rows (recomputed each render; refs keep the key handler stable) ─
  const rows: Focusable[][] = useMemo(() => {
    const backRow: Focusable[] = [{ key: 'back', onEnter: onBack }];
    if (detail) {
      const out: Focusable[][] = [[{ key: 'detail-back', onEnter: () => setDetail(null) }]];
      for (const k of detailChoiceKeys) {
        out.push(detailChoiceValues(k).map((val) => ({ key: `choice:${k}:${val}`, onEnter: () => setDetailChoice((c) => ({ ...c, [k]: val })) })));
      }
      if (!detailChoiceKeys.length && detailVariants.length > 1) {
        out.push(detailVariants.map((v) => ({ key: `label:${v.label}`, onEnter: () => setDetailLabel(v.label) })));
      }
      out.push([
        { key: 'detail-checkout', onEnter: () => { if (!detail) return; void openCheckout([{ productId: detail.product.id, variantLabel: detailVariant?.label, qty: 1 }], detail.product.slug, detail.product.slug); } },
        { key: 'open-site', onEnter: () => void openOnDevice() },
      ]);
      return out;
    }
    const tabsRow: Focusable[] = [...backRow, ...TABS.map((tb) => ({ key: `tab:${tb.id}`, onEnter: () => setTab(tb.id) }))];
    if (tab === 'build') {
      const out: Focusable[][] = [tabsRow];
      // Services render in a three-column grid — same rule as the devices.
      const svcCells: Focusable[] = SERVICES.map((s) => ({ key: `svc:${s}`, onEnter: () => selectService(s) }));
      for (let i = 0; i < svcCells.length; i += GRID_COLS) out.push(svcCells.slice(i, i + GRID_COLS));
      if (connectionOptions.length > 1) out.push(connectionOptions.map((c) => ({ key: `conn:${c}`, onEnter: () => setConnections(c) })));
      out.push(durationOptions.map((d) => ({ key: `dur:${d}`, onEnter: () => setDuration(d) })));
      // The device tiles render in a TWO-COLUMN grid (dev:none is the first
      // cell), so they must be modelled as one focus row per visual line. As a
      // single row, Down from the top-left tile skipped the whole grid and
      // landed on Checkout, and the only way to reach the second line was to
      // keep pressing Right.
      const deviceCells: Focusable[] = [
        { key: 'dev:none', onEnter: () => { setDeviceId(null); setModel(null); } },
        ...devices.map((d) => ({ key: `dev:${d.id}`, onEnter: () => { setDeviceId(d.id); setModel(null); } })),
      ];
      for (let i = 0; i < deviceCells.length; i += DEVICE_COLS) out.push(deviceCells.slice(i, i + DEVICE_COLS));
      if (models.length) out.push(models.map((m) => ({ key: `model:${m}`, onEnter: () => setModel(m) })));
      out.push([
        { key: 'build-checkout', onEnter: () => { if (quote.canCheckout) void openCheckout(quote.cart, plan?.slug, 'setup'); } },
        { key: 'open-site', onEnter: () => void openOnDevice() },
      ]);
      return out;
    }
    const items = tab === 'device' ? byGroup.device : tab === 'service' ? byGroup.service : byGroup.accessory;
    const out: Focusable[][] = [tabsRow];
    for (let i = 0; i < items.length; i += GRID_COLS) {
      out.push(items.slice(i, i + GRID_COLS).map((it) => ({ key: `item:${it.product.id}`, onEnter: () => openDetail(it) })));
    }
    return out;
  }, [detail, detailChoiceKeys, detailChoiceValues, detailVariants, detailVariant, tab, connectionOptions, durationOptions, devices, models, quote, plan?.slug, byGroup, onBack, openCheckout, openOnDevice, openDetail, selectService]);

  const [focus, setFocus] = useState<Focus>({ r: 0, c: 0 });
  const rowsRef = useRef(rows); useEffect(() => { rowsRef.current = rows; }, [rows]);
  const focusRef = useRef(focus); useEffect(() => { focusRef.current = focus; }, [focus]);
  const qrRef = useRef(qrUrl); useEffect(() => { qrRef.current = qrUrl; }, [qrUrl]);
  const detailRef = useRef(detail); useEffect(() => { detailRef.current = detail; }, [detail]);

  // Reset focus when the view changes; clamp when rows shrink.
  useEffect(() => { setFocus(detail ? { r: 0, c: 0 } : { r: 0, c: 1 }); }, [detail, tab]);
  useEffect(() => {
    const f = focusRef.current;
    const r = Math.min(f.r, rows.length - 1);
    const c = Math.min(f.c, (rows[r]?.length ?? 1) - 1);
    if (r !== f.r || c !== f.c) setFocus({ r: Math.max(0, r), c: Math.max(0, c) });
  }, [rows]);

  const focusedKey = rows[focus.r]?.[focus.c]?.key ?? null;
  const isF = (key: string) => focusedKey === key && !qrUrl;

  useEffect(() => {
    if (!focusedKey) return;
    const el = document.querySelector<HTMLElement>(`[data-store-key="${CSS.escape(focusedKey)}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusedKey]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape', 'Backspace'];
      if (!keys.includes(e.key) && e.keyCode !== 4 && e.keyCode !== 23) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      const isOk = e.key === 'Enter' || e.key === ' ' || e.keyCode === 23;
      if (qrRef.current) { if (isBack || isOk) setQrUrl(null); return; }
      if (isBack) { if (detailRef.current) setDetail(null); else onBack(); return; }
      const rs = rowsRef.current;
      const f = focusRef.current;
      if (isOk) { rs[f.r]?.[f.c]?.onEnter(); return; }
      if (e.key === 'ArrowUp' && f.r > 0) { const r = f.r - 1; setFocus({ r, c: Math.min(f.c, rs[r].length - 1) }); }
      else if (e.key === 'ArrowDown' && f.r < rs.length - 1) { const r = f.r + 1; setFocus({ r, c: Math.min(f.c, rs[r].length - 1) }); }
      else if (e.key === 'ArrowLeft' && f.c > 0) setFocus({ r: f.r, c: f.c - 1 });
      else if (e.key === 'ArrowRight' && f.c < (rs[f.r]?.length ?? 1) - 1) setFocus({ r: f.r, c: f.c + 1 });
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onBack]);

  // ── Render helpers ─────────────────────────────────────────────────────
  /** A catalog string as it is, or a text of ours translated now. */
  const shown = (x: string | TextRef): string => (typeof x === 'string' ? x : t(x.key, x.params));
  const badgeOf = (it: ShelfItem): string | null => it.badge ?? (it.bestValue ? t('store.shelf.bestValueBadge') : null);
  const pill = (key: string, label: string, selected: boolean, onClick: () => void, sub?: string | null) => (
    <button
      key={key}
      type="button"
      data-store-key={key}
      data-focused={isF(key) ? 'true' : 'false'}
      onClick={onClick}
      className={`tv-ring min-h-12 px-5 py-3 rounded-xl border text-left font-nunito text-base transition-transform duration-150 ease-out ${
        selected ? 'bg-brand-gold/20 border-brand-gold text-white' : 'bg-white/5 border-white/10 text-brand-ice/90'
      } ${isF(key) ? 'scale-105 z-10' : ''}`}
    >
      <span className="flex items-center gap-2">
        {selected && <Check className="w-4 h-4 text-brand-gold" />}
        <span className="font-semibold">{label}</span>
      </span>
      {sub && <span className="block text-xs text-brand-ice/70 mt-0.5">{sub}</span>}
    </button>
  );

  const sectionTitle = (n: number, title: string) => (
    <div className="flex items-center gap-3 mb-4">
      <span className="flex w-8 h-8 items-center justify-center rounded-full bg-brand-gold/20 text-brand-gold text-sm font-bold font-quicksand">{n}</span>
      <h3 className="text-xl font-quicksand font-semibold text-white/90">{title}</h3>
    </div>
  );

  const cardCls = (key: string, extra = '') =>
    `tv-ring rounded-2xl bg-slate-900/70 border border-white/10 overflow-hidden cursor-pointer transition-transform duration-150 ease-out ${isF(key) ? 'scale-105 z-10' : ''} ${extra}`;

  const currentItems = tab === 'device' ? byGroup.device : tab === 'service' ? byGroup.service : byGroup.accessory;

  return (
    <div className="min-h-screen flex flex-col text-white bg-gradient-to-b from-slate-950 to-slate-900">
      {/* Header + tabs */}
      <div className="px-6 pt-4 pb-3 border-b border-white/10 bg-black/30 flex-shrink-0">
        <div className="flex items-center gap-4">
          <BackButton onClick={onBack} label={t('common.back')} focused={isF('back')} data-store-key="back" />
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-7 h-7 text-brand-gold" />
            <h1 className="text-2xl font-quicksand font-bold">{t('store.header.title')}</h1>
          </div>
          <p className="ml-auto text-sm text-brand-ice/70 font-nunito hidden md:block">
            {t('store.header.subtitle')}
          </p>
        </div>
        {!detail && (
          <div className="mt-4 flex gap-3">
            {TABS.map((tb) => (
              <button
                key={tb.id}
                type="button"
                data-store-key={`tab:${tb.id}`}
                data-focused={isF(`tab:${tb.id}`) ? 'true' : 'false'}
                title={t(tb.labelKey)}
                onClick={() => setTab(tb.id)}
                className={`tv-ring h-12 px-5 min-w-0 truncate rounded-xl font-quicksand font-semibold text-base transition-transform duration-150 ease-out ${
                  // The selected tab is a solid gold fill, and D-pad focus
                  // lands on it first — a gold ring there is invisible, so the
                  // highlight looked like it had vanished. White ring instead.
                  tab === tb.id ? 'tv-ring-contrast bg-brand-gold text-brand-navy' : 'bg-white/10 text-white'
                } ${isF(`tab:${tb.id}`) ? 'scale-105 z-10' : ''}`}
              >
                {tb.id === BUILD_TAB && <Sparkles className="w-4 h-4 inline mr-2 -mt-0.5" />}
                {t(tb.labelKey)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {products === null && (
          <div className="flex items-center justify-center py-20"><div className="w-full max-w-md"><SnowLoader size="md" label={t('store.loading')} /></div></div>
        )}
        {products !== null && loadError && (
          <p className="text-center text-brand-ice/70 py-16 font-nunito text-base">
            <Trans i18nKey="store.loadError" components={{ 1: <span className="text-brand-gold" /> }} />
          </p>
        )}

        {/* ── BUILD A SETUP ── */}
        {products !== null && !loadError && !detail && tab === BUILD_TAB && (
          <div className="max-w-6xl mx-auto grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="space-y-6">
              <section className="rounded-2xl bg-slate-900/60 border border-white/10 p-6">
                {sectionTitle(1, t('store.build.pickService'))}
                <div className="grid grid-cols-3 gap-4 p-1">
                  {SERVICES.map((s) => {
                    const key = `svc:${s}`; const sel = service === s; const p = plans.find((x) => x.slug === s);
                    return (
                      <button key={key} type="button" data-store-key={key} data-focused={isF(key) ? 'true' : 'false'} onClick={() => selectService(s)}
                        className={`tv-ring rounded-2xl border p-5 text-left transition-transform duration-150 ease-out ${sel ? 'bg-brand-gold/20 border-brand-gold' : 'bg-white/5 border-white/10'} ${isF(key) ? 'scale-105 z-10' : ''}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-base font-quicksand font-bold">{t(SERVICE_LABEL_KEYS[s])}</p>
                          {sel && <Check className="w-5 h-5 text-brand-gold" />}
                        </div>
                        <p className="mt-2 text-sm text-brand-ice/70 font-nunito leading-snug">{t(SERVICE_BLURB_KEYS[s])}</p>
                        <p className="mt-3 text-sm font-semibold text-brand-gold">{p ? t('store.shelf.fromPrice', { price: money(fromPrice(p)) }) : ''}</p>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl bg-slate-900/60 border border-white/10 p-6">
                {sectionTitle(2, t('store.build.options'))}
                {connectionOptions.length > 1 && (
                  <div className="mb-5">
                    <p className="text-xs uppercase tracking-wide text-brand-ice/70 mb-3">{t('store.build.connections')}</p>
                    <div className="flex flex-wrap gap-3 p-1">
                      {connectionOptions.map((c) => pill(`conn:${c}`, t('store.build.connectionsOption', { count: Number(c) || 0 }), connections === c, () => setConnections(c)))}
                    </div>
                  </div>
                )}
                {service === VIBEZTV && <p className="mb-5 text-sm text-brand-ice/70 font-nunito">{t('store.build.nineIncluded')}</p>}
                <p className="text-xs uppercase tracking-wide text-brand-ice/70 mb-3">{t('store.build.duration')}</p>
                <div className="flex flex-wrap gap-3 p-1">
                  {durationOptions.map((d) => {
                    const v = plan?.variants.find((x) => x.choices?.duration === d && (service !== 'dreamstreams' || x.choices?.connections === connections));
                    const sub = v?.tbd ? t('store.shelf.pricingOnRequest') : v ? money(v.price) : null;
                    return pill(`dur:${d}`, shown(durationText(d)), duration === d, () => setDuration(d), sub);
                  })}
                </div>
              </section>

              <section className="rounded-2xl bg-slate-900/60 border border-white/10 p-6">
                {sectionTitle(3, t('store.build.addDevice'))}
                <div className="grid grid-cols-2 gap-4 p-1">
                  <button type="button" data-store-key="dev:none" data-focused={isF('dev:none') ? 'true' : 'false'} onClick={() => { setDeviceId(null); setModel(null); }}
                    className={`tv-ring rounded-2xl border p-5 text-left transition-transform duration-150 ease-out ${deviceId === null ? 'bg-brand-gold/20 border-brand-gold' : 'bg-white/5 border-white/10'} ${isF('dev:none') ? 'scale-105 z-10' : ''}`}>
                    <p className="flex items-center gap-2 text-base font-quicksand font-bold"><Tv className="w-5 h-5 text-brand-gold" /> {t('store.build.ownDevice')}</p>
                    <p className="mt-2 text-sm text-brand-ice/70 font-nunito">{t('store.build.ownDeviceDesc')}</p>
                  </button>
                  {byGroup.device.map((it) => {
                    const d = it.product; const key = `dev:${d.id}`; const sel = deviceId === d.id;
                    return (
                      <button key={key} type="button" data-store-key={key} data-focused={isF(key) ? 'true' : 'false'} onClick={() => { setDeviceId(d.id); setModel(null); }}
                        className={`tv-ring rounded-2xl border p-5 text-left transition-transform duration-150 ease-out ${sel ? 'bg-brand-gold/20 border-brand-gold' : 'bg-white/5 border-white/10'} ${isF(key) ? 'scale-105 z-10' : ''}`}>
                        <div className="flex items-center gap-4">
                          {it.image ? <img src={it.image} alt="" loading="lazy" decoding="async" className="w-16 h-16 rounded-lg object-cover border border-white/10" />
                            : <div className="w-16 h-16 rounded-lg bg-slate-800 flex items-center justify-center"><Monitor className="w-7 h-7 text-white/30" /></div>}
                          <div className="min-w-0">
                            <p className="text-base font-quicksand font-bold truncate">{it.title}</p>
                            <p className="text-sm text-brand-gold font-semibold">{t('store.shelf.fromPrice', { price: money(fromPrice(d)) })}</p>
                            {badgeOf(it) && <span className="inline-block mt-1 px-2 py-1 rounded-lg bg-brand-gold/20 text-brand-gold text-xs font-bold">{badgeOf(it)}</span>}
                          </div>
                        </div>
                        {it.blurb && <p className="mt-3 text-sm text-brand-ice/70 font-nunito line-clamp-2">{it.blurb}</p>}
                      </button>
                    );
                  })}
                </div>
                {device && models.length > 0 && (
                  <div className="mt-5">
                    <p className="text-xs uppercase tracking-wide text-brand-ice/70 mb-3">{t('store.build.model')}</p>
                    <div className="flex flex-wrap gap-3 p-1">
                      {models.map((m) => pill(`model:${m}`, m, (model ?? models[0]) === m, () => setModel(m)))}
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* Summary */}
            <aside className="rounded-2xl bg-slate-900/80 border border-brand-gold/30 p-6 h-fit lg:sticky lg:top-0">
              <h3 className="text-xl font-quicksand font-semibold text-white/90">{t('store.summary.title')}</h3>
              <ul className="mt-4 space-y-3">
                {quote.lines.map((l, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 text-sm font-nunito">
                    <span className={l.free ? 'text-brand-gold' : ''}>
                      {shown(l.name)}
                      {l.detail && <span className="block text-xs text-brand-ice/70">{shown(l.detail)}</span>}
                    </span>
                    <span className={`font-bold whitespace-nowrap ${l.free ? 'text-brand-gold' : ''}`}>{l.free ? money(0) : quote.serviceTbd && !quote.isBundle && !l.free && l.price === 0 ? t('store.summary.askUs') : money(l.price)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 pt-4 border-t border-white/10 flex items-baseline justify-between">
                <span className="text-sm text-brand-ice/70 font-nunito">{t('store.summary.total')}</span>
                <span className="text-3xl font-quicksand font-bold text-brand-gold">{quote.serviceTbd && !quote.isBundle ? t('store.summary.contactUs') : money(quote.total)}</span>
              </div>
              {quote.returningTotal !== null && (
                <p className="mt-2 text-sm font-nunito text-brand-ice/90"><Trans i18nKey="store.summary.returning" values={{ price: money(quote.returningTotal) }} components={{ 1: <span className="text-brand-gold font-semibold" /> }} /></p>
              )}
              {!quote.isBundle && device && service !== PLEX && (
                <p className="mt-3 rounded-xl border border-brand-gold/40 bg-brand-gold/10 px-3 py-2 text-xs text-brand-gold font-nunito">{t('store.summary.goYearly')}</p>
              )}
              <div className="mt-5 grid gap-3">
                <button type="button" data-store-key="build-checkout" data-focused={isF('build-checkout') ? 'true' : 'false'}
                  onClick={() => { if (quote.canCheckout) void openCheckout(quote.cart, plan?.slug, 'setup'); }}
                  disabled={!quote.canCheckout}
                  className={`tv-ring tv-ring-contrast h-12 px-5 rounded-xl font-quicksand font-bold text-base bg-brand-gold text-brand-navy transition-transform duration-150 ease-out disabled:opacity-50 ${isF('build-checkout') ? 'scale-105 z-10' : ''}`}>
                  {qrBusy ? <Loader2 className="w-5 h-5 animate-spin inline" /> : <Smartphone className="w-5 h-5 inline mr-2 -mt-0.5" />}
                  <span className="min-w-0 truncate">{t('store.summary.checkoutBtn')}</span>
                </button>
                <button type="button" data-store-key="open-site" data-focused={isF('open-site') ? 'true' : 'false'} onClick={() => void openOnDevice()}
                  className={`tv-ring h-12 px-5 rounded-xl font-nunito text-sm bg-white/10 text-white transition-transform duration-150 ease-out ${isF('open-site') ? 'scale-105 z-10' : ''}`}>
                  <span className="min-w-0 truncate" title={t('store.summary.openSiteBtn')}>{t('store.summary.openSiteBtn')}</span>
                </button>
              </div>
              <p className="mt-4 text-xs text-brand-ice/60 font-nunito">{t('store.summary.hint')}</p>
            </aside>
          </div>
        )}

        {/* ── BROWSE SHELVES ── */}
        {products !== null && !loadError && !detail && tab !== BUILD_TAB && (
          currentItems.length === 0 ? (
            <p className="text-center text-brand-ice/70 py-16 font-nunito text-base">{t('store.shelf.empty')}</p>
          ) : (
            <div className="grid grid-cols-3 gap-4 max-w-5xl mx-auto p-1" data-howto="store.grid">
              {currentItems.map((it) => {
                const key = `item:${it.product.id}`;
                return (
                  <div key={key} data-store-key={key} data-focused={isF(key) ? 'true' : 'false'} onClick={() => openDetail(it)}
                    className={cardCls(key, it.highlight ? 'border-brand-gold/40' : '')}>
                    {it.image ? (
                      <img src={it.image} alt={it.title} className="w-full h-40 object-cover" loading="lazy" decoding="async" />
                    ) : (
                      <div className="w-full h-40 flex items-center justify-center bg-slate-800"><ShoppingBag className="w-10 h-10 text-white/25" /></div>
                    )}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-quicksand font-semibold text-base leading-tight">{it.title}</p>
                        {badgeOf(it) && <span className="shrink-0 px-2 py-1 rounded-lg bg-brand-gold/20 text-brand-gold text-xs font-bold">{badgeOf(it)}</span>}
                      </div>
                      {it.blurb && <p className="mt-1 text-sm text-brand-ice/70 font-nunito line-clamp-2">{it.blurb}</p>}
                      <p className="mt-2 text-brand-gold font-bold text-base">{it.product.variants.length > 1 ? t('store.shelf.fromPrice', { price: money(fromPrice(it.product)) }) : money(fromPrice(it.product))}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* ── DETAIL ── */}
        {detail && !qrUrl && (
          <div className="max-w-5xl mx-auto">
            <div className="mb-6">
              <button type="button" data-store-key="detail-back" data-focused={isF('detail-back') ? 'true' : 'false'} onClick={() => setDetail(null)}
                className={`tv-ring h-12 px-5 rounded-xl font-nunito text-base bg-white/10 text-white transition-transform duration-150 ease-out ${isF('detail-back') ? 'scale-105 z-10' : ''}`}>
                {t('store.detail.backTo', { section: t(TABS.find((tb) => tb.id === tab)?.labelKey ?? 'store.header.title') })}
              </button>
            </div>
            <div className="grid md:grid-cols-[minmax(0,1fr)_1.6fr] gap-8 items-start">
              {detail.image ? (
                <img src={detail.image} alt={detail.title} className="w-full rounded-2xl border border-white/10 object-cover" />
              ) : (
                <div className="w-full h-64 rounded-2xl bg-slate-800 flex items-center justify-center"><ShoppingBag className="w-14 h-14 text-white/25" /></div>
              )}
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-3xl font-quicksand font-bold">{detail.title}</h2>
                  {badgeOf(detail) && <span className="px-2 py-1 rounded-lg bg-brand-gold/20 text-brand-gold text-xs font-bold">{badgeOf(detail)}</span>}
                </div>
                <p className="mt-2 text-2xl text-brand-gold font-bold">{detailPrice === null ? t('store.detail.contactPricing') : money(detailPrice)}</p>
                {detail.blurb && <p className="mt-3 text-base text-brand-ice/90 font-nunito whitespace-pre-wrap">{detail.blurb}</p>}
                {detail.product.features.length > 0 && (
                  <ul className="mt-4 space-y-1.5">
                    {detail.product.features.slice(0, 6).map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-brand-ice/90 font-nunito"><Check className="w-4 h-4 mt-0.5 text-brand-gold flex-shrink-0" /> {f}</li>
                    ))}
                  </ul>
                )}

                {detailChoiceKeys.map((k) => (
                  <div key={k} className="mt-5">
                    <p className="text-xs uppercase tracking-wide text-brand-ice/70 mb-3">{k === 'duration' ? t('store.build.duration') : k === 'connections' ? t('store.build.connections') : k === 'credits' ? t('store.detail.creditPack') : k}</p>
                    <div className="flex flex-wrap gap-3 p-1">
                      {detailChoiceValues(k).map((val) => {
                        const v = detailVariants.find((x) => x.choices?.[k] === val && detailChoiceKeys.every((kk) => kk === k || !detailChoice[kk] || x.choices?.[kk] === detailChoice[kk]));
                        return pill(`choice:${k}:${val}`, k === 'duration' ? shown(durationText(val)) : val, detailChoice[k] === val, () => setDetailChoice((c) => ({ ...c, [k]: val })), v ? (v.tbd ? t('store.shelf.pricingOnRequest') : money(v.price)) : null);
                      })}
                    </div>
                  </div>
                ))}
                {!detailChoiceKeys.length && detailVariants.length > 1 && (
                  <div className="mt-5">
                    <p className="text-xs uppercase tracking-wide text-brand-ice/70 mb-3">{t('store.build.options')}</p>
                    <div className="flex flex-wrap gap-3 p-1">
                      {detailVariants.map((v) => pill(`label:${v.label}`, v.label, detailLabel === v.label, () => setDetailLabel(v.label), v.tbd ? t('store.shelf.pricingOnRequest') : money(v.price)))}
                    </div>
                  </div>
                )}

                <div className="mt-6 flex gap-3 flex-wrap p-1">
                  <button type="button" data-store-key="detail-checkout" data-focused={isF('detail-checkout') ? 'true' : 'false'}
                    onClick={() => void openCheckout([{ productId: detail.product.id, variantLabel: detailVariant?.label, qty: 1 }], detail.product.slug, detail.product.slug)}
                    className={`tv-ring tv-ring-contrast h-12 px-6 rounded-xl font-quicksand font-bold text-base bg-brand-gold text-brand-navy transition-transform duration-150 ease-out ${isF('detail-checkout') ? 'scale-105 z-10' : ''}`}>
                    {qrBusy ? <Loader2 className="w-5 h-5 animate-spin inline" /> : <Smartphone className="w-5 h-5 inline mr-2 -mt-0.5" />}
                    <span className="min-w-0 truncate">{t('store.detail.buyBtn')}</span>
                  </button>
                  <button type="button" data-store-key="open-site" data-focused={isF('open-site') ? 'true' : 'false'} onClick={() => void openOnDevice()}
                    className={`tv-ring h-12 px-5 rounded-xl font-nunito text-base bg-white/10 text-white transition-transform duration-150 ease-out ${isF('open-site') ? 'scale-105 z-10' : ''}`}>
                    <span className="min-w-0 truncate" title={t('store.detail.openSiteBtn')}>{t('store.detail.openSiteBtn')}</span>
                  </button>
                </div>
                <p className="mt-4 text-xs text-brand-ice/60 font-nunito">{t('store.detail.hint')}</p>
              </div>
            </div>
          </div>
        )}

        {/* ── QR OVERLAY ── */}
        {qrUrl && (
          <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-8">
            <div className="bg-white rounded-3xl p-5"><img src={qrUrl} alt={t('store.qr.alt')} className="w-72 h-72" /></div>
            <p className="mt-6 text-2xl font-quicksand font-bold text-center">{t('store.qr.scan')}</p>
            <div className="mt-3 max-w-lg text-center font-nunito text-base text-brand-ice/90 space-y-2">
              {user?.email ? (
                <>
                  <p><Trans i18nKey="store.qr.linkedTo" values={{ email: user.email }} components={{ 1: <span className="text-brand-gold font-semibold" /> }} /></p>
                  <p className="text-sm text-brand-ice/70">{t('store.qr.noAccountYet')}</p>
                </>
              ) : (
                <>
                  <p>{t('store.qr.createAccount')}</p>
                  <p className="text-sm text-brand-ice/70">{t('store.qr.createAccountWhy')}</p>
                </>
              )}
              <p className="text-sm text-brand-ice/70">{t('store.qr.loginsInTicket')}</p>
            </div>
            <p className="mt-5 text-xs text-brand-ice/60 font-nunito">{t('store.qr.close')}</p>
          </div>
        )}
      </div>
    </div>
  );
});

StoreScreen.displayName = 'StoreScreen';
export default StoreScreen;
