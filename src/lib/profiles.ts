// Profiles: "Who's watching?".
//
// Everyone in a house can have their own profile on the account (or on the
// box, when nobody is signed in): their own Continue Watching, My List, Live
// TV favourites, watch history and home setup. A profile can be a Kids
// profile (kidsFilter.ts decides what it sees) and can have a 4-digit PIN.
//
// WHERE THINGS LIVE
//   The list        on the box per account (or 'device'), and for a signed-in
//                   account also in public.viewer_profiles, so it follows the
//                   account to another box. The account is the truth once it
//                   has answered.
//   The picked one  sessionStorage for this run of the app — a cold start asks
//                   again when there is a choice to make — and the last one
//                   picked, to start the picker on it.
//   History, lists  keyed by viewer.ts's viewer key, which carries the
//                   profile; Live TV favourites by line + profile
//                   (favoritesSync).
//   Home setup      the handful of box settings that are a matter of taste
//                   (PROFILE_KEYS): the ones in use belong to the live
//                   profile; switching stashes them and restores the next
//                   profile's, then reloads so every screen reads them fresh.
//
// THE PIN is a household lock, not a password: it keeps the kids out of the
// grown-ups' profiles. It is hashed (sha256, with the account and profile) and
// checked on the box, so it works offline. PINs need a signed-in account,
// because a forgotten one is reset through it: after a few wrong tries the
// picker offers "Forgot PIN?", which emails a code to the account address and
// opens a support ticket (edge function profile-pin-reset) so an admin can
// clear it from the Hub when the email never arrives.
//
// Nothing here throws; storage and network failures leave things as they were.
import { supabase } from '@/integrations/supabase/client';
import { setKidsLevel, type KidsLevel } from '@/lib/kidsFilter';
import { sha256Hex } from '@/lib/sha256';
import { MAIN_PROFILE, onViewerChange, resolveViewer, setViewerProfile, viewerAccountId } from '@/lib/viewer';

export interface Profile {
  id: string;
  name: string;
  /** A colour key from AVATARS. */
  avatar: string;
  kidsLevel: KidsLevel | null;
  pinHash: string | null;
  position: number;
  /** Last change (ms). */
  t: number;
}

export const AVATARS: Array<{ id: string; bg: string; ring: string }> = [
  { id: 'blue', bg: '#2563eb', ring: '#93c5fd' },
  { id: 'gold', bg: '#b88a2e', ring: '#f5d98b' },
  { id: 'purple', bg: '#7c3aed', ring: '#c4b5fd' },
  { id: 'teal', bg: '#0f8b8d', ring: '#8ee3e4' },
  { id: 'red', bg: '#dc2626', ring: '#fca5a5' },
  { id: 'green', bg: '#16a34a', ring: '#86efac' },
  { id: 'pink', bg: '#db2777', ring: '#f9a8d4' },
  { id: 'orange', bg: '#ea580c', ring: '#fdba74' },
];
export const avatarColors = (id: string) => AVATARS.find((a) => a.id === id) ?? AVATARS[0];

export const MAX_PROFILES = 8;
export const PROFILES_EVENT = 'smc-profiles:changed';
/** Ask the profile screens to open ({ detail: { mode: 'pick' | 'manage' } }). */
export const OPEN_PROFILES_EVENT = 'smc-profiles:open';

const LIST_PREFIX = 'smc-profiles-v1:';
const PULLED_PREFIX = 'smc-profiles-pulled:';
const LAST_PREFIX = 'smc-last-profile:';
const SESSION_KEY = 'smc-active-profile';
const INTRO_KEY = 'smc-profiles-intro-seen';
const LIVE_OWNER_KEY = 'smc-profile-live';
const STASH_PREFIX = 'smc-pstash:';
const FAIL_PREFIX = 'smc-pin-fails:';

/** Box settings that belong to a person rather than the box. */
export const PROFILE_KEYS = [
  'snow-media-layout', 'snow-active-bg', 'pinned-apps', 'pinned-apps-version', 'snow-theme', 'smc_lang',
  'snow-livetv-layout', 'snow-livetv-last-channel-v1', 'snow-livetv-collapsed-lines', 'snow-livetv-autoplay-next',
  'smc:plex-recent-searches', 'snow-media-bar-cache-v6',
];
const PROFILE_PREFIXES = ['snow-livetv-hidden:'];

