// Messages to the TVs on a Live TV line (the device-inbox edge function).
//
// A line's owner (or an admin) sees the Snow Media Center installs signed
// into the line and sends them a short message; every TV it was sent to
// shows it as a popup over anything, playback included (DeviceMessageHost).
// This file is the box's side of it, plus the two calls the owner's screen
// makes (LineDevicesPanel):
//
//   * The inbox key: 48 random characters made once per install and kept
//     with Preferences (localStorage as a fallback). It is what this install
//     is known by to device-inbox and to nothing else: never logged, never
//     sent anywhere but device-inbox.
//   * Register: tells the server which line this install is signed into (the
//     server checks the line against the panel, hence the password). After
//     every Live TV sign-in (playerSigninCapture), and otherwise at most once
//     a day per line — or at once when the line in use is not the one last
//     registered. Again whenever a check-in hears 'unknown_key'.
//   * Check in: every minute while the app is on screen, straight away when
//     it comes back, never while it is in the background. Not in the demo,
//     and not with no line signed in. Unlike the pausable intervals it keeps
//     going while a stream plays: that is exactly when a message about the
//     line ("too many people are on it") matters.
//   * The messages a check-in brings wait here, in memory, for the host to
//     show one at a time; dismiss tells the server it was read.
//
// "Watching" (isWatchingNow) is whether a player is up on this box: the
// classes the players put on <html> — snowplayer-fullscreen (any native
// fullscreen player: a channel, the Guide, Plex, movies, recordings,
// Multi-Screen; it stays through a stall or a pause), snowplayer-preview
// (a channel in the preview box) and streaming-active (the WebView player
// for Live TV movies while it plays). The same signals the review prompt
// reads. Plex's own flag (lib/plex isPlexPlaybackActive) is left out: on the
// TV Plex plays in the native player, and lib/plex is far too big to pull
// into Home for one boolean.
import { supabase } from '@/integrations/supabase/client';
import { isDemo } from '@/lib/demoMode';
import { parseDeviceInfo } from '@/lib/appInfo';
import { loadVersion } from '@/hooks/useVersion';
import { loadCreds, type XtreamCreds } from '@/lib/xtream';

export const POLL_MS = 60_000;
/** A line already registered is registered again after this long. */
export const REGISTER_EVERY_MS = 24 * 60 * 60_000;
/** After a failed register, an 'unknown_key' doesn't ask again before this. */
const REREGISTER_GAP_MS = 10 * 60_000;
export const MAX_BODY = 200;
/** More than this many waiting is a flood: the oldest are let go. */
const MAX_QUEUE = 20;

const KEY_STORE = 'smc-device-inbox-key';
const REG_STORE = 'smc-device-inbox-reg-v1';
const KEY_LEN = 48;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export type MessageSender = 'admin' | 'owner';

export interface DeviceMessage {
  id: string;
  body: string;
  sender: MessageSender;
  created_at: string;
}

export interface LineDevice {
  ref: string;
  label: string;
  app_version: string | null;
  last_seen_at: string | null;
  watching_now: boolean;
  registered_at: string | null;
}

/**
 * Flat shapes, not discriminated unions: this project compiles with
 * `strict: false`, where narrowing on `ok` does not hold (see lineEmail.ts).
 */
export interface DevicesOutcome {
  ok: boolean;
  devices?: LineDevice[];
  /** Set when ok is false: 'not_signed_in', 'not_owner', or what went wrong. */
  reason?: string;
}

export interface SendOutcome {
  ok: boolean;
  sent?: number;
  /** Set when ok is false: 'bad_body', 'rate_limited', 'not_owner', 'not_signed_in', ... */
  reason?: string;
}

type Line = Pick<XtreamCreds, 'host' | 'username' | 'password'>;
type Reply = Record<string, unknown> & { ok?: unknown; reason?: unknown };

// --- the call --------------------------------------------------------------

