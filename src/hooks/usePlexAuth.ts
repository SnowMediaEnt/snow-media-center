import { useCallback, useEffect, useRef, useState } from 'react';
import {
  requestPlexPin, checkPlexPin,
  loadPlexToken, savePlexToken, clearPlexToken,
  getPlexServers, pickPlexConnection, loadPlexServer, savePlexServer,
} from '@/lib/plex';

export type PlexStatus = 'loading' | 'signed-out' | 'linking' | 'connecting' | 'ready' | 'error';
export interface PlexConn { base: string; token: string; name: string; }

export function usePlexAuth() {
  const [status, setStatus] = useState<PlexStatus>('loading');
  const [conn, setConn] = useState<PlexConn | null>(null);
  const [pinCode, setPinCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const startingRef = useRef(false);
  const cancelledRef = useRef(false);

  const clearPoll = () => { if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; } };

  const discover = useCallback(async (accountToken: string): Promise<boolean> => {
    setStatus('connecting');
    try {
      const cached = await loadPlexServer();
      if (cached?.base && cached?.token) {
        setConn(cached); setStatus('ready'); return true;
      }
      const servers = await getPlexServers(accountToken);
      const owned = servers.find((s) => s.owned) ?? servers[0];
      if (!owned) { setError('No Plex server found on your account.'); setStatus('error'); return false; }
      const base = await pickPlexConnection(owned);
      if (!base) { setError(`Couldn't reach "${owned.name}". Check that it's online.`); setStatus('error'); return false; }
      const c: PlexConn = { base, token: owned.accessToken || accountToken, name: owned.name };
      await savePlexServer(c);
      setConn(c); setStatus('ready'); return true;
    } catch (e) {
      setError((e as Error).message || 'Failed to reach Plex.'); setStatus('error'); return false;
    }
  }, []);

  // On mount: resume an existing session.
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
    if (startingRef.current) return;   // a PIN request / link is already in progress
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

  const cancelLink = useCallback(() => { clearPoll(); startingRef.current = false; setPinCode(null); setStatus('signed-out'); }, []);

  const signOut = useCallback(async () => {
    clearPoll();
    startingRef.current = false;
    await clearPlexToken();
    setConn(null); setPinCode(null); setError(null); setStatus('signed-out');
  }, []);

  return { status, conn, pinCode, error, startLink, cancelLink, signOut };
}
