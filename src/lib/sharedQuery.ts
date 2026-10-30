// One Supabase read shared by every component that wants it.
//
// Several hooks used to read the same table each on their own: their own
// select, their own realtime channel, their own 60 s poll. On a Fire TV that
// meant app_alerts fetched 7x in two minutes with the very same URL. A shared
// query keeps ONE copy of the rows for the whole app:
//   - one select (the first subscriber schedules it off the boot path),
//   - one realtime channel, opened on the first interaction,
//   - one pausable poll (quiet mode and background pause it, as before),
//   - one refetch when the app comes back to the foreground,
// all started by the first subscriber and stopped when the last one leaves.
//
// The channel gets a unique topic. realtime-js hands back the SAME channel
// for the same topic, so two components that each opened 'app_alerts_changes'
// shared one channel, and the first one to unmount removed it for both.
import { useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { runWhenIdle, onFirstInteraction } from '@/utils/idle';
import { setPausableInterval } from '@/utils/pausableInterval';
import { keepIfSame } from '@/lib/keepIfSame';

type RealtimePayload = { eventType?: string; new?: unknown; old?: unknown };

let topicSeq = 0;
/** A topic no other live channel has (see the note above). */
export const uniqueTopic = (base: string): string => `${base}_${++topicSeq}`;

export interface SharedQueryState<T> {
  data: T;
  /** True until the first read has answered (with rows or an error). */
  loading: boolean;
}

export interface SharedQueryOptions<T> {
  /** Base of the realtime topic (a counter is added). */
  name: string;
  /** The table the realtime channel listens to. */
  table: string;
  /** Realtime filter (`key=in.(…)`), when only some rows matter. */
  filter?: string;
  /** The read. Throw on an error. */
  fetch: () => Promise<T>;
  initial: T;
  /** What a failed read leaves (default: keep what there is). */
  onError?: (prev: T, error: unknown) => T;
  /** The first read waits for idle, at most this long. */
  firstDelayMs?: number;
  /** Safety-net poll; 0 for none. */
  pollMs?: number;
  /** A change pushed by realtime. Default: read again. */
  onChange?: (payload: RealtimePayload, api: SharedQueryApi<T>) => void;
  /** Read again when the app comes back to the foreground (default true). */
  refetchOnVisible?: boolean;
}

export interface SharedQueryApi<T> {
  get: () => SharedQueryState<T>;
  /** Replace the data (a realtime change applied in place). */
  set: (next: T) => void;
  /** Read now. A read already running is followed by one more, so a caller
   *  that just wrote never gets the rows from before its write. */
  refetch: () => Promise<void>;
  /** Read unless the rows are younger than `maxAgeMs` (or a read is running). */
  ensureFresh: (maxAgeMs: number) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
  /** Tests only. */
  __reset: () => void;
}

export function createSharedQuery<T>(opts: SharedQueryOptions<T>): SharedQueryApi<T> {
  // A new object only when something a subscriber sees changed, so it can be
  // the useSyncExternalStore snapshot as it is.
  let state: SharedQueryState<T> = { data: opts.initial, loading: true };
  let fetchedAt = 0;
  const listeners = new Set<() => void>();
  let refs = 0;
  let teardown: (() => void) | null = null;
  let inflight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  let cancelFirstRead: (() => void) | null = null;

  const emit = () => { listeners.forEach((l) => { try { l(); } catch (e) { console.warn(`[${opts.name}] listener threw`, e); } }); };

  const runRead = (): Promise<void> => {
    cancelFirstRead?.(); cancelFirstRead = null;
    const p = (async () => {
      let next: T;
      try {
        next = keepIfSame(state.data, await opts.fetch());
      } catch (e) {
        console.warn(`[${opts.name}] fetch failed:`, (e as Error)?.message ?? e);
        next = opts.onError ? keepIfSame(state.data, opts.onError(state.data, e)) : state.data;
      }
      fetchedAt = Date.now();
      if (next !== state.data || state.loading) {
        state = { data: next, loading: false };
        emit();
      }
    })();
    const tracked: Promise<void> = p.finally(() => { if (inflight === tracked) inflight = null; });
    inflight = tracked;
    return tracked;
  };

  const refetch = (): Promise<void> => {
    if (!inflight) return runRead();
    if (!queued) {
      queued = inflight.then(() => { queued = null; return runRead(); });
    }
    return queued;
  };

  const ensureFresh = (maxAgeMs: number): Promise<void> => {
    if (queued) return queued;
    if (inflight) return inflight;
    if (fetchedAt && Date.now() - fetchedAt < maxAgeMs) return Promise.resolve();
    return runRead();
  };

  const api: SharedQueryApi<T> = {
    get: () => state,
    set: (next) => {
      const kept = keepIfSame(state.data, next);
      if (kept === state.data) return;
      state = { ...state, data: kept };
      emit();
    },
    refetch,
    ensureFresh,
    subscribe: (listener) => {
      listeners.add(listener);
      if (refs++ === 0) teardown = start();
      return () => {
        listeners.delete(listener);
        if (--refs === 0) { teardown?.(); teardown = null; }
      };
    },
    __reset: () => {
      teardown?.(); teardown = null;
      listeners.clear(); refs = 0;
      inflight = null; queued = null;
      state = { data: opts.initial, loading: true };
      fetchedAt = 0;
    },
  };

  function start(): () => void {
    // Rows from an earlier run of the app shell are kept; read again only
    // when they are older than a poll period.
    const maxAge = opts.pollMs || 60_000;
    if (!fetchedAt || Date.now() - fetchedAt >= maxAge) {
      const cancel = runWhenIdle(() => { cancelFirstRead = null; if (!inflight) void runRead(); }, opts.firstDelayMs ?? 1500);
      cancelFirstRead = cancel;
    }
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let stopped = false;
    const cancelFirst = onFirstInteraction(() => {
      if (stopped) return;
      channel = supabase
        .channel(uniqueTopic(opts.name))
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: opts.table, ...(opts.filter ? { filter: opts.filter } : {}) },
          (payload) => {
            if (opts.onChange) opts.onChange(payload as RealtimePayload, api);
            else void refetch();
          },
        )
        .subscribe();
    });
    const cancelPoll = opts.pollMs ? setPausableInterval(() => { void refetch(); }, opts.pollMs) : () => {};
    const onVisible = () => { if (document.visibilityState === 'visible') void refetch(); };
    const watchVisible = opts.refetchOnVisible !== false && typeof document !== 'undefined';
    if (watchVisible) document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      cancelFirstRead?.(); cancelFirstRead = null;
      cancelFirst();
      cancelPoll();
      if (watchVisible) document.removeEventListener('visibilitychange', onVisible);
      if (channel) void supabase.removeChannel(channel);
    };
  }

  return api;
}

/** The shared rows in a component; re-renders only when they change. */
export function useSharedQuery<T>(q: SharedQueryApi<T>): SharedQueryState<T> {
  return useSyncExternalStore(q.subscribe, q.get, q.get);
}
