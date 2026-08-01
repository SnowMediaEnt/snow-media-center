/**
 * Shared "is there an active giveaway right now?" hook.
 *
 * Used by the home gift badge and the first-open promo popup. Design goals:
 *  - One fetch per app session, module-level cached (never polls).
 *  - localStorage snapshot so the badge can paint instantly on the next boot
 *    while a background refetch confirms.
 *  - Deferred to idle so it never competes with the boot/render path.
 *  - Anon-safe: RLS on public.giveaways already allows reading non-draft rows.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { runWhenIdle } from '@/utils/idle';

export interface ActiveGiveawayInfo {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  prize_description: string | null;
  prize_image_url: string | null;
  start_at: string | null;
  end_at: string | null;
}

const LS_KEY = 'smc-active-giveaway';

// undefined = not fetched this session; null = fetched, none active.
let cache: ActiveGiveawayInfo | null | undefined;
let inflight: Promise<ActiveGiveawayInfo | null> | null = null;

const withinWindow = (g: ActiveGiveawayInfo): boolean => {
  const now = Date.now();
  const starts = g.start_at ? Date.parse(g.start_at) : null;
  const ends = g.end_at ? Date.parse(g.end_at) : null;
  return (starts === null || starts <= now) && (ends === null || ends >= now);
};

const readSnapshot = (): ActiveGiveawayInfo | null => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as ActiveGiveawayInfo | null;
    if (g && typeof g === 'object' && g.id && withinWindow(g)) return g;
  } catch {
    /* ignore */
  }
  return null;
};

const writeSnapshot = (g: ActiveGiveawayInfo | null) => {
  try {
    if (g) localStorage.setItem(LS_KEY, JSON.stringify(g));
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
};

const fetchActive = async (): Promise<ActiveGiveawayInfo | null> => {
  try {
    const { data, error } = await supabase
      .from('giveaways')
      .select('id,slug,name,description,prize_description,prize_image_url,start_at,end_at,status')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) return cache ?? null;
    const g = ((data ?? []) as unknown as ActiveGiveawayInfo[]).find(withinWindow) ?? null;
    cache = g;
    writeSnapshot(g);
    return g;
  } catch {
    return cache ?? null;
  }
};

/**
 * Returns the currently active giveaway (or null). Pass `enabled=false`
 * (demo mode / feature flag off) to suppress all fetching.
 */
export const useActiveGiveaway = (enabled: boolean): ActiveGiveawayInfo | null => {
  const [giveaway, setGiveaway] = useState<ActiveGiveawayInfo | null>(() => {
    if (!enabled) return null;
    if (cache !== undefined) return cache;
    return readSnapshot();
  });

  useEffect(() => {
    if (!enabled) {
      setGiveaway(null);
      return;
    }
    if (cache !== undefined) {
      setGiveaway(cache);
      return;
    }
    let cancelled = false;
    const cancelIdle = runWhenIdle(() => {
      if (!inflight) {
        inflight = fetchActive().finally(() => {
          inflight = null;
        });
      }
      void inflight.then((g) => {
        if (!cancelled) setGiveaway(g);
      });
    }, 1500);
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [enabled]);

  return enabled ? giveaway : null;
};
