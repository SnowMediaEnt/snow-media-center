import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { syncPlayerAccountToCloud } from '@/lib/playerAccountSync';
import { capturePlayerSignin } from '@/lib/playerSigninCapture';
import { authenticateRouted, buildPlayerAccount, loadCreds, savePlayerAccount } from '@/lib/xtream';
import { runWhenIdle } from '@/utils/idle';
import { markReconciled, reconciledRecently } from '@/lib/panelReconcile';

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
      // ALSO stamp the link on the sign-in record. capturePlayerSignin sends
      // the current session's bearer token, and the capture RPC stores the
      // resulting user id on player_signins.supabase_user_id — which is the
      // ONLY thing the reverse bridge (player-login) trusts when it decides
      // whether a streaming login may sign this website account back in.
      //
      // Before this, the stamp only happened when the user signed into the
      // Player while ALREADY holding a website session. Anyone who made their
      // website account later — from the Support prompt, say — never got
      // linked, so after a reinstall their streaming login brought back the
      // Player but not the account their tickets live on.
      //
      // The line is re-verified against the panel FIRST, the same way
      // LiveTV's periodic reconcile does it. Sending the stored snapshot
      // instead would push a possibly days-old password and expiry over the
      // server's record and on into the CRM; a fresh authenticateRouted
      // proves the line still belongs to this device and carries current
      // values. 'reconcile' leaves the sign-in count and device untouched.
      void (async () => {
        try {
          // LiveTV's reconcile does this same capture when it runs; one
          // panel round-trip per session is enough.
          if (reconciledRecently()) return;
          markReconciled();
          const res = await authenticateRouted(account.username, account.password);
          // Expired/disabled lines: the panel still authenticated the account,
          // so record the TRUE state (fresh expiry) rather than bailing —
          // this is what lets a renewal show the moment the panel flips.
          if (!res.ok && !(res.authedButBlocked && res.server && res.creds)) return;
          if (!res.server || !res.creds) return;
          const now = await loadCreds();
          if (!now || now.username !== account.username || now.host !== account.host) return;
          const fresh = buildPlayerAccount(res.server, res.creds, res.userInfo);
          // Since this now stands in for LiveTV's reconcile, keep its other
          // job too: the stored account carries the fresh expiry and status.
          await savePlayerAccount(fresh);
          void capturePlayerSignin(fresh, res.server.label, 'reconcile');
        } catch { /* best effort */ }
      })();
    }, 2000);
    return cancel;
  }, [user?.id, user?.email, account?.username, account?.host, account?.expDate, account?.status]);
};