// ── small storage helpers ──────────────────────────────────────────────────

const ls = {
  get: (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* full */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  keys: (): string[] => {
    try { const out: string[] = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) out.push(k); } return out; } catch { return []; }
  },
};
const ss = {
  get: (k: string): string | null => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
};

const accountKey = (): string => viewerAccountId() ?? 'device';

const emit = () => { try { window.dispatchEvent(new CustomEvent(PROFILES_EVENT)); } catch { /* ignore */ } };

const mainProfile = (): Profile => ({ id: MAIN_PROFILE, name: 'Me', avatar: 'blue', kidsLevel: null, pinHash: null, position: 0, t: 0 });

const clean = (p: Partial<Profile> & { id: string }): Profile => ({
  id: p.id,
  name: String(p.name || 'Profile').slice(0, 24),
  avatar: AVATARS.some((a) => a.id === p.avatar) ? String(p.avatar) : 'blue',
  kidsLevel: p.kidsLevel === 'little' || p.kidsLevel === 'kids' || p.kidsLevel === 'teen' ? p.kidsLevel : null,
  pinHash: typeof p.pinHash === 'string' && /^[0-9a-f]{64}$/.test(p.pinHash) ? p.pinHash : null,
  position: Number(p.position) || 0,
  t: Number(p.t) || 0,
});

const sorted = (list: Profile[]) =>
  [...list].sort((a, b) => (a.id === MAIN_PROFILE ? -1 : b.id === MAIN_PROFILE ? 1 : a.position - b.position || a.t - b.t));

// ── the list ───────────────────────────────────────────────────────────────

export function loadProfiles(acc: string = accountKey()): Profile[] {
  let list: Profile[] = [];
  try {
    const parsed = JSON.parse(ls.get(LIST_PREFIX + acc) || '[]');
    if (Array.isArray(parsed)) list = parsed.filter((p) => p && typeof p.id === 'string').map(clean);
  } catch { /* start fresh */ }
  if (!list.some((p) => p.id === MAIN_PROFILE)) list.unshift(mainProfile());
  return sorted(list);
}

const saveProfiles = (list: Profile[], acc: string = accountKey()) => {
  ls.set(LIST_PREFIX + acc, JSON.stringify(sorted(list)));
  emit();
};

export const getProfile = (id: string): Profile | null => loadProfiles().find((p) => p.id === id) ?? null;

/** The profile being watched as. */
export function activeProfile(): Profile {
  const list = loadProfiles();
  return list.find((p) => p.id === currentId) ?? list[0];
}

/** The grown-up profiles a Kids profile would need a PIN from. */
export const grownUpsWithPin = (): Profile[] => loadProfiles().filter((p) => !p.kidsLevel && !!p.pinHash);

/** Whether PINs can be offered: they need an account to reset through. */
export const pinsAvailable = (): boolean => viewerAccountId() != null;

// ── the account copy ───────────────────────────────────────────────────────

interface Row {
  user_id: string; id: string; name: string; avatar: string;
  kids_level: KidsLevel | null; pin_hash: string | null; position: number; updated_at: string;
}
// viewer_profiles is newer than the generated types.
type Db = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as Db;

const toRow = (userId: string, p: Profile): Row => ({
  user_id: userId, id: p.id, name: p.name, avatar: p.avatar, kids_level: p.kidsLevel,
  pin_hash: p.pinHash, position: p.position, updated_at: new Date(p.t || Date.now()).toISOString(),
});
const fromRow = (r: Row): Profile => clean({
  id: r.id, name: r.name, avatar: r.avatar, kidsLevel: r.kids_level, pinHash: r.pin_hash,
  position: r.position, t: Date.parse(r.updated_at) || 0,
});

const pushProfile = (p: Profile) => {
  const userId = viewerAccountId();
  if (!userId) return;
  void (async () => {
    try { await db.from('viewer_profiles').upsert(toRow(userId, p), { onConflict: 'user_id,id' }); } catch { /* offline */ }
  })();
};

