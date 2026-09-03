import { useCallback, useEffect, useRef, useState } from 'react';
import {
  requestPlexPin, checkPlexPin,
  loadPlexToken, savePlexToken, clearPlexToken,
  getPlexServers, pickPlexConnectionDetailed, loadPlexServer, savePlexServer,
  getPlexIdentity, bumpPlexImageEpoch, clearPlexCaches, plexRouteOf,
  isPlexPlaybackActive, type PlexRoute,
} from '@/lib/plex';
import { runWhenIdle } from '@/utils/idle';
import { isDemo } from '@/lib/demoMode';
import { demoConn } from '@/lib/plexDemo';

export type PlexStatus = 'loading' | 'signed-out' | 'linking' | 'connecting' | 'ready' | 'unreachable' | 'error';
export interface PlexConn { base: string; token: string; name: string; clientIdentifier?: string; owned?: boolean; route?: PlexRoute; }

// Demo mode: a frozen "already connected" state. Stable references so the
// consumer's effects never re-run, and no-op actions so the PIN link flow can
// never start. isDemo() is always false on native — this is dead code there.
const DEMO_CONN: PlexConn = { ...demoConn };
const noop = () => { /* demo */ };
const asyncNoop = async () => { /* demo */ };
const DEMO_AUTH = {
  status: 'ready' as PlexStatus,
  conn: DEMO_CONN,
  pinCode: null,
  error: null,
  justLinked: false,
  accountToken: null,
  clearJustLinked: noop,
  startLink: asyncNoop,
  cancelLink: noop,
  signOut: asyncNoop,
  retryConnect: asyncNoop,
};

