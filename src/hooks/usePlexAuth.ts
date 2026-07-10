import { useCallback, useEffect, useRef, useState } from 'react';
import {
  requestPlexPin, checkPlexPin,
  loadPlexToken, savePlexToken, clearPlexToken,
  getPlexServers, pickPlexConnection, loadPlexServer, savePlexServer,
  getPlexIdentity, bumpPlexImageEpoch,
} from '@/lib/plex';

export type PlexStatus = 'loading' | 'signed-out' | 'linking' | 'connecting' | 'ready' | 'unreachable' | 'error';
export interface PlexConn { base: string; token: string; name: string; clientIdentifier?: string; owned?: boolean; }

export function usePlexAuth() {
  const [status, setStatus] = useState<PlexStatus>('loading');
  const [conn, setConn] = useState<PlexConn | null>(null);
  const [pinCode, setPinCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justLinked, setJustLinked] = useState(false);
  const pollRef = useRef<number | null>(null);
  const startingRef = useRef(false);
  const discoveringRef = useRef(false);
  const cancelledRef = useRef(false);
  const connBaseRef = useRef<string | null>(null);

  const clearPoll = () => { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } };

  const discover = useCallback(async (accountToken: string): Promise<boolean> => {
    if (discoveringRef.current) return false;
    discoveringRef.current = true;
    setStatus('connecting');
    try {
      const cached = await loadPlexServer();
      if (cached?.base && cached?.token) {
        try {
          await getPlexIdentity(cached.base, cached.token);
          if (connBaseRef.current && connBaseRef.current !== cached.base) bumpPlexImageEpoch();
          connBaseRef.current = cached.base;
          setConn(cached); setStatus('ready');
          // Mixed-content upgrade: if the cached base is http:// but a
          // reachable https:// mirror exists on the same account, silently
          // migrate so posters stop being blocked by the WebView on https
          // origins. Runs in the background — no UX change.
          if (cached.base.startsWith('http://')) {
            void (async () => {
              try {
                const servers = await getPlexServers(accountToken);
                const owned = [...servers].sort((a, b) => Number(b.owned) - Number(a.owned));
                for (const s of owned) {
                  if (cached.clientIdentifier && s.clientIdentifier !== cached.clientIdentifier) continue;
                  const better = await pickPlexConnection(s, 3500, { httpsOnly: true });
                  if (better && better !== cached.base && better.startsWith('https://')) {
                    const upgraded: typeof cached = { ...cached, base: better, token: s.accessToken || accountToken, name: s.name, clientIdentifier: s.clientIdentifier, owned: !!s.owned };
                    await savePlexServer(upgraded);
                    // Invalidate any http-queued image fetches BEFORE swapping
                    // the conn so rail <img> tags re-commit on https.
                    bumpPlexImageEpoch();
                    connBaseRef.current = upgraded.base;
                    setConn(upgraded);
                    return;
                  }
                }
              } catch { /* ignore — cached http keeps working */ }
            })();
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
        const base = await pickPlexConnection(s);
        if (base) {
          const c: PlexConn = { base, token: s.accessToken || accountToken, name: s.name, clientIdentifier: s.clientIdentifier, owned: !!s.owned };
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
    cancelledRef.current = false;
    (async () => {
      const token = await loadPlexToken();
      if (cancelledRef.current) return;
      if (token) { await discover(token); }
      else setStatus('signed-out');
    })();
    return () => { cancelledRef.current = true; clearPoll(); };
  }, [discover]);

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
      pollRef.current = window.setInterval(async () => {
        try {
          const token = await checkPlexPin(pin.id);
          if (token) {
            clearPoll();
            startingRef.current = false;
            setPinCode(null);
            await savePlexToken(token);
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
    await clearPlexToken();
    connBaseRef.current = null;
    setConn(null); setPinCode(null); setError(null); setStatus('signed-out');
  }, []);

  const retryConnect = useCallback(async () => {
    const token = await loadPlexToken();
    if (!token) { setStatus('signed-out'); return; }
    setError(null);
    await discover(token);
  }, [discover]);

  return { status, conn, pinCode, error, startLink, cancelLink, signOut, retryConnect };
}