/** Bring the box's list up to date with the account's. */
export async function pullProfiles(): Promise<void> {
  await resolveViewer();
  const userId = viewerAccountId();
  if (!userId) return;
  try {
    const { data, error } = await db.from('viewer_profiles').select('*').eq('user_id', userId);
    if (error || !Array.isArray(data) || viewerAccountId() !== userId) return;
    const local = loadProfiles(userId);
    const pulledAt = Number(ls.get(PULLED_PREFIX + userId)) || 0;
    if (data.length === 0) {
      // Nothing on the account yet: this box's list becomes the account's.
      for (const p of local) if (p.id !== MAIN_PROFILE || p.t > 0) pushProfile(p);
    } else {
      const cloud = new Map((data as Row[]).map((r) => [r.id, fromRow(r)]));
      const merged: Profile[] = [];
      for (const [id, c] of cloud) {
        const l = local.find((p) => p.id === id);
        merged.push(l && l.t > c.t ? l : c);
        if (l && l.t > c.t) pushProfile(l);
      }
      // Made here since the last pull and maybe not uploaded yet: keep.
      for (const l of local) {
        if (!cloud.has(l.id) && (l.id === MAIN_PROFILE || l.t >= pulledAt)) { merged.push(l); if (l.id !== MAIN_PROFILE || l.t > 0) pushProfile(l); }
      }
      saveProfiles(merged, userId);
    }
    ls.set(PULLED_PREFIX + userId, String(Date.now()));
    // The profile in use may have been removed, or made a Kids one, elsewhere.
    const still = loadProfiles(userId).find((p) => p.id === currentId);
    if (!still) applyProfile(MAIN_PROFILE);
    else setKidsLevel(still.kidsLevel);
  } catch { /* offline: the box's list stands */ }
}

// ── editing ────────────────────────────────────────────────────────────────

const newId = (): string => {
  const a = new Uint8Array(6);
  try { crypto.getRandomValues(a); } catch { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); }
  return Array.from(a).map((b) => (b % 36).toString(36)).join('');
};

export function createProfile(input: { name: string; avatar: string; kidsLevel: KidsLevel | null }): Profile | null {
  const list = loadProfiles();
  if (list.length >= MAX_PROFILES) return null;
  const p = clean({ id: newId(), name: input.name.trim() || 'Profile', avatar: input.avatar, kidsLevel: input.kidsLevel, pinHash: null, position: Math.max(0, ...list.map((x) => x.position)) + 1, t: Date.now() });
  saveProfiles([...list, p]);
  pushProfile(p);
  return p;
}

export function updateProfile(id: string, patch: Partial<Pick<Profile, 'name' | 'avatar' | 'kidsLevel' | 'pinHash'>>): Profile | null {
  const list = loadProfiles();
  const cur = list.find((p) => p.id === id);
  if (!cur) return null;
  const next = clean({ ...cur, ...patch, id, t: Date.now() });
  saveProfiles(list.map((p) => (p.id === id ? next : p)));
  pushProfile(next);
  if (id === currentId) setKidsLevel(next.kidsLevel);
  return next;
}

export function deleteProfile(id: string): void {
  if (id === MAIN_PROFILE) return;
  const acc = accountKey();
  saveProfiles(loadProfiles().filter((p) => p.id !== id));
  // Its stashed setup and its lists on this box go with it.
  for (const k of ls.keys()) {
    if (k.startsWith(`${STASH_PREFIX}${id}:`) || k.endsWith(`:p:${id}`)) ls.del(k);
  }
  ls.del(FAIL_PREFIX + id);
  const userId = viewerAccountId();
  if (userId) {
    void (async () => {
      try {
        await db.from('viewer_profiles').delete().eq('user_id', userId).eq('id', id);
        await db.from('watch_history').delete().eq('user_id', userId).like('item_key', `p:${id}:%`);
      } catch { /* offline: the next pull settles it */ }
    })();
  }
  if (currentId === id) applyProfile(MAIN_PROFILE);
  if (ls.get(LAST_PREFIX + acc) === id) ls.set(LAST_PREFIX + acc, MAIN_PROFILE);
}

// ── PIN ────────────────────────────────────────────────────────────────────

export const hashPin = (profileId: string, pin: string, acc: string = accountKey()): string =>
  sha256Hex(`smc-pin:${acc}:${profileId}:${pin}`);

export const setPin = (id: string, pin: string | null): Profile | null =>
  updateProfile(id, { pinHash: pin ? hashPin(id, pin) : null });

