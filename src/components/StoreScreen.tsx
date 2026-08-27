import { memo, useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2, ShoppingBag, Smartphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { AppManager } from '@/capacitor/AppManager';
import { trackEvent } from '@/lib/analytics';
import { BackButton } from '@/components/ui/BackButton';

/**
 * TV storefront for the Snow Media store (snowmediaent.com, Lovable-built).
 *
 * Products are read straight from the store's own Supabase project — its
 * `products` table is public for active rows ("Active products are public"
 * RLS policy), so a plain REST call with the publishable key works from any
 * device with no store account. Checkout happens on the customer's PHONE via
 * QR: the TV asks the store to save a cart (public tv-cart endpoint) and QRs
 * `/checkout?cart=<id>`, which the store's checkout page already restores.
 * When the customer is signed into SMC, their email rides along so the order
 * lands on their store account (orders are email-keyed).
 */

const STORE_ORIGIN = 'https://snowmediaent.com';
// The store's OWN Supabase project (separate from the SMC shared project).
const STORE_SUPABASE_URL = 'https://cxetqtmuqfebayppfrwr.supabase.co';
const STORE_ANON_KEY = 'sb_publishable_P5-WG9FerWWVyep8jdv11w_o08HCaLy';

interface StoreProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  currency: string;
  category: string | null;
  image_url: string | null;
  featured: boolean;
  sort: number;
}

interface Props {
  onBack: () => void;
}

const money = (v: number) => `$${v.toFixed(2)}`;

