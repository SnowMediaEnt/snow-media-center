// The lines Live TV shows (lib/liveLines buildLines): the one in use, every
// other saved account, and the service added from elsewhere (lib/
// outsideSource) while the rule allows it. Read again when the saved
// accounts, the outside service or the account record change, and — with no
// event to say so — when the line's end date passes or its last check grows
// stale (a timer for the moment, while Live TV is open). A stale line is
// checked again with its panel (lib/outsideActions recheckLine).
//
// The same list (by content) keeps its identity, so nothing that watches the
// lines reloads for an account refresh that changed nothing.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { isDemo, isHowtoCapture } from '@/lib/demoMode';
import { keepIfSame } from '@/lib/keepIfSame';
import { buildLines } from '@/lib/liveLines';
import { accountStale, loadOutsideState, outsideFlipAt, OUTSIDE_SOURCES_EVENT } from '@/lib/outsideSource';
import { loadPlayerAccount, loadSavedAccounts, SAVED_ACCOUNTS_REFRESH_EVENT, type XtreamCreds } from '@/lib/xtream';

/** setTimeout's ceiling (~24.8 days): a later end date is looked at again then. */
const MAX_TIMER_MS = 2_147_000_000;

export function useLiveLines(creds: XtreamCreds, settledRef?: MutableRefObject<boolean>): XtreamCreds[] {
  const [lines, setLines] = useState<XtreamCreds[]>(() => [creds]);
  const settled = useRef(settledRef);
  settled.current = settledRef;
  useEffect(() => {
    const demo = isDemo();
    let cancelled = false;
    let timer: number | null = null;
    const load = async () => {
      const saved = demo && !isHowtoCapture() ? [] : await loadSavedAccounts().catch(() => []);
      const outside = demo ? null : await loadOutsideState(loadPlayerAccount);
      if (cancelled) return;
      if (settled.current) settled.current.current = true;
      const next = buildLines(creds, saved, outside);
      setLines((prev) => keepIfSame(prev, next));
      if (timer != null) { window.clearTimeout(timer); timer = null; }
      const at = outsideFlipAt(outside);
      if (at != null) timer = window.setTimeout(() => { void load(); }, Math.min(MAX_TIMER_MS, Math.max(0, at - Date.now()) + 500));
      // An outside service waiting on a line nobody has checked lately (loaded
      // only then: Live TV's first screen doesn't wait on it).
      if (outside?.sources.length && accountStale(outside.account)) {
        void import('@/lib/outsideActions').then((m) => m.recheckLine(creds)).catch(() => undefined);
      }
    };
    void load();
    const events = [SAVED_ACCOUNTS_REFRESH_EVENT, OUTSIDE_SOURCES_EVENT, 'playerAccountRefresh'];
    const onEvent = () => { void load(); };
    events.forEach((ev) => window.addEventListener(ev, onEvent));
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, onEvent));
    };
  }, [creds]);
  return lines;
}