/** One call to device-inbox. Never throws; a failure comes back as { ok: false, reason }. */
async function call(body: Record<string, unknown>): Promise<Reply> {
  try {
    const { data, error } = await supabase.functions.invoke('device-inbox', { body });
    if (!error) return data && typeof data === 'object' ? (data as Reply) : { ok: false, reason: 'bad_response' };
    // A non-2xx comes back as data: null and an error with the Response on
    // it: 401 not_signed_in, 403 not_owner, 400 bad_body / bad_request, 500
    // error, each with { ok: false, reason } in the body. Every other refusal
    // (unknown_key, rate_limited, bad_line, ...) is a 200 with ok: false.
    const res = (error as { context?: Response }).context;
    try {
      const parsed = res && typeof res.clone === 'function' ? await res.clone().json() : null;
      if (parsed && typeof parsed === 'object' && typeof (parsed as Reply).reason === 'string') return { ...(parsed as Reply), ok: false };
    } catch { /* not JSON */ }
    if (res?.status === 401) return { ok: false, reason: 'not_signed_in' };
    if (res?.status === 403) return { ok: false, reason: 'not_owner' };
    if (res?.status === 404) return { ok: false, reason: 'not_deployed' };
    return { ok: false, reason: 'network' };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

// --- the inbox key -----------------------------------------------------------

/** 48 characters from crypto.getRandomValues, each byte mapped without bias (bytes past 247 are drawn again). */
function newKey(): string | null {
  try {
    const c = globalThis.crypto;
    if (!c?.getRandomValues) return null;
    let out = '';
    while (out.length < KEY_LEN) {
      const bytes = c.getRandomValues(new Uint8Array(64));
      for (let i = 0; i < bytes.length && out.length < KEY_LEN; i += 1) {
        if (bytes[i] < 248) out += ALPHABET[bytes[i] % 62];
      }
    }
    return out;
  } catch {
    return null;
  }
}

const validKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9]{48}$/.test(v);

async function readKey(): Promise<string | null> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: KEY_STORE });
    if (validKey(value)) return value;
  } catch { /* not native */ }
  try {
    const raw = localStorage.getItem(KEY_STORE);
    if (validKey(raw)) return raw;
  } catch { /* private mode */ }
  return null;
}

async function writeKey(key: string): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: KEY_STORE, value: key });
  } catch { /* not native */ }
  try { localStorage.setItem(KEY_STORE, key); } catch { /* private mode */ }
}

let keyPromise: Promise<string | null> | null = null;

/** This install's inbox key, made the first time it is asked for. null only when the box can't make one. */
export function getInboxKey(): Promise<string | null> {
  if (!keyPromise) {
    keyPromise = (async () => {
      const found = await readKey();
      if (found) return found;
      const made = newKey();
      if (made) await writeKey(made);
      return made;
    })();
    // Not cached when nothing came of it: the next ask tries again.
    void keyPromise.then((k) => { if (!k) keyPromise = null; });
  }
  return keyPromise;
}

// --- what this box says about itself ---------------------------------------

/** What the owner's list calls this box: its model from the WebView (a Fire TV's AFT code with "Fire TV" in front), else "Android TV". */
export function deviceLabel(): string {
  try {
    const m = parseDeviceInfo().model;
    // A reduced agent ("Android 10; K") says nothing about the model.
    if (m && m.length > 1) return (/^AFT/i.test(m) ? `Fire TV ${m}` : m).slice(0, 64);
  } catch { /* fall through */ }
  return 'Android TV';
}

/** Whether a player is up on this box right now (see the top of this file). */
export function isWatchingNow(): boolean {
  try {
    const cl = document.documentElement.classList;
    return cl.contains('snowplayer-fullscreen') || cl.contains('snowplayer-preview') || cl.contains('streaming-active');
  } catch {
    return false;
  }
}

// --- registering a line --------------------------------------------------------

/** host + username, the way the line is told apart (never the password). */
const lineId = (c: Pick<XtreamCreds, 'host' | 'username'>): string =>
  `${c.host.trim().toLowerCase().replace(/\/+$/, '')}|${c.username.trim().toLowerCase()}`;

interface RegMemo { last: string; at: Record<string, number> }

function readMemo(): RegMemo {
  try {
    const raw = localStorage.getItem(REG_STORE);
    const p = raw ? JSON.parse(raw) : null;
    if (p && typeof p === 'object' && typeof p.at === 'object' && p.at) return { last: typeof p.last === 'string' ? p.last : '', at: p.at };
  } catch { /* fall through */ }
  return { last: '', at: {} };
}

function writeMemo(m: RegMemo): void {
  try { localStorage.setItem(REG_STORE, JSON.stringify(m)); } catch { /* private mode: registers again next start */ }
}

const registering = new Map<string, Promise<boolean>>();
const lastAttempt = new Map<string, number>();