const StoreScreen = memo(({ onBack }: Props) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [products, setProducts] = useState<StoreProduct[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0); // 0 = Back, 1..N = products
  const [detail, setDetail] = useState<StoreProduct | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  // Inside detail: 0 = Buy (QR), 1 = Back to store
  const [detailIdx, setDetailIdx] = useState(0);

  const focusIdxRef = useRef(focusIdx);
  const productsRef = useRef<StoreProduct[]>([]);
  const detailRef = useRef<StoreProduct | null>(null);
  const detailIdxRef = useRef(detailIdx);
  useEffect(() => { focusIdxRef.current = focusIdx; }, [focusIdx]);
  useEffect(() => { productsRef.current = products ?? []; }, [products]);
  useEffect(() => { detailRef.current = detail; }, [detail]);
  useEffect(() => { detailIdxRef.current = detailIdx; }, [detailIdx]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${STORE_SUPABASE_URL}/rest/v1/products?active=eq.true&select=id,name,slug,description,price,currency,category,image_url,featured,sort&order=featured.desc,sort.asc`,
          { headers: { apikey: STORE_ANON_KEY, Accept: 'application/json' } },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = (await res.json()) as StoreProduct[];
        if (!cancelled) setProducts(rows);
      } catch (e) {
        console.error('[Store] product load failed:', e);
        if (!cancelled) { setLoadError(true); setProducts([]); }
      }
    })();
    try { trackEvent('store_open', 'store', {}); } catch { /* ignore */ }
    return () => { cancelled = true; };
  }, []);

  /** Build the phone-checkout QR for one product. Tries the store's public
   *  tv-cart endpoint (exact item lands in the cart); falls back to the
   *  product's plans page so the QR is never a dead end. */
  const openCheckout = useCallback(async (p: StoreProduct) => {
    setQrBusy(true);
    let url = `${STORE_ORIGIN}/plans?src=smc-tv&item=${encodeURIComponent(p.slug)}`;
    try {
      const res = await fetch(`${STORE_ORIGIN}/api/public/tv-cart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ productId: p.id, qty: 1 }],
          email: user?.email ?? undefined,
          source: 'smc-tv',
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { cartId?: string };
        if (data?.cartId) url = `${STORE_ORIGIN}/checkout?cart=${encodeURIComponent(data.cartId)}`;
      }
    } catch { /* endpoint missing/offline — plans-page fallback stands */ }
    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 360,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      setQrUrl(dataUrl);
      try { trackEvent('store_checkout_qr', 'store', { product: p.slug }); } catch { /* ignore */ }
    } catch (e) {
      console.error('[Store] QR failed:', e);
      toast({ title: 'Could not build the QR code', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setQrBusy(false);
    }
  }, [toast, user?.email]);

  const openOnDevice = useCallback(async () => {
    try {
      await AppManager.openUrl({ url: `${STORE_ORIGIN}?src=smc-tv` });
    } catch {
      toast({
        title: 'No browser on this device',
        description: 'Scan the QR code with your phone instead.',
      });
    }
  }, [toast]);

  // ── D-pad ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape', 'Backspace'];
      if (!keys.includes(e.key) && e.keyCode !== 4 && e.keyCode !== 23) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();

      const d = detailRef.current;
      // Back key.
      if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4) {
        if (qrUrl) { setQrUrl(null); return; }
        if (d) { setDetail(null); setDetailIdx(0); return; }
        onBack();
        return;
      }

      if (qrUrl) {
        // Any Enter/OK closes the QR overlay.
        if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 23) setQrUrl(null);
        return;
      }

      if (d) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setDetailIdx(0);
        else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setDetailIdx(1);
        else if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 23) {
          if (detailIdxRef.current === 0) void openCheckout(d);
          else { setDetail(null); setDetailIdx(0); }
        }
        return;
      }

      // Grid: index 0 is Back, products are 1..N laid out 3 per row.
      const count = productsRef.current.length;
      const i = focusIdxRef.current;
      if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 23) {
        if (i === 0) { onBack(); return; }
        const p = productsRef.current[i - 1];
        if (p) { setDetail(p); setDetailIdx(0); }
        return;
      }
      let next = i;
      if (i === 0) {
        if (e.key === 'ArrowDown' && count > 0) next = 1;
      } else {
        const gi = i - 1; // grid index
        if (e.key === 'ArrowLeft' && gi % 3 > 0) next = i - 1;
        else if (e.key === 'ArrowRight' && gi % 3 < 2 && gi + 1 < count) next = i + 1;
        else if (e.key === 'ArrowUp') next = gi < 3 ? 0 : i - 3;
        else if (e.key === 'ArrowDown' && gi + 3 < count) next = i + 3;
      }
      if (next !== i) setFocusIdx(next);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onBack, qrUrl, openCheckout]);

  // Keep the focused card in view.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-store-idx="${focusIdx}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusIdx]);

  const cardCls = (focused: boolean) =>
    `rounded-xl bg-slate-900/70 border border-white/10 overflow-hidden cursor-pointer transition-all duration-150 ${
      focused ? 'ring-4 ring-brand-gold scale-105 shadow-[0_0_22px_rgba(185,162,121,0.75)] brightness-110' : ''
    }`;

  return (
    <div className="min-h-screen flex flex-col text-white bg-gradient-to-b from-slate-950 to-slate-900">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <BackButton onClick={onBack} label="Back" focused={!detail && !qrUrl && focusIdx === 0} />
        <div className="flex items-center gap-2">
          <ShoppingBag className="w-7 h-7 text-brand-gold" />
          <h1 className="text-2xl font-quicksand font-bold">Snow Media Store</h1>
        </div>
        <p className="ml-auto text-sm text-white/50 font-nunito hidden md:block">
          Pick an item, then scan the QR with your phone to check out
        </p>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {products === null && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
          </div>
        )}
        {products !== null && loadError && (
          <p className="text-center text-white/60 py-16 font-nunito">
            The store didn't load. Check your connection and try again — or visit{' '}
            <span className="text-brand-gold">snowmediaent.com</span> on your phone.
          </p>
        )}
        {products !== null && !loadError && products.length === 0 && (
          <p className="text-center text-white/60 py-16 font-nunito">No items available right now.</p>
        )}

        {!detail && products !== null && products.length > 0 && (
          <div className="grid grid-cols-3 gap-5 max-w-5xl mx-auto">
            {products.map((p, i) => (
              <div
                key={p.id}
                data-store-idx={i + 1}
                className={cardCls(focusIdx === i + 1)}
                onClick={() => { setFocusIdx(i + 1); setDetail(p); setDetailIdx(0); }}
              >
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="w-full h-36 object-cover" loading="lazy" />
                ) : (
                  <div className="w-full h-36 flex items-center justify-center bg-slate-800">
                    <ShoppingBag className="w-10 h-10 text-white/25" />
                  </div>
                )}
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-quicksand font-semibold leading-tight">{p.name}</p>
                    {p.featured && (
                      <Badge className="bg-brand-gold/25 text-brand-gold border border-brand-gold/40 shrink-0">
                        Featured
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-brand-gold font-bold">{money(p.price)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {detail && !qrUrl && (
          <div className="max-w-3xl mx-auto grid md:grid-cols-2 gap-6 items-start">
            {detail.image_url ? (
              <img src={detail.image_url} alt={detail.name} className="w-full rounded-xl border border-white/10" />
            ) : (
              <div className="w-full h-56 rounded-xl bg-slate-800 flex items-center justify-center">
                <ShoppingBag className="w-14 h-14 text-white/25" />
              </div>
            )}
            <div>
              <h2 className="text-3xl font-quicksand font-bold">{detail.name}</h2>
              <p className="mt-1 text-2xl text-brand-gold font-bold">{money(detail.price)}</p>
              {detail.description && (
                <p className="mt-3 text-white/70 font-nunito whitespace-pre-wrap">{detail.description}</p>
              )}
              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={() => void openCheckout(detail)}
                  className={`px-5 py-3 rounded-xl font-quicksand font-semibold bg-brand-gold text-slate-900 transition-all ${
                    detailIdx === 0 ? 'ring-4 ring-white/70 scale-105' : ''
                  }`}
                >
                  {qrBusy ? <Loader2 className="w-5 h-5 animate-spin inline" /> : <Smartphone className="w-5 h-5 inline mr-2" />}
                  Buy with your phone
                </button>
                <button
                  type="button"
                  onClick={() => { setDetail(null); setDetailIdx(0); }}
                  className={`px-5 py-3 rounded-xl font-quicksand bg-slate-800 border border-white/15 transition-all ${
                    detailIdx === 1 ? 'ring-4 ring-brand-gold scale-105' : ''
                  }`}
                >
                  Back to store
                </button>
              </div>
              <button
                type="button"
                onClick={() => void openOnDevice()}
                className="mt-4 text-sm text-white/40 underline-offset-4 hover:underline"
              >
                Or try opening snowmediaent.com on this device
              </button>
            </div>
          </div>
        )}

        {qrUrl && (
          <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-6">
            <div className="bg-white rounded-2xl p-5">
              <img src={qrUrl} alt="Checkout QR code" className="w-72 h-72" />
            </div>
            <p className="mt-5 text-xl font-quicksand font-semibold text-center">
              Scan with your phone to check out
            </p>
            <p className="mt-1 text-white/60 font-nunito text-center max-w-md">
              {user?.email
                ? `Your order will be linked to ${user.email}.`
                : 'Sign into My Account first and your order links to your Snow Media account automatically.'}
            </p>
            <p className="mt-4 text-sm text-white/40">Press OK or Back to close</p>
          </div>
        )}
      </div>
    </div>
  );
});

StoreScreen.displayName = 'StoreScreen';
export default StoreScreen;
