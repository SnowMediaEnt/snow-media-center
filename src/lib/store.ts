/**
 * Snow Media store — data + pricing for the TV storefront.
 *
 * Products live in the STORE's own Supabase project (snowmediaent.com, a
 * separate Lovable app). Its `products` table is public for active rows, so a
 * plain REST call with the publishable key works from any device. Presentation
 * overrides (title, blurb, badge, image, shelf, order, hidden) live in the SMC
 * shared project's `store_display` table and are edited from SMC Hub → Store.
 *
 * The pricing rules here mirror the website's SetupBuilder exactly so the TV
 * quotes the same total the phone checkout will charge:
 *   - a plan (`category: 'plan'`) has variants keyed by duration (+ connections
 *     for DreamStreams);
 *   - a device (`category: 'device'`) has variants keyed by `bundle`
 *     ("Device only" or "<Service> 1yr [· N conn]") and optionally `model`;
 *   - device + 12-month service = the device's bundle variant price, flat;
 *   - PLEX is included free with any DreamStreams / VibezTV plan.
 */

export const STORE_ORIGIN = 'https://snowmediaent.com';
export const STORE_SUPABASE_URL = 'https://cxetqtmuqfebayppfrwr.supabase.co';
export const STORE_ANON_KEY = 'sb_publishable_P5-WG9FerWWVyep8jdv11w_o08HCaLy';

export type ServiceSlug = 'dreamstreams' | 'vibeztv' | 'plex';
export const SERVICES: ServiceSlug[] = ['dreamstreams', 'vibeztv', 'plex'];
export const SERVICE_LABELS: Record<ServiceSlug, string> = {
  dreamstreams: 'DreamStreams',
  vibeztv: 'VibezTV',
  plex: 'Just PLEX',
};
export const SERVICE_BLURBS: Record<ServiceSlug, string> = {
  dreamstreams: 'Live TV, every sports package, PPV and events. PLEX included free.',
  vibeztv: 'Premium live TV with 9 connections. PLEX included free.',
  plex: 'Movies & shows hub only — no live TV.',
};

export interface Variant {
  label: string;
  price: number;
  returning_price?: number;
  tbd?: boolean;
  choices?: Record<string, string>;
}

export interface StoreProduct {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  features: string[];
  price: number;
  currency: string;
  variants: Variant[];
  category: 'plan' | 'device' | 'accessory' | 'digital' | 'bundle' | string;
  image_url: string | null;
  featured: boolean;
  sort: number;
}

export interface DisplayOverride {
  product_slug: string;
  title: string | null;
  blurb: string | null;
  badge: string | null;
  image_url: string | null;
  group_kind: 'device' | 'service' | 'accessory' | 'digital' | null;
  sort: number;
  hidden: boolean;
  highlight: boolean;
}

/** A product with its display overrides applied — what the TV renders. */
export interface ShelfItem {
  product: StoreProduct;
  title: string;
  blurb: string | null;
  badge: string | null;
  image: string | null;
  group: 'device' | 'service' | 'accessory' | 'digital';
  sort: number;
  highlight: boolean;
}

// ── Parsing ─────────────────────────────────────────────────────────────────
function parseVariants(raw: unknown): Variant[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
    const r = v as Record<string, unknown>;
    if (typeof r.label !== 'string') return [];
    const choices = r.choices && typeof r.choices === 'object' && !Array.isArray(r.choices)
      ? (r.choices as Record<string, string>) : undefined;
    return [{
      label: r.label,
      price: typeof r.price === 'number' ? r.price : 0,
      returning_price: typeof r.returning_price === 'number' ? r.returning_price : undefined,
      tbd: r.tbd === true,
      choices,
    }];
  });
}

function parseFeatures(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
}

export function money(v: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: Number.isInteger(v) ? 0 : 2,
  }).format(v);
}

/** Lowest non-TBD price across variants, else the base price. */
export function fromPrice(p: StoreProduct): number {
  const vs = p.variants.filter((v) => !v.tbd);
  return vs.length ? Math.min(...vs.map((v) => v.price)) : Number(p.price);
}

