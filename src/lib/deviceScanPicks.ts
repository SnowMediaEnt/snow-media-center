// Support › Device check, the suggestions (ported from Tronix lib/deviceCheckPicks;
// owner, 2026-10-29: "Offer suggestions in different price ranges").
// Streaming device, Router / Wi-Fi, TV and Other, each in Budget / Mid / Best.
//
// TODO(smc-hub): Tronix reads these from its Hub (get_device_picks, editable by
// the owner and resellers). SMC has no such table yet, so this is a static,
// data-only list in the same shape. When an SMC hub table exists (Supabase
// falmwzhvxoefvkfsiylp), fetch it here and keep SMC_PICKS as the offline
// fallback; parsePickRows already makes rows from a server safe to show.
//
// No prices or links on purpose: prices go stale in a shipped APK, and a
// link would open a shop from the TV. Names and why only.
import type { PickCategory } from '@/lib/deviceScanRating';

export type PickTier = 'budget' | 'mid' | 'best';
export const PICK_CATEGORIES: readonly PickCategory[] = ['device', 'router', 'tv', 'other'];
export const PICK_TIERS: readonly PickTier[] = ['budget', 'mid', 'best'];

export interface DevicePick {
  /** 'dealer': a reseller's own (not used in SMC yet); 'smc': Snow Media's list. */
  source: 'dealer' | 'smc';
  category: PickCategory;
  tier: PickTier;
  name: string;
  why: string | null;
  /** Not shown in SMC (see above); kept for the shared shape. */
  price: string | null;
  url: string | null;
}

type Row = Pick<DevicePick, 'category' | 'tier' | 'name' | 'why'>;

/**
 * Snow Media's picks. English data (product names and a short reason), the
 * same as a Hub-typed list would be; the assistant and tickets read them too.
 */
const SMC_PICK_ROWS: readonly Row[] = [
  { category: 'device', tier: 'budget', name: 'Fire TV Stick 4K', why: 'Hardware H.265 and 4K, Wi-Fi 6. Fine for HD and most 4K; 2 GB of memory.' },
  { category: 'device', tier: 'mid', name: 'Fire TV Stick 4K Max', why: '3 GB of memory and Wi-Fi 6E: channels start faster and the guide stays smooth.' },
  { category: 'device', tier: 'mid', name: 'onn 4K Pro', why: '3 GB of memory, an Ethernet port and Dolby Vision; Google TV.' },
  { category: 'device', tier: 'best', name: 'NVIDIA Shield TV Pro', why: 'The fastest processor, 3 GB of memory, Ethernet and USB: smooth on every channel.' },
  { category: 'router', tier: 'budget', name: 'A dual-band Wi-Fi 6 router', why: 'Put the TV on its 5 GHz network; 2.4 GHz is slow and crowded.' },
  { category: 'router', tier: 'mid', name: 'A Wi-Fi 6 mesh system (2 or 3 points)', why: 'A strong signal in every room, so the TV is never far from the router.' },
  { category: 'router', tier: 'best', name: 'A Wi-Fi 6E or 7 mesh with a wired link between the points', why: 'The most speed to the TV, even through walls and floors.' },
  { category: 'tv', tier: 'budget', name: 'Any 4K HDR TV', why: 'Shows today\'s HD and 4K channels sharply. Use the streaming device, not the TV\'s own apps.' },
  { category: 'tv', tier: 'mid', name: 'A 4K TV with a 120 Hz panel and Dolby Vision', why: 'Smoother sports and better HDR.' },
  { category: 'tv', tier: 'best', name: 'A 4K OLED TV', why: 'The best picture for films and dark scenes.' },
  { category: 'other', tier: 'budget', name: 'An Ethernet cable (Cat 6)', why: 'A cable beats Wi-Fi when the device has an Ethernet port.' },
  { category: 'other', tier: 'mid', name: 'An Ethernet adapter for Fire TV', why: 'Gives a Fire TV Stick a wired connection.' },
  { category: 'other', tier: 'best', name: 'A powerline or MoCA adapter kit', why: 'A wired connection through the home\'s power or TV cables when a cable can\'t reach.' },
];

/** The limit Tronix keeps (60 + 40 a reseller); kept for a later server list. */
export const PICKS_MAX = 100;
const LIMITS = { name: 80, why: 240 } as const;

const isControl = (c: number): boolean => c < 32 || (c >= 127 && c <= 159) || c === 0xfffe || c === 0xffff;

/** One line of text: control characters and runs of spaces folded, capped. */
function line(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  let out = '';
  for (let i = 0; i < raw.length; i++) out += isControl(raw.charCodeAt(i)) ? ' ' : raw[i];
  const s = out.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max).trim() : s;
}

const asCategory = (v: unknown): PickCategory | null =>
  (typeof v === 'string' && (PICK_CATEGORIES as readonly string[]).includes(v) ? v as PickCategory : null);
const asTier = (v: unknown): PickTier | null =>
  (typeof v === 'string' && (PICK_TIERS as readonly string[]).includes(v) ? v as PickTier : null);

/**
 * Rows (today the static list; later a server's) made safe to show: a
 * reseller's first, then Snow Media's, each in its order; a row with no name
 * or an unknown category / tier left out. Never a price or a link (see above).
 */
export function parsePickRows(raw: unknown): DevicePick[] {
  if (!Array.isArray(raw)) return [];
  const rows: Array<DevicePick & { grp: number; ord: number; at: number }> = [];
  raw.forEach((row, at) => {
    if (!row || typeof row !== 'object') return;
    const o = row as Record<string, unknown>;
    const source = o.source === 'dealer' ? 'dealer' : 'smc';
    const category = asCategory(o.category);
    const tier = asTier(o.tier);
    const name = line(o.name, LIMITS.name);
    if (!category || !tier || !name) return;
    const ord = typeof o.ord === 'number' && Number.isFinite(o.ord) ? o.ord : at;
    rows.push({ source, category, tier, name, why: line(o.why, LIMITS.why), price: null, url: null, grp: source === 'dealer' ? 0 : 1, ord, at });
  });
  rows.sort((a, b) => a.grp - b.grp || a.ord - b.ord || a.at - b.at);
  return rows.slice(0, PICKS_MAX).map(({ grp: _g, ord: _o, at: _a, ...p }) => p);
}

/** Snow Media's picks, ready to show. */
export function smcPicks(): DevicePick[] {
  return parsePickRows(SMC_PICK_ROWS.map((r) => ({ ...r, source: 'smc' })));
}

export interface PickGroup {
  category: PickCategory;
  /** The scan says this area is orange or red: shown first, marked. */
  highlighted: boolean;
  tiers: Array<{ tier: PickTier; picks: DevicePick[] }>;
}

/** The picks by category (highlighted ones first, then the usual order) and tier; empty categories left out. */
export function groupPicks(picks: DevicePick[], highlight: readonly PickCategory[]): PickGroup[] {
  const order = [...PICK_CATEGORIES].sort((a, b) => Number(highlight.includes(b)) - Number(highlight.includes(a)));
  return order
    .map((category) => ({
      category,
      highlighted: highlight.includes(category),
      tiers: PICK_TIERS.map((tier) => ({ tier, picks: picks.filter((p) => p.category === category && p.tier === tier) }))
        .filter((t) => t.picks.length > 0),
    }))
    .filter((g) => g.tiers.length > 0);
}
