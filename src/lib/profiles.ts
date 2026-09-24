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
// A KIDS PROFILE STAYS ONE until someone picks another profile. The box
// remembers that it was on one (the hold): a switch nobody asked for — the
// account signed out or couldn't be confirmed at start, the profile deleted
// elsewhere — keeps its limits on whichever profile the box falls to. Picking
// a grown-up profile ends it; when the Kids profile was another account's,
// that takes one of that account's grown-up PINs.
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
import {
  MAIN_PROFILE, onViewerChange, resolveViewer, setViewerProfile, storedAccountId, viewerAccountConfirmed, viewerAccountId,
} from '@/lib/viewer';

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
/** The profile in use changed by itself and the app should restart on Home
 *  (see takeProfileRestart). */
export const PROFILE_RESTART_EVENT = 'smc-profiles:restart';

const LIST_PREFIX = 'smc-profiles-v1:';
const PULLED_PREFIX = 'smc-profiles-pulled:';
const LAST_PREFIX = 'smc-last-profile:';
const SESSION_KEY = 'smc-active-profile';
const INTRO_KEY = 'smc-profiles-intro-seen';
const LIVE_OWNER_KEY = 'smc-profile-live';
const STASH_PREFIX = 'smc-pstash:';
const FAIL_PREFIX = 'smc-pin-fails:';
const DELETED_PREFIX = 'smc-profiles-deleted:';
const KIDS_HOLD_KEY = 'smc-kids-hold';
const RESTART_KEY = 'smc-profile-restart';
/** The grown-up pad's own count of wrong tries (profile ids are 6 letters). */
const GROWNUP_PAD = 'grownup';

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
  /** False when it didn't fit. */
  set: (k: string, v: string): boolean => { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  keys: (): string[] => {
    try { const out: string[] = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k) out.push(k); } return out; } catch { return []; }
  },
};
const ss = {
  get: (k: string): string | null => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
  del: (k: string) => { try { sessionStorage.removeItem(k); } catch { /* ignore */ } },
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

/** The profile being watched as. One the box fell to from a Kids profile
 *  carries that profile's limits (see the hold). */
export function activeProfile(): Profile {
  const list = loadProfiles();
  const p = list.find((x) => x.id === currentId) ?? list[0];
  const held = p.kidsLevel ? null : loadHold()?.level ?? null;
  return held ? { ...p, kidsLevel: held } : p;
}

/** Grown-up profiles with a PIN, and the account their PIN was made on: this
 *  account's, and while a Kids profile from another account is held, that
 *  account's too. */
function grownUpCandidates(): Array<{ p: Profile; acc: string }> {
  const acc = accountKey();
  const out = loadProfiles(acc).filter((p) => !p.kidsLevel && !!p.pinHash).map((p) => ({ p, acc }));
  const hold = loadHold();
  if (hold && hold.acc !== acc) {
    for (const p of loadProfiles(hold.acc)) if (!p.kidsLevel && p.pinHash) out.push({ p, acc: hold.acc });
  }
  return out;
}

/** The grown-up profiles a Kids profile would need a PIN from. */
export const grownUpsWithPin = (): Profile[] => grownUpCandidates().map((c) => c.p);

/** Whether leaving the held Kids limits for a grown-up profile takes a
 *  grown-up's PIN: they came from another account (signed out since) that
 *  has grown-up PINs. On the same account its own PINs decide, as always. */
export function kidsHoldNeedsGrownUp(): boolean {
  const hold = loadHold();
  if (!hold || hold.acc === accountKey()) return false;
  return hasGrownUpPin(hold.acc);
}

const hasGrownUpPin = (acc: string): boolean => loadProfiles(acc).some((p) => !p.kidsLevel && !!p.pinHash);

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

/** Upload one profile; true once the account has it. */
const pushProfile = async (p: Profile): Promise<boolean> => {
  const userId = viewerAccountId();
  if (!userId) return false;
  try {
    const { error } = await db.from('viewer_profiles').upsert(toRow(userId, p), { onConflict: 'user_id,id' });
    return !error;
  } catch { return false; /* offline */ }
};

/** Remove a profile, and its history, from the account; true once done. */
const sendDelete = async (userId: string, id: string): Promise<boolean> => {
  try {
    const { error } = await db.from('viewer_profiles').delete().eq('user_id', userId).eq('id', id);
    if (error) return false;
    await db.from('watch_history').delete().eq('user_id', userId).like('item_key', `p:${id}:%`);
    return true;
  } catch { return false; /* offline */ }
};

// Profiles deleted on this box that the account may still have: the next
// pull deletes them again rather than bringing them back.
const loadDeleted = (acc: string): string[] => {
  try { const v = JSON.parse(ls.get(DELETED_PREFIX + acc) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
};
const saveDeleted = (acc: string, ids: string[]) => {
  if (ids.length) ls.set(DELETED_PREFIX + acc, JSON.stringify(ids.slice(-MAX_PROFILES * 4)));
  else ls.del(DELETED_PREFIX + acc);
};

let pulling: Promise<void> | null = null;
// A pull skipped for a session not refreshed yet: it runs when that comes
// through (see initProfiles).
let pullWaiting = false;

/** Bring the box's list up to date with the account's. */
export function pullProfiles(): Promise<void> {
  pulling ??= doPull().finally(() => { pulling = null; });
  return pulling;
}

async function doPull(): Promise<void> {
  await resolveViewer();
  const userId = viewerAccountId();
  // A session not refreshed yet (offline at start) reads as nobody: an empty
  // list that must not be taken for the account's.
  if (!userId || !viewerAccountConfirmed()) { pullWaiting = !!userId; return; }
  pullWaiting = false;
  const startedAt = Date.now();
  try {
    const { data, error } = await db.from('viewer_profiles').select('*').eq('user_id', userId);
    if (error || !Array.isArray(data) || viewerAccountId() !== userId) return;
    const local = loadProfiles(userId);
    const was = local.find((p) => p.id === currentId);
    const pulledAt = Number(ls.get(PULLED_PREFIX + userId)) || 0;
    const deleted = loadDeleted(userId);
    const rows = (data as Row[]).filter((r) => !deleted.includes(r.id));
    // Deleted here: again on the account; forgotten once it's gone there.
    const pending = deleted.filter((id) => (data as Row[]).some((r) => r.id === id));
    for (const id of pending) void sendDelete(userId, id);
    saveDeleted(userId, pending);
    const pushes: Array<Promise<boolean>> = [];
    // What this box has that the account doesn't: made here since the last
    // pull (maybe not uploaded yet) goes up; older is gone from the account,
    // deleted elsewhere. On the first pull that is all of it.
    const keep = (l: Profile) => l.id === MAIN_PROFILE || l.t >= pulledAt;
    const upload = (l: Profile) => (l.id === MAIN_PROFILE ? l.t > 0 : l.t >= pulledAt);
    if (rows.length === 0) {
      for (const p of local) if (upload(p)) pushes.push(pushProfile(p));
      saveProfiles(local.filter(keep), userId);
    } else {
      const cloud = new Map(rows.map((r) => [r.id, fromRow(r)]));
      const merged: Profile[] = [];
      for (const [id, c] of cloud) {
        const l = local.find((p) => p.id === id);
        merged.push(l && l.t > c.t ? l : c);
        if (l && l.t > c.t) pushes.push(pushProfile(l));
      }
      for (const l of local) {
        if (!cloud.has(l.id) && keep(l)) { merged.push(l); if (upload(l)) pushes.push(pushProfile(l)); }
      }
      saveProfiles(merged, userId);
    }
    // Something didn't go up: it still counts as made since the last pull.
    if ((await Promise.all(pushes)).every(Boolean)) ls.set(PULLED_PREFIX + userId, String(startedAt));
    if (viewerAccountId() !== userId) return;
    // The profile in use may have been removed, or made or unmade a Kids
    // one, elsewhere. Removed: the box falls to the main profile (keeping a
    // Kids profile's limits) and restarts on it.
    const still = loadProfiles(userId).find((p) => p.id === currentId);
    if (!still) { if (applyProfile(MAIN_PROFILE)) restartOnHome(); }
    else {
      if (still.kidsLevel) saveHold(still.kidsLevel);
      else if (was?.kidsLevel) clearHold();
      setKidsLevel(still.kidsLevel ?? loadHold()?.level ?? null);
      if (was?.kidsLevel !== still.kidsLevel) emit();
    }
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
  void pushProfile(p);
  return p;
}

export function updateProfile(id: string, patch: Partial<Pick<Profile, 'name' | 'avatar' | 'kidsLevel' | 'pinHash'>>): Profile | null {
  const list = loadProfiles();
  const cur = list.find((p) => p.id === id);
  if (!cur) return null;
  const next = clean({ ...cur, ...patch, id, t: Date.now() });
  saveProfiles(list.map((p) => (p.id === id ? next : p)));
  void pushProfile(next);
  if (id === currentId) {
    // Made a Kids one, or (by a grown-up, in Manage) not one any more.
    if (next.kidsLevel) saveHold(next.kidsLevel);
    else if (cur.kidsLevel) clearHold();
    setKidsLevel(next.kidsLevel ?? loadHold()?.level ?? null);
  }
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
    // Remembered until a pull finds it gone from the account, so an offline
    // or failed delete isn't undone by that pull.
    saveDeleted(userId, [...loadDeleted(userId).filter((x) => x !== id), id]);
    void sendDelete(userId, id);
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

const countFail = (id: string) => {
  const n = loadFails(id).n + 1;
  const until = n >= LOCK_AFTER ? Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (n - LOCK_AFTER)) : 0;
  ls.set(FAIL_PREFIX + id, JSON.stringify({ n, until }));
};

/** Check a PIN. A wrong one counts; from the fifth, each costs a wait that
 *  doubles (30 s, 1 min, 2 min … up to 15). */
export function checkPin(profile: Profile, pin: string): boolean {
  if (!profile.pinHash) return true;
  if (pinLockedFor(profile.id) > 0) return false;
  if (hashPin(profile.id, pin) === profile.pinHash) { ls.del(FAIL_PREFIX + profile.id); return true; }
  countFail(profile.id);
  return false;
}

/** ms until the grown-up pad accepts another try (0 = now). */
export const grownUpPadLockedFor = (): number => pinLockedFor(GROWNUP_PAD);

/** The grown-up pad: any grown-up's PIN. Found by its hash, so one grown-up's
 *  PIN never counts as a wrong try against another; a wrong one counts
 *  against the pad, with the same pauses as a profile's. */
export function checkGrownUpPin(pin: string): boolean {
  if (grownUpPadLockedFor() > 0) return false;
  const hit = grownUpCandidates().find(({ p, acc }) => pinLockedFor(p.id) === 0 && hashPin(p.id, pin, acc) === p.pinHash);
  if (!hit) { countFail(GROWNUP_PAD); return false; }
  ls.del(FAIL_PREFIX + hit.p.id);
  ls.del(FAIL_PREFIX + GROWNUP_PAD);
  return true;
}

export interface ResetRequest { ok: boolean; reason?: string; emailed?: boolean; email?: string | null; ticket?: boolean }

/** "Forgot PIN?": email a code to the account and open a ticket. */
export async function requestPinReset(profileId: string): Promise<ResetRequest> {
  try {
    // The account's copy decides. A PIN cleared there (by support from the
    // Hub, or with a code on another box) is cleared here too and needs no
    // reset; one set on this box and not uploaded yet goes up first.
    await pullProfiles();
    const p = getProfile(profileId);
    if (!p?.pinHash) { ls.del(FAIL_PREFIX + profileId); return { ok: false, reason: 'no_pin' }; }
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

/** Move a value to another key. Removed first, so a big one (an AI-image
 *  background) needs no room for two copies; put back if it didn't fit. */
const moveKey = (from: string, to: string) => {
  const v = ls.get(from);
  ls.del(from);
  if (v != null && !ls.set(to, v)) ls.set(from, v);
};

/** Move the per-person box settings from one profile to another. */
export function swapProfileStorage(from: string, to: string): void {
  if (from === to) return;
  const live = ls.keys().filter((k) => PROFILE_KEYS.includes(k) || PROFILE_PREFIXES.some((p) => k.startsWith(p)));
  for (const k of live) moveKey(k, `${STASH_PREFIX}${from}:${k}`);
  const prefix = `${STASH_PREFIX}${to}:`;
  for (const k of ls.keys()) {
    if (k.startsWith(prefix)) moveKey(k, k.slice(prefix.length));
  }
  ls.set(LIVE_OWNER_KEY, to);
}

// ── the hold ───────────────────────────────────────────────────────────────

interface KidsHold { level: KidsLevel; acc: string }
const loadHold = (): KidsHold | null => {
  try {
    const h = JSON.parse(ls.get(KIDS_HOLD_KEY) || 'null');
    if (h && (h.level === 'little' || h.level === 'kids' || h.level === 'teen') && typeof h.acc === 'string') return { level: h.level, acc: h.acc };
  } catch { /* none */ }
  return null;
};
// A hold from another account whose grown-ups have PINs stays theirs when the
// box moves to another Kids profile: going on from one of this box's Kids
// profiles to its grown-up one still takes one of their PINs.
const saveHold = (level: KidsLevel, acc: string = accountKey()) => {
  const prev = loadHold();
  const owner = prev && prev.acc !== acc && hasGrownUpPin(prev.acc) ? prev.acc : acc;
  ls.set(KIDS_HOLD_KEY, JSON.stringify({ level, acc: owner }));
};
const clearHold = () => ls.del(KIDS_HOLD_KEY);

/** The app shows a profile's setup as it was at start: after a switch it
 *  didn't ask for, restart on Home — now when Home is up (ProfileGate hears
 *  this), else when it next opens (a sign-in comes back from /auth). */
function restartOnHome(): void {
  ss.set(RESTART_KEY, '1');
  try { window.dispatchEvent(new CustomEvent(PROFILE_RESTART_EVENT)); } catch { /* ignore */ }
}

/** True once when a restart is waiting (see restartOnHome). */
export function takeProfileRestart(): boolean {
  if (!ss.get(RESTART_KEY)) return false;
  ss.del(RESTART_KEY);
  return true;
}

/** Make a profile the one in use on this box, now (no reload). A Kids one
 *  starts the hold; any other keeps a hold's limits (pickProfile ends it).
 *  True when the home setup was swapped for that profile's. */
function applyProfile(id: string): boolean {
  const p = loadProfiles().find((x) => x.id === id) ?? loadProfiles()[0];
  const owner = ls.get(LIVE_OWNER_KEY) || MAIN_PROFILE;
  const swapped = owner !== p.id;
  if (swapped) swapProfileStorage(owner, p.id);
  currentId = p.id;
  if (p.kidsLevel) saveHold(p.kidsLevel);
  setKidsLevel(p.kidsLevel ?? loadHold()?.level ?? null);
  setViewerProfile(p.id);
  ss.set(SESSION_KEY, `${accountKey()}|${p.id}`);
  emit();
  return swapped;
}

/** At app start, before anything loads: the profile this run was using (after
 *  a profile switch reloaded the app) or the last one, so a Kids profile's
 *  filters are on before the first list is fetched. Reads only the signed-in
 *  user's id from the stored session. initProfiles confirms it. */
export function bootProfilesSync(): void {
  try {
    const acc = storedAccountId() ?? 'device';
    const list = loadProfiles(acc);
    const session = ss.get(SESSION_KEY);
    const sessionId = session && session.startsWith(`${acc}|`) ? session.slice(acc.length + 1) : null;
    const p = list.find((x) => x.id === (sessionId ?? ls.get(LAST_PREFIX + acc))) ?? list[0];
    currentId = p.id;
    if (p.kidsLevel) saveHold(p.kidsLevel, acc);
    setKidsLevel(p.kidsLevel ?? loadHold()?.level ?? null);
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
    // A change of account (sign-in, sign-out) means that account's profiles,
    // and a restart on Home to show the one it lands on. A Kids profile's
    // limits stay (the hold) until someone picks.
    onViewerChange(() => {
      const nowAcc = viewerAccountId();
      if (nowAcc === lastAccount) {
        // The same account, its session through at last (back online).
        if (pullWaiting && viewerAccountConfirmed()) void pullProfiles();
        return;
      }
      lastAccount = nowAcc;
      if (applyProfile(ls.get(LAST_PREFIX + accountKey()) || MAIN_PROFILE)) restartOnHome();
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
export const markProfilesIntroSeen = (): void => { ls.set(INTRO_KEY, '1'); };

/** The one the picker starts on. */
export const lastPickedId = (): string => ls.get(LAST_PREFIX + accountKey()) || MAIN_PROFILE;

/** Picked on "Who's watching?" (its PIN, and a grown-up's when the hold
 *  asks for one, already checked). A grown-up profile ends the hold. 'reload'
 *  when the app must restart to show that profile's setup; the caller does it. */
export function pickProfile(id: string): 'same' | 'reload' {
  ls.set(INTRO_KEY, '1');
  ls.set(LAST_PREFIX + accountKey(), id);
  // Picked in this run: "Who's watching?" isn't asked again when Home opens
  // again (after a trip to /auth).
  if (init) init = Promise.resolve({ needsPick: false });
  const p = loadProfiles().find((x) => x.id === id);
  const released = !!p && !p.kidsLevel && !!loadHold();
  if (released) clearHold();
  if (id === currentId && !released) { ss.set(SESSION_KEY, `${accountKey()}|${id}`); return 'same'; }
  applyProfile(id);
  return 'reload';
}

// ── this box's profiles, brought to the account ────────────────────────────

/** Profiles made on this box before signing in (the account's list doesn't
 *  have them): offered in Manage, to bring over. */
export function boxProfilesToBring(): Profile[] {
  const userId = viewerAccountId();
  if (!userId) return [];
  const have = new Set(loadProfiles(userId).map((p) => p.id));
  return loadProfiles('device').filter((p) => p.id !== MAIN_PROFILE && !have.has(p.id));
}

/** Move this box's profiles to the signed-in account: they leave the box's
 *  list, and their history, resume points and lists here go with them (their
 *  setup and favourites are kept by profile, so they follow). How many moved. */
export function bringBoxProfiles(): number {
  const userId = viewerAccountId();
  if (!userId) return 0;
  const list = loadProfiles(userId);
  const moving = boxProfilesToBring().slice(0, Math.max(0, MAX_PROFILES - list.length));
  if (!moving.length) return 0;
  let position = Math.max(0, ...list.map((x) => x.position));
  const now = Date.now();
  const moved = moving.map((p) => ({ ...p, position: ++position, t: now }));
  const ids = new Set(moved.map((p) => p.id));
  saveProfiles([...list, ...moved], userId);
  for (const p of moved) void pushProfile(p);
  saveProfiles(loadProfiles('device').filter((p) => !ids.has(p.id)), 'device');
  const lastOnBox = ls.get(LAST_PREFIX + 'device');
  if (lastOnBox && ids.has(lastOnBox)) ls.set(LAST_PREFIX + 'device', MAIN_PROFILE);
  for (const k of ls.keys()) {
    for (const id of ids) {
      const tail = `device:p:${id}`;
      if (k === tail || k.endsWith(`:${tail}`)) {
        const to = `${k.slice(0, k.length - tail.length)}${userId}:p:${id}`;
        if (ls.get(to) == null) moveKey(k, to); else ls.del(k);
      }
    }
  }
  return moved.length;
}

/** Tests only. */
export function __resetProfilesForTests(): void {
  init = null; pulling = null; pullWaiting = false; currentId = MAIN_PROFILE; lastAccount = undefined; setKidsLevel(null);
}