// ── Fetch ───────────────────────────────────────────────────────────────────
export async function fetchStoreProducts(signal?: AbortSignal): Promise<StoreProduct[]> {
  const res = await fetch(
    `${STORE_SUPABASE_URL}/rest/v1/products?active=eq.true&select=id,name,slug,description,features,price,currency,variants,category,image_url,featured,sort&order=featured.desc,sort.asc`,
    { headers: { apikey: STORE_ANON_KEY, Accept: 'application/json' }, signal },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    slug: String(r.slug ?? ''),
    description: (r.description as string | null) ?? null,
    features: parseFeatures(r.features),
    price: Number(r.price ?? 0),
    currency: String(r.currency ?? 'USD'),
    variants: parseVariants(r.variants),
    category: String(r.category ?? 'accessory'),
    image_url: (r.image_url as string | null) ?? null,
    featured: r.featured === true,
    sort: Number(r.sort ?? 0),
  }));
}

/** Merge store products with SMC Hub display overrides into TV shelf items. */
export function buildShelf(products: StoreProduct[], overrides: DisplayOverride[]): ShelfItem[] {
  const byslug = new Map(overrides.map((o) => [o.product_slug, o]));
  const out: ShelfItem[] = [];
  for (const p of products) {
    const o = byslug.get(p.slug);
    if (o?.hidden) continue;
    const group: ShelfItem['group'] = o?.group_kind
      ?? (p.category === 'plan' || p.category === 'bundle' ? 'service'
        : p.category === 'device' ? 'device'
          : p.category === 'digital' ? 'digital' : 'accessory');
    out.push({
      product: p,
      title: o?.title?.trim() || p.name,
      blurb: o?.blurb?.trim() || p.description,
      badge: o?.badge?.trim() || (p.featured ? 'Best value' : null),
      image: o?.image_url?.trim() || p.image_url,
      group,
      sort: o ? o.sort : p.sort,
      highlight: o?.highlight ?? p.featured,
    });
  }
  return out.sort((a, b) => a.sort - b.sort || a.product.sort - b.product.sort);
}

// ── Setup pricing (mirrors the website's SetupBuilder) ──────────────────────
export const DEVICE_ONLY = 'Device only';

export function bundleKey(service: ServiceSlug, connections: string | null, duration: string): string | null {
  if (duration !== '12 months') return null;
  if (service === 'dreamstreams') {
    if (connections === '2') return 'DreamStreams 1yr · 2 conn';
    if (connections === '6') return 'DreamStreams 1yr · 6 conn';
    return null;
  }
  if (service === 'vibeztv') return 'VibezTV 1yr';
  return null;
}

export function bundleLabel(service: ServiceSlug, connections: string | null): string {
  if (service === 'dreamstreams') return `1 Year DreamStreams (${connections} connections)`;
  return '1 Year VibezTV (9 connections)';
}

export function durationsFor(service: ServiceSlug, plan?: StoreProduct): string[] {
  // Prefer what the catalog actually offers; fall back to the site defaults.
  const fromCatalog = plan
    ? Array.from(new Set(plan.variants.map((v) => v.choices?.duration).filter((d): d is string => !!d)))
    : [];
  if (fromCatalog.length) return fromCatalog;
  if (service === 'dreamstreams') return ['1 month', '12 months'];
  if (service === 'vibeztv') return ['1 month', '3 months', '12 months'];
  return ['1 month', '12 months'];
}

export function connectionsFor(plan?: StoreProduct): string[] {
  if (!plan) return [];
  return Array.from(new Set(plan.variants.map((v) => v.choices?.connections).filter((c): c is string => !!c)));
}

