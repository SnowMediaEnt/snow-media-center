// Support › Device check's suggestions: SMC's static list (no prices or
// links), rows made safe to show, and the grouping by category and tier.
import { describe, expect, it } from 'vitest';
import { PICK_CATEGORIES, PICK_TIERS, groupPicks, parsePickRows, smcPicks } from './deviceScanPicks';

const row = (o: Record<string, unknown>) => ({ source: 'smc', ord: 1, category: 'device', tier: 'budget', name: 'Box One', why: 'Quick', ...o });

describe('device scan picks', () => {
  it('the static list: every category has Budget, Mid and Best; names and why only', () => {
    const picks = smcPicks();
    for (const c of PICK_CATEGORIES) {
      for (const t of PICK_TIERS) expect(picks.some((p) => p.category === c && p.tier === t)).toBe(true);
    }
    expect(picks.every((p) => p.price === null && p.url === null && p.source === 'smc' && !!p.name)).toBe(true);
    expect(picks.find((p) => p.category === 'device' && p.tier === 'best')?.name).toBe('NVIDIA Shield TV Pro');
  });

  it("rows: a reseller's first, then SMC's in order; bad rows left out; never a price or a link", () => {
    const out = parsePickRows([
      row({ ord: 2, name: 'Box Two', tier: 'mid' }),
      row({ source: 'dealer', name: 'Dealer Box', category: 'router', why: null }),
      row({ ord: 1, price: 'about 30', url: 'https://example.com' }),
      row({ category: 'toaster' }),
      row({ tier: 'premium' }),
      row({ name: '   ' }),
      null,
      'nope',
      row({ ord: 3, name: 'Mesh  \u0007 Lite', category: 'router', tier: 'best' }),
    ]);
    expect(out.map((p) => p.name)).toEqual(['Dealer Box', 'Box One', 'Box Two', 'Mesh Lite']);
    expect(out[1]).toEqual({ source: 'smc', category: 'device', tier: 'budget', name: 'Box One', why: 'Quick', price: null, url: null });
    expect(parsePickRows('x')).toEqual([]);
  });

  it('groups by category (worth-a-look first) and tier, leaving out empty ones', () => {
    const picks = parsePickRows([
      row({ name: 'A' }),
      row({ name: 'B', tier: 'best' }),
      row({ name: 'R', category: 'router', tier: 'mid' }),
    ]);
    const g = groupPicks(picks, ['router']);
    expect(g.map((x) => x.category)).toEqual(['router', 'device']);
    expect(g[0].highlighted).toBe(true);
    expect(g[1].tiers.map((t) => t.tier)).toEqual(['budget', 'best']);
  });
});
