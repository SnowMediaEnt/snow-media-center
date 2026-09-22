import { useCallback, useEffect, useRef, useState } from 'react';
import {
  requestPlexPin, checkPlexPin,
  loadPlexToken, savePlexToken, clearPlexToken,
  getPlexServers, pickPlexConnectionDetailed, loadPlexServer, savePlexServer,
  getPlexIdentity, bumpPlexImageEpoch, clearPlexCaches, rekeyPlexCaches, plexRouteOf,
  isPlexPlaybackActive, type PlexRoute,
} from '@/lib/plex';
import { runWhenIdle } from '@/utils/idle';
import { isDemo } from '@/lib/demoMode';
import { demoConn } from '@/lib/plexDemo';
import { loadCreds } from '@/lib/xtream';
import {
  fetchProviderPlexToken, providerLinkMessage, markPlexProviderLinked, isPlexProviderLinked, isProviderServer,
  providerLineInactive,
} from '@/lib/plexProvider';

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
  providerNote: null,
  providerAvailable: false,
  clearJustLinked: noop,
  startLink: asyncNoop,
  cancelLink: noop,
  signOut: asyncNoop,
  retryConnect: asyncNoop,
  linkWithProvider: asyncNoop,
  reportAuthFailure: noop,
};

// What discover() learned. 'auth' is the one outcome the caller can act on:
// plex.tv rejected the token itself, so no retry with the same token can help.
type DiscoverOutcome = 'ok' | 'failed' | 'auth';