export function usePlexAuth() {
  const demo = isDemo();

  const [status, setStatus] = useState<PlexStatus>('loading');
  const [conn, setConn] = useState<PlexConn | null>(null);
  const [pinCode, setPinCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justLinked, setJustLinked] = useState(false);
  const [accountToken, setAccountToken] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const startingRef = useRef(false);
  const discoveringRef = useRef(false);
  const cancelledRef = useRef(false);
  const connBaseRef = useRef<string | null>(null);
  // Cancels the deferred background connection upgrade (see discover()).
  const cancelUpgradeRef = useRef<(() => void) | null>(null);
  // Bumped on sign-out. Deferred writers (the idle upgrade, the relay escape)
  // re-check it after every await, so an in-flight task can never resurrect the
  // saved server we just deleted — which would hand the NEXT account to sign in
  // the previous account's base and token.
  const sessionRef = useRef(0);

  const clearPoll = () => { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } };

  const discover = useCallback(async (accountToken: string): Promise<boolean> => {
    if (discoveringRef.current) return false;
    discoveringRef.current = true;
    setStatus('connecting');
    try {
      const cached = await loadPlexServer();
      if (cached?.base && cached?.token) {
        try {
          // /identity answers WITHOUT a token, so "it responded" proves only
          // that some Plex server is listening at this address — not that it
          // is the one we saved. Compare the machineIdentifier: on a mismatch
          // the cache is stale and we fall through to full rediscovery below,
          // which is the only thing that can undo a bad base already written
          // to device storage. This is a one-shot check at connect: no loop,
          // no extra state, and nothing fires while the user is watching.
          const machineId = await getPlexIdentity(cached.base, cached.token);
          if (cached.clientIdentifier && machineId && machineId !== cached.clientIdentifier) {
            throw new Error('cached Plex base points at a different server');
          }
          if (connBaseRef.current && connBaseRef.current !== cached.base) bumpPlexImageEpoch();
          connBaseRef.current = cached.base;
          setConn(cached); setStatus('ready');
          // Background upgrade of a cached connection — no UX change:
          //  • http:// base → migrate to a reachable https:// mirror so posters
          //    stop being blocked by the WebView on https origins.
          //  • unknown route (saved before routes were tracked) → learn it.
          //  • relay → look for a direct path (Plex caps relay speed hard).
          //
          // THREE RULES, each of which cost us an outage or nearly did:
          //  1. NEVER call setConn for a route-only change. A new `conn`
          //     identity re-runs PlexSection's one-shot warm-up effect, whose
          //     cleanup cancels the in-flight warm-up while the re-run bails on
          //     its `warmedRef` guard — so `setWarmedUp(true)` never fires and
          //     Plex sits on "Loading your library…" forever. The base and
          //     token are identical here; only a label changed. Persist it and
          //     let the next launch read it.
          //  2. NEVER downgrade the scheme. A relay-cached https base probed
          //     with httpsOnly:false can resolve to a plain http LAN candidate,
          //     which the web build then blocks as mixed content — killing
          //     every Plex call. Only accept an equal-or-better scheme.
          //  3. Run it at IDLE, not on the critical path. This probe fans out
          //     across every candidate connection in parallel; on a Fire TV the
          //     socket pool is small and the first-screen fetches lose.
          if (cached.base.startsWith('http://') || !cached.route || cached.route === 'relay') {
            const cachedIsHttps = cached.base.slice(0, 6).toLowerCase() === 'https:';
            // A record saved before clientIdentifier was stored has no identity
            // on it. Fall back to the machineIdentifier /identity just returned,
            // so the lookup below can still pin itself to THIS server. Without
            // an identity to match on, "the best https base on the account" is
            // very often a DIFFERENT server, and we would silently move the
            // user onto it eight seconds after launch.
            const knownId = cached.clientIdentifier || machineId || null;
            const session = sessionRef.current;
            cancelUpgradeRef.current?.();
            cancelUpgradeRef.current = runWhenIdle(() => {
              void (async () => {
                try {
                  const servers = await getPlexServers(accountToken);
                  const s = knownId ? servers.find((x) => x.clientIdentifier === knownId) ?? null : null;
                  if (!s || sessionRef.current !== session) return;
                  // Stamp the identity we learned so the mismatch guard above
                  // goes live for this record from the next launch onward.
                  const stamp = cached.clientIdentifier ? {} : { clientIdentifier: knownId as string };
                  // Rule 2: an upgrade only ever probes https candidates. That
                  // is the entire point when the cache is http://, and an https
                  // cache must never be walked back to http.
                  const better = await pickPlexConnectionDetailed(s, 3500, { httpsOnly: true, noRelay: true });
                  if (sessionRef.current !== session) return;
                  const wantHttps = !cachedIsHttps;
                  const improves = !!better && better.base !== cached.base
                    && ((wantHttps && better.base.startsWith('https://'))
                      || (cached.route === 'relay' && better.route !== 'relay'));
                  if (!improves) {
                    // Rule 1: no setConn. Learn the route of the base we are
                    // ALREADY on — read off the server's own connection list,
                    // not from the probe, which may have picked a different
                    // base — so this block stops re-running on every launch.
                    const route = plexRouteOf(s, cached.base)
                      ?? (better && better.base === cached.base ? better.route : cached.route);
                    if (route !== cached.route || !cached.clientIdentifier) {
                      await savePlexServer({ ...cached, ...stamp, route });
                    }
                    return;
                  }
                  const upgraded: typeof cached = {
                    ...cached, ...stamp,
                    base: better!.base, route: better!.route,
                    token: s.accessToken || accountToken, name: s.name,
                    clientIdentifier: s.clientIdentifier, owned: !!s.owned,
                  };
                  if (sessionRef.current !== session) return;
                  await savePlexServer(upgraded);
                  if (sessionRef.current !== session) return;
                  // Invalidate any queued image fetches BEFORE swapping the
                  // conn so rail <img> tags re-commit on the new base.
                  bumpPlexImageEpoch();
                  connBaseRef.current = upgraded.base;
                  setConn(upgraded);
                } catch { /* ignore — cached connection keeps working */ }
              })();
            }, 8000);
          }
          return true;
        } catch { /* stale cache — rediscover */ }
      }
      const servers = await getPlexServers(accountToken);
      if (!servers.length) {
        setError('No Plex Media Server is linked to this Plex account.');
        setStatus('unreachable');
        return false;
      }
      // Try EVERY server (owned first, then shared) — accounts often carry
      // old/dead registrations; the reachable one may be a shared server.
      const ordered = [...servers].sort((a, b) => Number(b.owned) - Number(a.owned));
      for (const s of ordered) {
        const picked = await pickPlexConnectionDetailed(s);
        if (picked) {
          const base = picked.base;
          const c: PlexConn = { base, token: s.accessToken || accountToken, name: s.name, clientIdentifier: s.clientIdentifier, owned: !!s.owned, route: picked.route };
          await savePlexServer(c);
          if (connBaseRef.current && connBaseRef.current !== base) bumpPlexImageEpoch();
          connBaseRef.current = base;
          setConn(c); setStatus('ready'); return true;
        }
      }
      setError(`Signed in — found ${ordered.length} server${ordered.length === 1 ? '' : 's'} (${ordered.map((s) => s.name).join(', ')}) but none are reachable from this device right now. Check the server is online and Remote Access is enabled, then tap Retry.`);
      setStatus('unreachable');
      return false;
    } catch (e) {
      setError((e as Error).message || 'Failed to reach Plex.');
      setStatus('unreachable');
      return false;
    } finally {
      discoveringRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Demo mode never touches stored tokens or the Plex account API.
    if (demo) return;
    cancelledRef.current = false;
    (async () => {
      const token = await loadPlexToken();
      if (cancelledRef.current) return;
      if (token) { setAccountToken(token); await discover(token); }
      else { setAccountToken(null); setStatus('signed-out'); }
    })();
    return () => { cancelledRef.current = true; clearPoll(); cancelUpgradeRef.current?.(); };
  }, [discover, demo]);


  // Relay escape: Plex Relay is hard-capped (a couple of Mbit/s), which is
  // exactly the "everything is 2–3× faster on a VPN" symptom — the VPN lets a
  // direct path through where the ISP/CGNAT blocks it. While stuck on the
  // relay, re-probe for a direct path every 45 s and switch as soon as one
  // answers. Stops on its own once the route is direct or LAN.
  useEffect(() => {
    if (demo || !conn || conn.route !== 'relay' || !accountToken) return;
    let stopped = false;
    const session = sessionRef.current;
    let delay = 45_000;
    let timer: number | null = null;
    // Returns false when nothing was tried, so a skipped tick does not count
    // toward the backoff below.
    const attempt = async (): Promise<boolean> => {
      if (stopped || discoveringRef.current) return false;
      // Never probe while a stream is on screen. This fans out across every
      // candidate connection at once, and the relay the user is stuck on is
      // already speed-capped — the probe would compete with their playback.
      if (isPlexPlaybackActive()) return false;
      try {
        const servers = await getPlexServers(accountToken);
        const s = servers.find((x) => x.clientIdentifier === conn.clientIdentifier) ?? null;
        if (!s || stopped) return true;
        // Deliberately NO httpsOnly here. Every Plex relay URI is https, so
        // deriving it from the current base would set it for 100% of relay
        // users; combined with noRelay that can empty the candidate set and
        // pin them to the relay's speed cap forever — the exact problem this
        // escape exists to solve. The mixed-content worry does not apply on
        // the device: native calls go through CapacitorHttp, not the WebView,
        // capacitor.config.ts sets allowMixedContent, and PlexImage has a
        // data-URI fallback for an http base.
        const better = await pickPlexConnectionDetailed(s, 3500, { noRelay: true });
        if (!better || stopped || sessionRef.current !== session) return true;
        const upgraded: PlexConn = { ...conn, base: better.base, route: better.route, token: s.accessToken || conn.token };
        // Re-check BEFORE the write, not just after it: the hook may have torn
        // down, or the user may have signed out, while the probe was running.
        if (stopped || sessionRef.current !== session) return true;
        await savePlexServer(upgraded);
        if (stopped || sessionRef.current !== session) return true;
        bumpPlexImageEpoch();
        connBaseRef.current = upgraded.base;
        setConn(upgraded);
      } catch { /* still on the relay — try again next tick */ }
      return true;
    };
    // Back off after each real attempt (45 s → 90 s → … → 10 min). A box behind
    // CGNAT may never get a direct path, and a fixed 45 s interval would probe
    // every connection on the account for the whole session, forever.
    const tick = () => {
      void attempt().then((tried) => {
        if (stopped) return;
        if (tried) delay = Math.min(delay * 2, 600_000);
        timer = window.setTimeout(tick, delay);
      });
    };
    timer = window.setTimeout(tick, delay);
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [conn, accountToken, demo]);

  const startLink = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setError(null);
    clearPoll();
    try {
      const pin = await requestPlexPin();
      setPinCode(pin.code);
      setStatus('linking');
      clearPoll();
      const startedAt = Date.now();
      pollRef.current = window.setInterval(async () => {
        // Plex PINs die after ~10 minutes. Without this the screen shows a dead
        // code and "Waiting for you to sign in…" forever, polling a 404.
        if (Date.now() - startedAt > 9.5 * 60_000) {
          clearPoll();
          startingRef.current = false;
          setPinCode(null);
          setError('That sign-in code expired. Choose Try again to get a new one.');
          setStatus('error');
          return;
        }
        try {
          const token = await checkPlexPin(pin.id);
          if (token) {
            clearPoll();
            startingRef.current = false;
            setPinCode(null);
            await savePlexToken(token);
            setAccountToken(token);
            setJustLinked(true);
            await discover(token);
          }
        } catch { /* keep polling */ }
      }, 2500);
    } catch (e) {
      startingRef.current = false;
      setError((e as Error).message || 'Could not start Plex sign-in.');
      setStatus('error');
    }
  }, [discover]);

  const cancelLink = useCallback(() => {
    clearPoll(); startingRef.current = false; setPinCode(null); setStatus('signed-out');
  }, []);

  const signOut = useCallback(async () => {
    clearPoll();
    startingRef.current = false;
    // Stop the deferred writers before clearing storage, and invalidate any
    // that already started: an idle upgrade landing after this point would
    // re-create the saved server with the outgoing account's token.
    sessionRef.current += 1;
    cancelUpgradeRef.current?.();
    cancelUpgradeRef.current = null;
    await clearPlexToken(); // also removes the saved server (token + server prefs)
    // Drop in-memory catalog caches so the next account (even on the same
    // server base URL) never renders the previous account's rows/posters.
    clearPlexCaches();
    bumpPlexImageEpoch(); // invalidate any queued/in-flight poster URLs
    connBaseRef.current = null;
    setAccountToken(null);
    setConn(null); setPinCode(null); setError(null); setJustLinked(false); setStatus('signed-out');
  }, []);

  const retryConnect = useCallback(async () => {
    const token = await loadPlexToken();
    if (!token) { setStatus('signed-out'); return; }
    setError(null);
    await discover(token);
  }, [discover]);

  const clearJustLinked = useCallback(() => { setJustLinked(false); }, []);

  if (demo) return DEMO_AUTH;

  return { status, conn, pinCode, error, justLinked, accountToken, clearJustLinked, startLink, cancelLink, signOut, retryConnect };
}
