import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { runWhenIdle } from '@/utils/idle';

/**
 * "Giveaway winners announced" boot popup data.
 *
 * Reads the self-guarding public view `giveaway_public_winners` (rows only
 * exist once an admin has announced), plus the public giveaway copy. Fetch is
 * deferred to idle (same idiom as useAppAlerts / usePlayerServerAlert) and
 * fails silently on any error so it can never affect boot.
 *
 * Dismiss persistence: localStorage map giveaway_id -> MAX(drawn_at) that was
 * dismissed. If a winner is re-drawn later the max changes and the popup
 * returns.
 */

const DISMISS_KEY = 'snow-giveaway-winners-dismissed-v1';

interface WinnerRow {
  giveaway_id: string;
  position: number;
  public_display_name: string | null;
  drawn_at: string | null;
}

export interface AnnouncedGiveaway {
  giveawayId: string;
  name: string | null;
  prizeDescription: string | null;
  announcementMd: string | null;
  maxDrawnAt: string;
  winners: { position: number; name: string }[];
}

type DismissMap = Record<string, string>;

const readDismissed = (): DismissMap => {
  try { const r = localStorage.getItem(DISMISS_KEY); if (r) return JSON.parse(r) as DismissMap; } catch { /* ignore */ }
  return {};
};
const writeDismissed = (m: DismissMap) => {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(m)); } catch { /* ignore */ }
};

export function useGiveawayWinners() {
  const [groups, setGroups] = useState<AnnouncedGiveaway[]>([]);
  const [dismissed, setDismissed] = useState<DismissMap>(() => readDismissed());

  const fetchWinners = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('giveaway_public_winners')
        .select('giveaway_id,position,public_display_name,drawn_at');
      if (error || !data || data.length === 0) { setGroups([]); return; }

      const rows = data as WinnerRow[];
      const byGiveaway = new Map<string, WinnerRow[]>();
      rows.forEach((r) => {
        if (!r.giveaway_id) return;
        const list = byGiveaway.get(r.giveaway_id) ?? [];
        list.push(r);
        byGiveaway.set(r.giveaway_id, list);
      });

      const ids = Array.from(byGiveaway.keys());
      let meta: Record<string, { name: string | null; prize_description: string | null; announcement_md: string | null }> = {};
      const { data: gdata } = await supabase
        .from('giveaways')
        .select('id,name,prize_description,announcement_md')
        .in('id', ids);
      (gdata || []).forEach((g: any) => {
        meta[g.id] = { name: g.name ?? null, prize_description: g.prize_description ?? null, announcement_md: g.announcement_md ?? null };
      });

      const next: AnnouncedGiveaway[] = ids.map((id) => {
        const list = byGiveaway.get(id)!;
        const maxDrawnAt = list
          .map((r) => r.drawn_at || '')
          .sort()
          .slice(-1)[0] || '';
        return {
          giveawayId: id,
          name: meta[id]?.name ?? null,
          prizeDescription: meta[id]?.prize_description ?? null,
          announcementMd: meta[id]?.announcement_md ?? null,
          maxDrawnAt,
          winners: list
            .slice()
            .sort((a, b) => (a.position || 0) - (b.position || 0))
            .map((r) => ({ position: r.position, name: (r.public_display_name || 'Winner').trim() })),
        };
      });
      setGroups(next);
    } catch {
      setGroups([]);
    }
  }, []);

  useEffect(() => {
    const cancel = runWhenIdle(() => { void fetchWinners(); }, 2500);
    return cancel;
  }, [fetchWinners]);

  const pending = useMemo(
    () => groups.filter((g) => dismissed[g.giveawayId] !== g.maxDrawnAt),
    [groups, dismissed],
  );

  const current = pending[0] ?? null;

  const dismiss = useCallback(() => {
    if (!current) return;
    const next = { ...readDismissed(), [current.giveawayId]: current.maxDrawnAt };
    writeDismissed(next);
    setDismissed(next);
  }, [current]);

  return { current, dismiss };
}
