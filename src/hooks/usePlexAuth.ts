import { useCallback, useEffect, useRef, useState } from 'react';
import {
  requestPlexPin, checkPlexPin,
  loadPlexToken, savePlexToken, clearPlexToken,
  getPlexServers, pickPlexConnection, loadPlexServer, savePlexServer,
  getPlexIdentity,
} from '@/lib/plex';

export type PlexStatus = 'loading' | 'signed-out' | 'linking' | 'connecting' | 'ready' | 'unreachable' | 'error';
export interface PlexConn { base: string; token: string; name: string; }

export function usePlexAuth() {
  const [status, setStatus] = useState<PlexStatus>('loading');
  const [conn, setConn] = useState<PlexConn | null>(null);
  const [pinCode, setPinCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const startingRef = useRef(false);
  const discoveringRef = useRef(false);
  const cancelledRef = useRef(false);

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
          setConn(cached); setStatus('ready'); return true;
        } catch { /* stale cache — rediscover */ }
      }
      const servers = await getPlexServers(accountToken);
      const owned = servers.find((s) => s.owned) ?? servers[0];
      if (!owned) {
        setError('No Plex Media Server is linked to this Plex account.');
        setStatus('unreachable');
        return false;
      }
      const base = await pickPlexConnection(owned);
      if (!base) {
        setError(`Signed in, and found your server "${owned.name}" — but this device can't reach it. If the server is on this network, check its firewall allows port 32400. Otherwise turn on Remote Access (Plex Server Settings → Remote Access) and tap Retry.`);
        setStatus('unreachable');
        return false;
      }
      const c: PlexConn = { base, token: owned.accessToken || accountToken, name: owned.name };
      await savePlexServer(c);
      setConn(c); setStatus('ready'); return true;
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