export function usePlexAuth() {
  const demo = isDemo();

  const [status, setStatus] = useState<PlexStatus>('loading');
  const [conn, setConn] = useState<PlexConn | null>(null);
  const [pinCode, setPinCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justLinked, setJustLinked] = useState(false);
  const [accountToken, setAccountToken] = useState<string | null>(null);
  // Provider link (see src/lib/plexProvider.ts): a box signed into Live TV
  // gets the provider's Plex token without a PIN. `providerNote` is why the
  // last attempt failed, for the sign-in screen; `providerAvailable` is
  // "there is a Live TV line on this box", so the screen can offer it.
  const [providerNote, setProviderNote] = useState<string | null>(null);
  const [providerAvailable, setProviderAvailable] = useState(false);
  const statusRef = useRef<PlexStatus>('loading');
  const linkingProviderRef = useRef(false);
  // Set by the Sign out button. Auto-link stays off until the next launch so
  // a member who signs out to link their OWN Plex is not signed straight back
  // into the provider's.
  const manualSignOutRef = useRef(false);
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

  useEffect(() => { statusRef.current = status; }, [status]);

  const discover = useCallback(async (accountToken: string): Promise<DiscoverOutcome> => {
    if (discoveringRef.current) return 'failed';
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
                  // Same server, new address: carry the rails and pages over so
                  // Home does not refetch itself under the viewer's cursor.
                  rekeyPlexCaches(cached.base, upgraded.base);
                  connBaseRef.current = upgraded.base;
                  setConn(upgraded);
                } catch { /* ignore — cached connection keeps working */ }
              })();
            }, 8000);
          }
          return 'ok';
        } catch { /* stale cache — rediscover */ }
      }
      const servers = await getPlexServers(accountToken);
      if (!servers.length) {
        setError('No Plex Media Server is linked to this Plex account.');
        setStatus('unreachable');
        return 'failed';
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
          setConn(c); setStatus('ready'); return 'ok';
        }
      }
      setError(`Signed in — found ${ordered.length} server${ordered.length === 1 ? '' : 's'} (${ordered.map((s) => s.name).join(', ')}) but none are reachable from this device right now. Check the server is online and Remote Access is enabled, then tap Retry.`);
      setStatus('unreachable');
      return 'failed';
    } catch (e) {
      const msg = (e as Error).message || 'Failed to reach Plex.';
      setError(msg);
      setStatus('unreachable');
      // plex.tv answered 401: the token is dead, not the network.
      return /HTTP 401\b/.test(msg) ? 'auth' : 'failed';
    } finally {
      discoveringRef.current = false;
    }
  }, []);

  // Forget everything Plex on this box: token, saved server, caches, state.
  // Shared by the Sign out button and the provider re-link, which replaces a
  // dead token with a fresh one and must not let discover() reuse the saved
  // server record (it carries the dead token, and for a shared account the
  // per-server token differs from the account token anyway).
  const resetLocal = useCallback(async () => {
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
    setConn(null); setPinCode(null); setError(null); setJustLinked(false);
  }, []);

  // Ask plex-provider-token for the provider's Plex token on behalf of the
  // Live TV line saved on this box, store it and connect. Returns true when
  // Plex ended up connected. Sets nothing on the screen when there is no line
  // or the feature is off, so those boxes behave exactly as before.
  const linkViaProvider = useCallback(async (opts?: { force?: boolean; replace?: boolean }): Promise<boolean> => {
    if (linkingProviderRef.current) return false;
    linkingProviderRef.current = true;
    const session = sessionRef.current;
    try {
      const creds = await loadCreds();
      if (cancelledRef.current || sessionRef.current !== session) return false;
      setProviderAvailable(!!creds);
      if (!creds) return false;
      setProviderNote(null);
      // Where to land if this fails: a box that was showing its library keeps
      // showing it (with the library error), a signed-out box stays signed
      // out. Never leave the screen on "Connecting…".
      const prev = statusRef.current;
      const fallback: PlexStatus = prev === 'loading' || prev === 'connecting' ? 'signed-out' : prev;
      setStatus('connecting');
      const r = await fetchProviderPlexToken(creds, { force: opts?.force });
      if (cancelledRef.current || sessionRef.current !== session) return false;
      if (!r.ok || !r.token) {
        setProviderNote(providerLinkMessage(r));
        setStatus(fallback);
        return false;
      }
      if (opts?.replace) {
        // The token we hold was rejected. If the provider hands back the very
        // same one, the provider's token is what died; replacing it with
        // itself would only burn the line's throttle budget.
        if ((await loadPlexToken()) === r.token) {
          setProviderNote('Plex rejected the provider token. Ask your provider to refresh it.');
          setStatus(fallback);
          return false;
        }
        await resetLocal();
        if (cancelledRef.current) return false;
      }
      await savePlexToken(r.token);
      await markPlexProviderLinked(true);
      manualSignOutRef.current = false;
      setAccountToken(r.token);
      return (await discover(r.token)) === 'ok';
    } finally {
      linkingProviderRef.current = false;
    }
  }, [discover, resetLocal]);

  // Is the token on this box ours to replace? Yes when the provider link put
  // it there, or when the saved server is the provider's — a member's own
  // Plex, linked by PIN to their own server, is never touched.
  const tokenIsOurs = useCallback(async (): Promise<boolean> => {
    if (await isPlexProviderLinked()) return true;
    const saved = await loadPlexServer();
    return isProviderServer(saved?.name);
  }, []);

  // A provider-linked Plex ends with the line: expired, disabled or banned
  // per the panel. Returns true when it signed Plex out. Signing OUT of Live
  // TV is not expiry — the box keeps its Plex, as the provider asked.
  const dropIfLineInactive = useCallback(async (): Promise<boolean> => {
    if (!(await isPlexProviderLinked())) return false;
    const inactive = await providerLineInactive();
    if (!inactive || cancelledRef.current) return false;
    await resetLocal();
    await markPlexProviderLinked(false);
    setProviderNote(`Your Live TV subscription is ${inactive}. Renew it to keep Plex.`);
    setStatus('signed-out');
    return true;
  }, [resetLocal]);

  useEffect(() => {
    // Demo mode never touches stored tokens or the Plex account API.
    if (demo) return;
    cancelledRef.current = false;
    (async () => {
      const token = await loadPlexToken();
      if (cancelledRef.current) return;
      if (token) {
        setAccountToken(token);
        void loadCreds().then((c) => { if (!cancelledRef.current) setProviderAvailable(!!c); });
        if (await dropIfLineInactive()) return;
        const outcome = await discover(token);
        // plex.tv rejected the stored token. If it is the provider's, a fresh
        // one from the line is the fix — no one has to type a code.
        if (outcome === 'auth' && !cancelledRef.current && (await tokenIsOurs())) {
          await linkViaProvider({ force: true, replace: true });
        }
        return;
      }
      setAccountToken(null);
      if (!(await linkViaProvider())) { if (!cancelledRef.current) setStatus('signed-out'); }
    })();
    return () => { cancelledRef.current = true; clearPoll(); cancelUpgradeRef.current?.(); };
  }, [discover, demo, linkViaProvider, tokenIsOurs, dropIfLineInactive]);

  // Follow the Live TV line. Signing into Live TV while Plex is signed out
  // links Plex on the spot; a line the panel reports expired, disabled or
  // banned takes a provider-linked Plex with it. Signing out of Live TV, and
  // a member's own PIN-linked Plex, are both left alone. savePlayerAccount
  // dispatches this event — at sign-in and after every panel refresh.
  useEffect(() => {
    if (demo) return;
    const onRefresh = () => {
      void (async () => {
        const creds = await loadCreds();
        if (cancelledRef.current) return;
        setProviderAvailable(!!creds);
        if (!creds) return;
        if (await dropIfLineInactive()) return;
        if (statusRef.current === 'signed-out' && !manualSignOutRef.current) await linkViaProvider();
      })();
    };
    window.addEventListener('playerAccountRefresh', onRefresh);
    return () => window.removeEventListener('playerAccountRefresh', onRefresh);
  }, [demo, linkViaProvider, dropIfLineInactive]);

  // PlexSection calls this when a library request comes back 401 on a
  // connection discover() accepted (the /identity check needs no token, so a
  // dead token only shows up at the first real request). Same repair as at
  // launch, same "ours to replace" rule.
  const reportAuthFailure = useCallback(() => {
    if (linkingProviderRef.current) return;
    void (async () => {
      if (!(await tokenIsOurs())) return;
      await linkViaProvider({ force: true, replace: true });
    })();
  }, [linkViaProvider, tokenIsOurs]);

  // The sign-in screen's "Connect with my Live TV account" button.
  const linkWithProvider = useCallback(async () => {
    manualSignOutRef.current = false;
    if (!(await linkViaProvider({ force: true }))) setStatus('signed-out');
  }, [linkViaProvider]);


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
        rekeyPlexCaches(conn.base, upgraded.base);
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
            // A PIN-linked token is the member's own: never replaced by the
            // provider link, never removed by a Live TV sign-out.
            await markPlexProviderLinked(false);
            manualSignOutRef.current = false;
            setProviderNote(null);
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
    // Deliberate: stay signed out until the next launch even though a Live
    // TV line could sign us straight back in.
    manualSignOutRef.current = true;
    await resetLocal();
    await markPlexProviderLinked(false);
    setProviderNote(null);
    setStatus('signed-out');
  }, [resetLocal]);

  const retryConnect = useCallback(async () => {
    const token = await loadPlexToken();
    if (!token) {
      if (!(await linkViaProvider({ force: true }))) setStatus('signed-out');
      return;
    }
    setError(null);
    const outcome = await discover(token);
    if (outcome === 'auth' && (await tokenIsOurs())) await linkViaProvider({ force: true, replace: true });
  }, [discover, linkViaProvider, tokenIsOurs]);

  const clearJustLinked = useCallback(() => { setJustLinked(false); }, []);

  if (demo) return DEMO_AUTH;

  return {
    status, conn, pinCode, error, justLinked, accountToken, providerNote, providerAvailable,
    clearJustLinked, startLink, cancelLink, signOut, retryConnect, linkWithProvider, reportAuthFailure,
  };
}