interface Fails { n: number; until: number }
const loadFails = (id: string): Fails => {
  try { const f = JSON.parse(ls.get(FAIL_PREFIX + id) || 'null'); if (f && typeof f.n === 'number') return { n: f.n, until: Number(f.until) || 0 }; } catch { /* none */ }
  return { n: 0, until: 0 };
};

/** Wrong tries before "Forgot PIN?" shows, and before the pad pauses. */
export const FORGOT_AFTER = 3;
const LOCK_AFTER = 5;

export const pinFailures = (id: string): number => loadFails(id).n;
/** ms until the pad accepts another try (0 = now). */
export const pinLockedFor = (id: string): number => Math.max(0, loadFails(id).until - Date.now());

/** Check a PIN. A wrong one counts; from the fifth, each costs a wait that
 *  doubles (30 s, 1 min, 2 min … up to 15). */
export function checkPin(profile: Profile, pin: string): boolean {
  if (!profile.pinHash) return true;
  if (pinLockedFor(profile.id) > 0) return false;
  if (hashPin(profile.id, pin) === profile.pinHash) { ls.del(FAIL_PREFIX + profile.id); return true; }
  const f = loadFails(profile.id);
  const n = f.n + 1;
  const until = n >= LOCK_AFTER ? Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (n - LOCK_AFTER)) : 0;
  ls.set(FAIL_PREFIX + profile.id, JSON.stringify({ n, until }));
  return false;
}

export interface ResetRequest { ok: boolean; reason?: string; emailed?: boolean; email?: string | null; ticket?: boolean }

/** "Forgot PIN?": email a code to the account and open a ticket. */
export async function requestPinReset(profileId: string): Promise<ResetRequest> {
  try {
    // The account must know this profile has a PIN before it can reset it.
    const p = getProfile(profileId);
    if (p) {
      const userId = viewerAccountId();
      if (userId) await db.from('viewer_profiles').upsert(toRow(userId, p), { onConflict: 'user_id,id' });
    }
    const { data, error } = await supabase.functions.invoke('profile-pin-reset', { body: { action: 'request', profile_id: profileId } });
    if (error) return { ok: false, reason: 'network' };
    const r = data as { ok?: boolean; reason?: string; emailed?: boolean; email?: string | null; ticket?: boolean } | null;
    if (!r?.ok) return { ok: false, reason: r?.reason || 'error' };
    return { ok: true, emailed: !!r.emailed, email: r.email ?? null, ticket: !!r.ticket };
  } catch { return { ok: false, reason: 'network' }; }
}

/** The emailed code: right → the PIN is gone here and on the account. */
export async function verifyPinReset(profileId: string, code: string): Promise<{ ok: boolean; reason?: string; left?: number }> {
  try {
    const { data, error } = await supabase.functions.invoke('profile-pin-reset', { body: { action: 'verify', profile_id: profileId, code } });
    if (error) return { ok: false, reason: 'network' };
    const r = data as { ok?: boolean; reason?: string; left?: number } | null;
    if (!r?.ok) return { ok: false, reason: r?.reason || 'error', left: r?.left };
    const list = loadProfiles();
    saveProfiles(list.map((p) => (p.id === profileId ? { ...p, pinHash: null, t: Date.now() } : p)));
    ls.del(FAIL_PREFIX + profileId);
    return { ok: true };
  } catch { return { ok: false, reason: 'network' }; }
}

// ── which profile is live ──────────────────────────────────────────────────

let currentId = MAIN_PROFILE;

/** Move the per-person box settings from one profile to another. */
export function swapProfileStorage(from: string, to: string): void {
  if (from === to) return;
  const live = ls.keys().filter((k) => PROFILE_KEYS.includes(k) || PROFILE_PREFIXES.some((p) => k.startsWith(p)));
  for (const k of live) {
    const v = ls.get(k);
    if (v != null) ls.set(`${STASH_PREFIX}${from}:${k}`, v);
    ls.del(k);
  }
  const prefix = `${STASH_PREFIX}${to}:`;
  for (const k of ls.keys()) {
    if (!k.startsWith(prefix)) continue;
    const v = ls.get(k);
    if (v != null) ls.set(k.slice(prefix.length), v);
    ls.del(k);
  }
  ls.set(LIVE_OWNER_KEY, to);
}

