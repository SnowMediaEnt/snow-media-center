import { supabase } from '@/integrations/supabase/client';
import { SERVERS } from '@/lib/xtream';

/**
 * Sign-up links for services the app cannot provision itself.
 *
 * DreamStreams runs through WHMCS and needs nothing here. Vibez has no API —
 * only hosted pages that run a Stripe checkout and provision the line through
 * a Stripe webhook — so all the app can do is hand the customer to the right
 * page. Rows live in public.signup_links because the panel account number and
 * site name are part of every URL and will change.
 */

export type SignupKind = 'trial' | 'plan' | 'register' | 'login' | 'home';

export interface SignupLink {
  id: string;
  service: string;
  kind: SignupKind;
  label: string | null;
  termMonths: number | null;
  connections: number | null;
  /** null = we do not know it; show the tier without a price rather than invent one. */
  price: number | null;
  currency: string;
  url: string;
  sort: number;
}

export const VIBEZ = 'vibez';

/** The Vibez panel host, taken from SERVERS so serverForHost() matches it exactly. */
export const VIBEZ_HOST: string =
  SERVERS.find((s) => s.label === 'Vibez')?.host ?? 'https://strmz.xyz';

/**
 * The panel's live packages as of the last check, used as a floor.
 *
 * This is a floor, not a duplicate source of truth: the table wins whenever it
 * has rows. It exists so a cold cache, an offline first launch or a failed
 * fetch degrades to a working screen instead of an empty grid — the failure
 * mode that would otherwise strand exactly the customer this feature is for.
 */
const FALLBACK_BASE = 'https://superadminpanels.com/099451/auto/sites/zargoza';
// The panel's per-package pages currently redirect to the site root, so every
// tier points at the packages list. Prices are still per-row so the TV can
// show them; only the destination is shared.
const FALLBACK_URL = `${FALLBACK_BASE}/#packages`;
const FALLBACK: SignupLink[] = [
  { id: 'vibez-trial', service: VIBEZ, kind: 'trial', label: '2 days', termMonths: null, connections: 5, price: 0, currency: 'USD', url: FALLBACK_URL, sort: 0 },
  { id: 'vibez-1m-9c', service: VIBEZ, kind: 'plan', label: null, termMonths: 1, connections: 9, price: 35, currency: 'USD', url: FALLBACK_URL, sort: 10 },
  { id: 'vibez-3m-9c', service: VIBEZ, kind: 'plan', label: null, termMonths: 3, connections: 9, price: 100, currency: 'USD', url: FALLBACK_URL, sort: 20 },
  { id: 'vibez-12m-9c', service: VIBEZ, kind: 'plan', label: null, termMonths: 12, connections: 9, price: 375, currency: 'USD', url: FALLBACK_URL, sort: 40 },
];

interface Row {
  id: string; service: string; kind: string; label: string | null;
  term_months: number | null; connections: number | null;
  price: number | null; currency: string; url: string; sort: number;
}

const KINDS: SignupKind[] = ['trial', 'plan', 'register', 'login', 'home'];

const toLink = (r: Row): SignupLink | null => {
  if (!r?.url || !KINDS.includes(r.kind as SignupKind)) return null;
  // Only ever hand a browser an https/http link that came from our own table.
  if (!/^https?:\/\//i.test(r.url)) return null;
  return {
    id: String(r.id),
    service: String(r.service),
    kind: r.kind as SignupKind,
    label: r.label ?? null,
    termMonths: r.term_months ?? null,
    connections: r.connections ?? null,
    price: r.price === null || r.price === undefined ? null : Number(r.price),
    currency: r.currency || 'USD',
    url: r.url,
    sort: r.sort ?? 0,
  };
};

/** Rows for a service, newest config first, falling back to the built-in list. */
export async function loadSignupLinks(service: string = VIBEZ): Promise<SignupLink[]> {
  try {
    const { data, error } = await supabase
      .from('signup_links')
      .select('id,service,kind,label,term_months,connections,price,currency,url,sort')
      .eq('service', service)
      .eq('active', true)
      .order('sort', { ascending: true });
    if (error) throw error;
    const rows = (data as unknown as Row[] | null) ?? [];
    const mapped = rows.map(toLink).filter((l): l is SignupLink => l !== null);
    if (mapped.length) return mapped;
  } catch {
    /* fall through to the built-in list */
  }
  return service === VIBEZ ? FALLBACK : [];
}

export interface SignupOffers {
  trial: SignupLink | null;
  register: SignupLink | null;
  plans: SignupLink[];
}

export function toOffers(links: SignupLink[]): SignupOffers {
  return {
    trial: links.find((l) => l.kind === 'trial') ?? null,
    register: links.find((l) => l.kind === 'register') ?? null,
    plans: links.filter((l) => l.kind === 'plan').sort((a, b) => a.sort - b.sort),
  };
}

// Tier wording ("1 year", "9 connections", "1 year · 9 connections") lives in
// components/getstarted/tierText.ts, in the app's language; these names stay for callers.
export { termLabel as termText, connectionsLabel as connectionsText, tierLabel as linkLabel } from '@/components/getstarted/tierText';
