// Who is watching: the key per-viewer things are stored under (Plex resume
// points, My List, watch history). The signed-in Snow Media account's id,
// else 'device' for the box itself — and, when a profile other than the main
// one is picked ("Who's watching?", see profiles.ts), that profile on top:
// `${account}:p:${profile}`. The main profile keeps the plain key, so history
// from before profiles existed stays where it was.
//
// On the account (watch_history rows) the row's user_id is always the real
// account id; a profile's rows carry its id in front of the item key
// (cloudItemKey), and scopeToProfile narrows a query to the current profile.
import { supabase } from '@/integrations/supabase/client';

export const MAIN_PROFILE = 'main';

let account: string | null = null;
// False while the account is only the one this box remembers (its session
// couldn't be refreshed yet: offline, or Supabase unreachable).
let confirmed = false;
let profile = MAIN_PROFILE;
let resolved: Promise<string> | null = null;
const listeners = new Set<(v: string) => void>();

const key = (): string => {
  const base = account ?? 'device';
  return profile === MAIN_PROFILE ? base : `${base}:p:${profile}`;
};

const notify = () => {
  const v = key();
  for (const cb of listeners) { try { cb(v); } catch { /* ignore */ } }
};

/** The current viewer key (may still be 'device' before resolveViewer). */
export const viewerKey = (): string => key();

/** True when the viewer is a signed-in account (things can be copied to it). */
export const viewerIsAccount = (): boolean => account != null;

/** The signed-in account id, or null. */
export const viewerAccountId = (): string | null => account;

/** True when the account's session is live, so reads from it are the
 *  account's rows. False while it is only remembered (see storedAccountId):
 *  a read then answers as nobody, with no rows and no error. */
export const viewerAccountConfirmed = (): boolean => account != null && confirmed;

const AUTH_TOKEN_KEY = 'sb-falmwzhvxoefvkfsiylp-auth-token';

/** The account the box's stored session belongs to, read without the
 *  network. Supabase keeps it while a refresh fails on the network and
 *  removes it on a real sign-out. */
export function storedAccountId(): string | null {
  try {
    const raw = localStorage.getItem(AUTH_TOKEN_KEY);
    const id = raw ? (JSON.parse(raw) as { user?: { id?: unknown } })?.user?.id : null;
    return typeof id === 'string' && id ? id : null;
  } catch { return null; }
}

/** The profile being watched as ('main' unless another was picked). */
export const viewerProfileId = (): string => profile;

/** Switch profile. Listeners hear the new viewer key. */
export function setViewerProfile(id: string): void {
  const next = id || MAIN_PROFILE;
  if (next === profile) return;
  profile = next;
  notify();
}

/** An item key as stored on the account for the current profile. */
export const cloudItemKey = (itemKey: string, p: string = profile): string =>
  p === MAIN_PROFILE ? itemKey : `p:${p}:${itemKey}`;

/** The item key back from an account row, or null when the row belongs to
 *  another profile. */
export const fromCloudItemKey = (stored: string, p: string = profile): string | null => {
  if (p === MAIN_PROFILE) return stored.startsWith('p:') ? null : stored;
  const prefix = `p:${p}:`;
  return stored.startsWith(prefix) ? stored.slice(prefix.length) : null;
};

/** Narrow a watch_history query to the current profile's rows. */
export function scopeToProfile<Q extends { like: (c: string, v: string) => Q; not: (c: string, op: string, v: string) => Q }>(q: Q, p: string = profile): Q {
  return p === MAIN_PROFILE ? q.not('item_key', 'like', 'p:%') : q.like('item_key', `p:${p}:%`);
}

/** Resolves the viewer once and follows sign-in / sign-out after that.
 *  A session that can't be refreshed at start (offline) is still that
 *  account's: a Kids profile on it must not become the box's grown-up one. */
export function resolveViewer(): Promise<string> {
  resolved ??= (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const live = data.session?.user?.id ?? null;
      account = live ?? storedAccountId();
      confirmed = live != null;
    } catch { account = storedAccountId(); confirmed = false; }
    try {
      supabase.auth.onAuthStateChange((event, session) => {
        // Only SIGNED_OUT ends the session; a null one otherwise is a refresh
        // that failed on the network, and the stored session stands.
        const live = session?.user?.id ?? null;
        const next = live ?? (event === 'SIGNED_OUT' ? null : storedAccountId());
        confirmed = live != null;
        if (next === account) return;
        account = next;
        notify();
      });
    } catch { /* no auth in this build */ }
    return key();
  })();
  return resolved;
}

/** Called with the new key whenever the viewer changes. Returns an unsubscribe. */
export function onViewerChange(cb: (v: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Tests only. `v` is an account id ('device' for none), optionally with a
 *  profile as `${account}:p:${profile}`. */
export function __setViewerForTests(v: string): void {
  const m = /^(.*):p:([a-z0-9]+)$/.exec(v);
  const acc = m ? m[1] : v;
  account = acc === 'device' ? null : acc;
  confirmed = account != null;
  profile = m ? m[2] : MAIN_PROFILE;
  resolved = Promise.resolve(key());
}