async function doRegister(creds: Line, id: string): Promise<boolean> {
  const key = await getInboxKey();
  if (!key) return false;
  let version = '';
  try { version = (await loadVersion()).version || ''; } catch { /* sent empty */ }
  const res = await call({
    action: 'register',
    host: creds.host,
    username: creds.username,
    password: creds.password,
    inbox_key: key,
    device_label: deviceLabel(),
    app_version: version,
  });
  if (res.ok !== true) return false;
  const m = readMemo();
  m.at[id] = Date.now();
  m.last = id;
  // Lines long gone off the box don't pile up.
  for (const k of Object.keys(m.at)) if (Date.now() - m.at[k] > 7 * REGISTER_EVERY_MS) delete m.at[k];
  writeMemo(m);
  return true;
}

/**
 * Tell device-inbox this install is signed into `creds`' line. `force` (a
 * sign-in, an 'unknown_key') registers whatever the memo says; otherwise only
 * when the line is not the one last registered or that was a day ago. Never
 * throws; true when the server took it (or nothing needed doing).
 */
export async function registerLine(creds: Line | null | undefined, opts: { force?: boolean } = {}): Promise<boolean> {
  if (isDemo()) return false;
  if (!creds?.host || !creds.username || !creds.password) return false;
  const id = lineId(creds);
  if (!opts.force) {
    const m = readMemo();
    if (m.last === id && Date.now() - (m.at[id] ?? 0) < REGISTER_EVERY_MS) return true;
    // Tried a moment ago and the server said no (a wrong password, an
    // outage): not again every minute.
    if (Date.now() - (lastAttempt.get(id) ?? 0) < REREGISTER_GAP_MS) return false;
  }
  const busy = registering.get(id);
  if (busy) return busy;
  lastAttempt.set(id, Date.now());
  const p = doRegister(creds, id).catch(() => false).finally(() => { registering.delete(id); });
  registering.set(id, p);
  return p;
}

// --- the queue -----------------------------------------------------------------

let queue: DeviceMessage[] = [];
/** Dismissed here: never shown again, even if the server's copy of the dismiss was lost. */
const dismissed = new Set<string>();
const listeners = new Set<(q: DeviceMessage[]) => void>();

const emit = () => { const snap = queue; listeners.forEach((fn) => { try { fn(snap); } catch { /* the listener's problem */ } }); };

/** The messages waiting, oldest first (the host shows the first). */
export function pendingMessages(): DeviceMessage[] { return queue; }

/** Hear every change to the queue. Returns the unsubscribe. */
export function subscribe(fn: (q: DeviceMessage[]) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function toMessage(raw: unknown): DeviceMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id) : '';
  const body = typeof r.body === 'string' ? r.body.trim() : '';
  if (!id || !body) return null;
  return {
    id,
    // The server keeps it to 200; a longer one is cut rather than drawn off the card.
    body: body.slice(0, MAX_BODY * 2),
    // Only the server's 'admin' says "from Snow Media"; anything else is the owner's.
    sender: r.sender === 'admin' ? 'admin' : 'owner',
    created_at: typeof r.created_at === 'string' ? r.created_at : '',
  };
}

function addMessages(list: unknown): void {
  if (!Array.isArray(list)) return;
  let changed = false;
  const next = [...queue];
  for (const raw of list) {
    const m = toMessage(raw);
    if (!m) continue;
    if (dismissed.has(m.id)) {
      // Dismissed here, but the server didn't hear it: say so again.
      void call({ action: 'dismiss', inbox_key: currentKey, id: m.id });
      continue;
    }
    if (next.some((q) => q.id === m.id)) continue;
    next.push(m);
    changed = true;
  }
  if (!changed) return;
  // Oldest first; the order they came in when the times can't be read.
  const at = (m: DeviceMessage) => { const t = Date.parse(m.created_at); return Number.isFinite(t) ? t : 0; };
  next.sort((a, b) => at(a) - at(b));
  queue = next.slice(-MAX_QUEUE);
  emit();
}

/** OK / Back on a message: off the queue at once, and the server is told. */
export async function dismissMessage(id: string): Promise<void> {
  dismissed.add(id);
  if (queue.some((m) => m.id === id)) {
    queue = queue.filter((m) => m.id !== id);
    emit();
  }
  if (isDemo()) return;
  const key = await getInboxKey();
  if (!key) return;
  await call({ action: 'dismiss', inbox_key: key, id });
}

// --- checking in ---------------------------------------------------------------

/** The key of the last check-in, for a repeated dismiss (never logged). */
let currentKey = '';
let checking: Promise<void> | null = null;