/** Make a profile the one in use on this box, now (no reload). */
function applyProfile(id: string): void {
  const p = loadProfiles().find((x) => x.id === id) ?? loadProfiles()[0];
  const owner = ls.get(LIVE_OWNER_KEY) || MAIN_PROFILE;
  if (owner !== p.id) swapProfileStorage(owner, p.id);
  currentId = p.id;
  setKidsLevel(p.kidsLevel);
  setViewerProfile(p.id);
  ss.set(SESSION_KEY, `${accountKey()}|${p.id}`);
  emit();
}

/** At app start, before anything loads: the profile this run was using (after
 *  a profile switch reloaded the app) or the last one, so a Kids profile's
 *  filters are on before the first list is fetched. Reads only the signed-in
 *  user's id from the stored session. initProfiles confirms it. */
export function bootProfilesSync(): void {
  try {
    let acc = 'device';
    try {
      const raw = localStorage.getItem('sb-falmwzhvxoefvkfsiylp-auth-token');
      const id = raw ? (JSON.parse(raw) as { user?: { id?: unknown } })?.user?.id : null;
      if (typeof id === 'string' && id) acc = id;
    } catch { /* no session */ }
    const list = loadProfiles(acc);
    const session = ss.get(SESSION_KEY);
    const sessionId = session && session.startsWith(`${acc}|`) ? session.slice(acc.length + 1) : null;
    const p = list.find((x) => x.id === (sessionId ?? ls.get(LAST_PREFIX + acc))) ?? list[0];
    currentId = p.id;
    setKidsLevel(p.kidsLevel);
    setViewerProfile(p.id);
  } catch { /* initProfiles will settle it */ }
}

let init: Promise<{ needsPick: boolean }> | null = null;
let lastAccount: string | null | undefined;

/** Work out who is watching at start. `needsPick`: show "Who's watching?" —
 *  nothing picked in this run of the app yet, and a choice to make (more
 *  than one profile, or a PIN to ask for). A box with just the main profile
 *  opens straight to Home; profiles are introduced by a popup instead
 *  (ProfilesIntroPopup). */
export function initProfiles(): Promise<{ needsPick: boolean }> {
  init ??= (async () => {
    await resolveViewer();
    const acc = accountKey();
    lastAccount = viewerAccountId();
    const list = loadProfiles(acc);
    const session = ss.get(SESSION_KEY);
    const sessionId = session && session.startsWith(`${acc}|`) ? session.slice(acc.length + 1) : null;
    const last = ls.get(LAST_PREFIX + acc);
    const start = list.find((p) => p.id === (sessionId ?? last)) ?? list[0];
    applyProfile(start.id);
    // A change of account (sign-in, sign-out) means that account's profiles.
    onViewerChange(() => {
      const nowAcc = viewerAccountId();
      if (nowAcc === lastAccount) return;
      lastAccount = nowAcc;
      applyProfile(ls.get(LAST_PREFIX + accountKey()) || MAIN_PROFILE);
      void pullProfiles();
    });
    void pullProfiles();
    const needsPick = !sessionId && (list.length > 1 || list.some((p) => !!p.pinHash));
    return { needsPick };
  })();
  return init;
}

/** The one-time popup that introduces profiles (see ProfilesIntroPopup). */
export const profilesIntroSeen = (): boolean => !!ls.get(INTRO_KEY);
export const markProfilesIntroSeen = (): void => ls.set(INTRO_KEY, '1');

/** The one the picker starts on. */
export const lastPickedId = (): string => ls.get(LAST_PREFIX + accountKey()) || MAIN_PROFILE;

/** Picked on "Who's watching?" (its PIN already checked). 'reload' when the
 *  app must restart to show that profile's setup; the caller does it. */
export function pickProfile(id: string): 'same' | 'reload' {
  ls.set(INTRO_KEY, '1');
  ls.set(LAST_PREFIX + accountKey(), id);
  if (id === currentId) { ss.set(SESSION_KEY, `${accountKey()}|${id}`); return 'same'; }
  applyProfile(id);
  return 'reload';
}

/** Tests only. */
export function __resetProfilesForTests(): void {
  init = null; currentId = MAIN_PROFILE; lastAccount = undefined; setKidsLevel(null);
}
