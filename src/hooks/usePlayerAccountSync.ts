import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { syncPlayerAccountToCloud } from '@/lib/playerAccountSync';
import { runWhenIdle } from '@/utils/idle';

/**
 * Mount once at the top of the signed-in app tree. When a Supabase user is
 * present AND a locally-stored player account exists, fires a single
 * fire-and-forget sync so a partial player-only flow auto-promotes into the
 * user's customer_services list when they finally sign in.
 *
 * Runs at most once per (userId, account.username) pair per session.
 */
export const usePlayerAccountSync = (): void => {
  const { user } = useAuth();
  const { account } = usePlayerAccount();
  const sentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || !user.email || !account?.username) return;
    const key = `${user.id}::${account.username}::${account.host}`;
    if (sentRef.current === key) return;
    sentRef.current = key;
    const cancel = runWhenIdle(() => {
      void syncPlayerAccountToCloud(user.id, user.email!, account);
    }, 2000);
    return cancel;
  }, [user?.id, user?.email, account?.username, account?.host, account?.expDate, account?.status]);
};