async function doCheckin(): Promise<void> {
  const creds = await loadCreds().catch(() => null);
  // Signed out of Live TV: nothing to hear about.
  if (!creds?.host || !creds.username || !creds.password) return;
  await registerLine(creds);
  const key = await getInboxKey();
  if (!key) return;
  currentKey = key;
  const res = await call({ action: 'checkin', inbox_key: key, watching: isWatchingNow() });
  if (res.ok === true) { addMessages(res.messages); return; }
  if (res.reason === 'unknown_key') {
    // The server has forgotten this box (or never heard of it): register
    // again, unless that was just tried and failed.
    const id = lineId(creds);
    if (Date.now() - (lastAttempt.get(id) ?? 0) < REREGISTER_GAP_MS) return;
    await registerLine(creds, { force: true });
  }
}

/** One check-in now (one at a time). Nothing in the demo. */
export function checkinNow(): Promise<void> {
  if (isDemo()) return Promise.resolve();
  if (!checking) checking = doCheckin().catch(() => { /* next minute */ }).finally(() => { checking = null; });
  return checking;
}

let stopPolling: (() => void) | null = null;

/**
 * Check in every minute while the app is on screen: at once now and on every
 * return, nothing while it is hidden. Returns the stop. One poller per app;
 * nothing at all in the demo.
 */
export function startDeviceInbox(): () => void {
  if (isDemo()) return () => {};
  if (stopPolling) return stopPolling;
  let timer: ReturnType<typeof setInterval> | null = null;
  let shown = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  const arm = () => { if (!timer) timer = setInterval(() => { void checkinNow(); }, POLL_MS); };
  const disarm = () => { if (timer) { clearInterval(timer); timer = null; } };
  const setShown = (v: boolean) => {
    if (v === shown) return;
    shown = v;
    if (v) { void checkinNow(); arm(); } else disarm();
  };
  const onVisibility = () => setShown(document.visibilityState !== 'hidden');
  document.addEventListener('visibilitychange', onVisibility);
  // The app going to the background on a TV box: Capacitor says so even
  // where the WebView's own visibility events don't.
  let handle: { remove: () => void } | null = null;
  let stopped = false;
  void import('@capacitor/app')
    .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => setShown(!!isActive)))
    .then((h) => { if (stopped) void h.remove(); else handle = h; })
    .catch(() => { /* web: visibilitychange covers it */ });

  if (shown) { void checkinNow(); arm(); }

  stopPolling = () => {
    stopped = true;
    disarm();
    document.removeEventListener('visibilitychange', onVisibility);
    if (handle) { try { void handle.remove(); } catch { /* ignore */ } }
    handle = null;
    stopPolling = null;
  };
  return stopPolling;
}

// --- the owner's side --------------------------------------------------------

const reasonOf = (r: Reply): string => (typeof r.reason === 'string' && r.reason ? r.reason : 'failed');

function toDevice(raw: unknown): LineDevice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const ref = typeof r.ref === 'string' || typeof r.ref === 'number' ? String(r.ref) : '';
  if (!ref) return null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    ref,
    label: str(r.label) ?? '',
    app_version: str(r.app_version),
    last_seen_at: str(r.last_seen_at),
    watching_now: r.watching_now === true,
    registered_at: str(r.registered_at),
  };
}

/** The installs signed into a line (the signed-in Snow Media user must own it, or be an admin). */
export async function listLineDevices(host: string, username: string): Promise<DevicesOutcome> {
  if (isDemo()) return { ok: false, reason: 'demo' };
  const res = await call({ action: 'devices', host, username });
  if (res.ok !== true) return { ok: false, reason: reasonOf(res) };
  const devices = (Array.isArray(res.devices) ? res.devices : []).map(toDevice).filter((d): d is LineDevice => !!d);
  return { ok: true, devices };
}

/** Send `body` to some of a line's installs, or 'all' of them. */
export async function sendLineMessage(host: string, username: string, refs: string[] | 'all', body: string): Promise<SendOutcome> {
  if (isDemo()) return { ok: false, reason: 'demo' };
  const text = body.trim();
  if (!text || text.length > MAX_BODY) return { ok: false, reason: 'bad_body' };
  if (refs !== 'all' && refs.length === 0) return { ok: false, reason: 'no_devices' };
  const res = await call({ action: 'send', host, username, refs, body: text });
  if (res.ok !== true) return { ok: false, reason: reasonOf(res) };
  return { ok: true, sent: typeof res.sent === 'number' ? res.sent : 0 };
}

// Tests only.
export function __resetDeviceInboxForTests(): void {
  stopPolling?.();
  stopPolling = null;
  keyPromise = null;
  queue = [];
  dismissed.clear();
  listeners.clear();
  registering.clear();
  lastAttempt.clear();
  checking = null;
  currentKey = '';
}
