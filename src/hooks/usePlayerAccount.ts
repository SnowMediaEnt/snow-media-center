import { useCallback, useEffect, useState } from 'react';
import {
  loadPlayerAccount,
  daysUntilExp,
  type PlayerAccount,
} from '@/lib/xtream';
import { expiryState, type ExpiryState } from '@/hooks/useUserServices';

interface PlayerAccountHookState {
  account: PlayerAccount | null;
  loading: boolean;
  days: number | null;
  state: ExpiryState;
  refresh: () => Promise<void>;
}

/**
 * Loads the locally-stored Player Account (set by CredentialsForm on a
 * successful Xtream sign-in) and exposes its expiration state using the
 * shared tiered helper (30 / 7 / 1 / daily-after).
 *
 * Re-reads from storage whenever the `playerAccountRefresh` window event
 * fires (savePlayerAccount / clearPlayerAccount dispatch it).
 */
export const usePlayerAccount = (): PlayerAccountHookState => {
  const [account, setAccount] = useState<PlayerAccount | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const acc = await loadPlayerAccount();
      setAccount(acc);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handler = () => { void refresh(); };
    window.addEventListener('playerAccountRefresh', handler);
    return () => window.removeEventListener('playerAccountRefresh', handler);
  }, [refresh]);

  const days = daysUntilExp(account);
  const state = expiryState(days);

  return { account, loading, days, state, refresh };
};