export function deviceModels(device: StoreProduct): string[] {
  const out: string[] = [];
  for (const v of device.variants) {
    const m = v.choices?.model;
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

export function findDeviceVariant(device: StoreProduct, bundle: string, model: string | null): Variant | undefined {
  return device.variants.find((v) => v.choices?.bundle === bundle && (!model || v.choices?.model === model));
}

export function findServiceVariant(plan: StoreProduct | undefined, service: ServiceSlug, duration: string, connections: string | null): Variant | undefined {
  if (!plan) return undefined;
  return plan.variants.find((v) =>
    v.choices?.duration === duration && (service === 'dreamstreams' ? v.choices?.connections === connections : true),
  );
}

export interface SetupQuote {
  lines: Array<{ name: string; detail: string | null; price: number; free?: boolean }>;
  total: number;
  isBundle: boolean;
  serviceTbd: boolean;
  canCheckout: boolean;
  returningTotal: number | null;
  /** Cart lines for the phone checkout (variant-aware; the server re-prices). */
  cart: CartLine[];
}

export interface CartLine { productId: string; variantLabel?: string; qty?: number }

export function quoteSetup(input: {
  service: ServiceSlug;
  plan: StoreProduct | undefined;
  connections: string | null;
  duration: string;
  device: StoreProduct | null;
  model: string | null;
}): SetupQuote {
  const { service, plan, connections, duration, device, model } = input;
  const models = device ? deviceModels(device) : [];
  const activeModel = models.length ? (model ?? models[0]) : null;
  const serviceVariant = findServiceVariant(plan, service, duration, connections);
  const key = bundleKey(service, connections, duration);
  const bundleVariant = device && key ? findDeviceVariant(device, key, activeModel) : undefined;
  const deviceOnlyVariant = device ? findDeviceVariant(device, DEVICE_ONLY, activeModel) : undefined;
  const isBundle = !!bundleVariant;
  const serviceTbd = serviceVariant?.tbd === true;
  const servicePrice = serviceVariant?.price ?? 0;
  const devicePrice = deviceOnlyVariant?.price ?? (device ? Number(device.price) : 0);
  const deviceName = device ? (activeModel ? `${device.name} ${activeModel}` : device.name) : '';

  const lines: SetupQuote['lines'] = [];
  const cart: CartLine[] = [];
  let total = 0;
  if (isBundle && device && bundleVariant) {
    total = bundleVariant.price;
    lines.push({ name: `${deviceName} + ${bundleLabel(service, connections)}`, detail: 'PLEX included', price: total });
    cart.push({ productId: device.id, variantLabel: bundleVariant.label, qty: 1 });
  } else {
    if (device) {
      lines.push({ name: deviceName, detail: 'Includes 1-month service trial', price: devicePrice });
      total += devicePrice;
      cart.push({ productId: device.id, variantLabel: deviceOnlyVariant?.label, qty: 1 });
    }
    if (plan) {
      lines.push({
        name: plan.name,
        detail: serviceVariant?.label ?? duration,
        price: serviceTbd ? 0 : servicePrice,
      });
      if (!serviceTbd) total += servicePrice;
      if (serviceVariant && !serviceTbd) cart.push({ productId: plan.id, variantLabel: serviceVariant.label, qty: 1 });
    }
  }
  if (service !== 'plex') lines.push({ name: 'PLEX', detail: 'Included free', price: 0, free: true });

  const returningPrice = !isBundle ? serviceVariant?.returning_price : undefined;
  const returningTotal = returningPrice !== undefined && !serviceTbd ? total - servicePrice + returningPrice : null;
  const canCheckout = !!plan && (isBundle || (!!serviceVariant && !serviceTbd));
  return { lines, total, isBundle, serviceTbd, canCheckout, returningTotal, cart };
}

// ── Phone checkout handoff ──────────────────────────────────────────────────
/**
 * Asks the store to save a cart and returns the URL to QR. Sends variant
 * labels (the store re-prices server-side, never trusting the TV) plus the
 * signed-in SMC user id so the order can be attached to the right customer.
 * Falls back to the product page so the QR is never a dead end.
 */
export async function createPhoneCheckoutUrl(input: {
  lines: CartLine[];
  email?: string | null;
  smcUserId?: string | null;
  fallbackSlug?: string;
}): Promise<{ url: string; viaCart: boolean }> {
  const fallback = `${STORE_ORIGIN}/plans?src=smc-tv${input.fallbackSlug ? `&item=${encodeURIComponent(input.fallbackSlug)}` : ''}`;
  if (!input.lines.length) return { url: fallback, viaCart: false };
  try {
    const res = await fetch(`${STORE_ORIGIN}/api/public/tv-cart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: input.lines.map((l) => ({ productId: l.productId, variantLabel: l.variantLabel, qty: l.qty ?? 1 })),
        email: input.email ?? undefined,
        source: 'smc-tv',
        smcUserId: input.smcUserId ?? undefined,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { cartId?: string };
      if (data?.cartId) return { url: `${STORE_ORIGIN}/checkout?cart=${encodeURIComponent(data.cartId)}`, viaCart: true };
    }
  } catch { /* offline / endpoint missing — fall through */ }
  return { url: fallback, viaCart: false };
}
