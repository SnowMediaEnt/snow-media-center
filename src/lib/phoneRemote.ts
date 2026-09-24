// Phone remote, the box's side. A phone opens snowmediaent.com/remote, enters
// the code this box shows (or scans its QR) and becomes a remote: the D-pad,
// OK, Back, Home, play/pause, typing into the box's text boxes, and voice.
//
// Pairing goes through the phone-remote edge function. A right code does not
// hand the phone this box: it asks, and the TV shows "Allow this phone?"
// (PhoneRequestPrompt) until its own remote answers. Only an allowed phone
// gets the secret; after that the phone and the box talk over the Realtime
// broadcast channel "smc-remote:<secret>". The box keeps a live connection
// only once it has allowed a phone (it keeps its secret, so a phone stays
// paired across restarts until "Unpair all phones"); while a QR is on screen
// it listens for requests, and a minute after the QR goes away it lets go of
// the code (and of the channel, if it never allowed a phone).
//
// Keys are pressed natively (AppManager.injectKey) so they behave exactly
// like the box's own remote; off-device they fall back to synthetic keydowns.
// Text goes straight into the focused text box. While a text box has focus,
// the phone is told, so it can offer its keyboard.
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { AppManager } from '@/capacitor/AppManager';
import { getDeviceId, trackEvent } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';

const STORE_KEY = 'smc-phone-remote-v1';
const HINT_KEY = 'smc-phone-remote-typing-hint';
export const REMOTE_URL = 'https://snowmediaent.com/remote';
export const PHONE_REMOTE_EVENT = 'smc-phone-remote:changed';
/** Asks the app to go Home (Index listens). */
export const REMOTE_HOME_EVENT = 'smc-phone-remote:home';
/** Asks the voice bar to run a command the phone heard (VoiceCommandHost). */
export const REMOTE_VOICE_EVENT = 'smc-phone-remote:voice';

/** Phone button → Android key code. */
export const REMOTE_KEYS: Record<string, { code: number; key: string; keyCode: number }> = {
  up: { code: 19, key: 'ArrowUp', keyCode: 38 },
  down: { code: 20, key: 'ArrowDown', keyCode: 40 },
  left: { code: 21, key: 'ArrowLeft', keyCode: 37 },
  right: { code: 22, key: 'ArrowRight', keyCode: 39 },
  ok: { code: 23, key: 'Enter', keyCode: 13 },
  enter: { code: 66, key: 'Enter', keyCode: 13 },
  back: { code: 4, key: 'Escape', keyCode: 27 },
  backspace: { code: 67, key: 'Backspace', keyCode: 8 },
  menu: { code: 82, key: 'ContextMenu', keyCode: 93 },
  playpause: { code: 85, key: 'MediaPlayPause', keyCode: 179 },
  ff: { code: 90, key: 'MediaFastForward', keyCode: 228 },
  rw: { code: 89, key: 'MediaRewind', keyCode: 227 },
};

interface Stored { secret: string; /** The TV has allowed a phone in. */ paired?: boolean }
const load = (): Stored | null => {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return s && /^[0-9a-f]{64}$/.test(s.secret) ? s : null; } catch { return null; }
};
const store = (s: Stored | null) => {
  try { if (s) localStorage.setItem(STORE_KEY, JSON.stringify(s)); else localStorage.removeItem(STORE_KEY); } catch { /* full */ }
};

export const typingHintEnabled = (): boolean => { try { return localStorage.getItem(HINT_KEY) !== '0'; } catch { return true; } };
export const setTypingHintEnabled = (on: boolean): void => {
  try { localStorage.setItem(HINT_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  emit();
};

let channel: RealtimeChannel | null = null;
let channelSecret: string | null = null;
/** Phones heard from recently (id → last seen). */
const phones = new Map<string, number>();
const PHONE_GONE_MS = 90_000;

const emit = () => { try { window.dispatchEvent(new CustomEvent(PHONE_REMOTE_EVENT)); } catch { /* ignore */ } };

export const isPaired = (): boolean => !!load()?.paired;
export const connectedPhones = (): number => {
  const now = Date.now();
  for (const [id, at] of phones) if (now - at > PHONE_GONE_MS) phones.delete(id);
  return phones.size;
};

const invoke = async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
  const { data, error } = await supabase.functions.invoke('phone-remote', { body });
  if (error) throw error;
  return (data ?? null) as Record<string, unknown> | null;
};

// ── what the phone asks for ────────────────────────────────────────────────

const isTextField = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement => {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (!(el instanceof HTMLInputElement)) return false;
  const t = (el.type || 'text').toLowerCase();
  return !el.readOnly && !el.disabled && ['text', 'search', 'email', 'password', 'url', 'tel', 'number'].includes(t);
};

/**
 * Whether the phone may be shown what is in this text box. Only search
 * boxes: everything else (sign-in, email, redeem codes, a password shown in
 * the clear) starts empty on the phone, so a text box's contents never go
 * out over the channel.
 */
const echoesValue = (el: HTMLInputElement | HTMLTextAreaElement): boolean => {
  if (el.hasAttribute('data-phone-echo')) return true;
  if (el instanceof HTMLInputElement && el.type === 'password') return false;
  if (el instanceof HTMLInputElement && el.type === 'search') return true;
  if (el.getAttribute('role') === 'searchbox') return true;
  return /search/i.test(`${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`);
};

/** Put text into the focused text box the way typing would (React sees it). */
function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Off-device: the same key as a synthetic keydown/keyup on the focused element. */
function syntheticKey(k: { key: string; keyCode: number }): void {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  const make = (type: string) => {
    const ev = new KeyboardEvent(type, { key: k.key, code: k.key, bubbles: true, cancelable: true });
    try {
      Object.defineProperty(ev, 'keyCode', { get: () => k.keyCode });
      Object.defineProperty(ev, 'which', { get: () => k.keyCode });
    } catch { /* read-only in this engine */ }
    return ev;
  };
  const down = make('keydown');
  const handled = !target.dispatchEvent(down);
  target.dispatchEvent(make('keyup'));
  // A synthetic Enter doesn't click; press the focused control ourselves.
  if (k.key === 'Enter' && !handled && target !== document.body && target.matches('button, a, [role="button"], [tabindex]')) target.click();
}

/**
 * Snow Media Center isn't what the TV shows (another app is in front). Both
 * signals must agree, so a WebView that misreports one never locks the
 * phone out while the app is on screen.
 */
const offScreen = (): boolean => { try { return document.visibilityState === 'hidden' && !document.hasFocus(); } catch { return false; } };

let lastAway = 0;
/** Tell the phones their presses aren't reaching anything they can see. */
function tellAway(): void {
  const now = Date.now();
  if (!channel || now - lastAway < 5_000) return;
  lastAway = now;
  void channel.send({ type: 'broadcast', event: 'box', payload: { t: 'away' } });
}

export async function pressRemoteKey(name: string): Promise<void> {
  const k = REMOTE_KEYS[name];
  if (!k) return;
  // Android's WebView never passes the Menu key to the page, so a native
  // Menu press does nothing; the page's own Options handling (Live TV's
  // channel options) listens for this keydown.
  if (name === 'menu') { syntheticKey(k); return; }
  try {
    const r = (await AppManager.injectKey({ keyCode: k.code })) as unknown as { delivered?: boolean } | undefined;
    // The box dropped it: Snow Media Center isn't the app on screen.
    if (r && r.delivered === false) tellAway();
  } catch {
    syntheticKey(k);
  }
}

type PhoneMessage =
  | { t: 'hello'; id: string }
  | { t: 'bye'; id: string }
  | { t: 'key'; k: string; id?: string }
  | { t: 'text'; v: string; id?: string }
  | { t: 'submit'; id?: string }
  | { t: 'home'; id?: string }
  | { t: 'voice'; v: string; id?: string };

function onPhoneMessage(m: PhoneMessage): void {
  // Every phone page says who it is; anything else isn't one of ours.
  if (!m || typeof m.id !== 'string' || !m.id) return;
  const isNew = !phones.has(m.id);
  phones.set(m.id, Date.now());
  if (isNew && m.t !== 'bye') { emit(); try { trackEvent('phone_remote_connected', 'remote'); } catch { void 0; } }
  switch (m.t) {
    case 'hello':
      sendFieldState('hello');
      if (offScreen()) tellAway();
      break;
    case 'bye':
      phones.delete(m.id); emit();
      break;
    case 'key':
      if (offScreen()) { tellAway(); break; }
      void pressRemoteKey(m.k);
      break;
    case 'text': {
      if (offScreen()) { tellAway(); break; }
      const el = document.activeElement;
      if (isTextField(el)) setFieldValue(el, String(m.v ?? '').slice(0, 500));
      break;
    }
    case 'submit':
      if (offScreen()) { tellAway(); break; }
      void pressRemoteKey('enter');
      break;
    case 'home':
      if (offScreen()) { tellAway(); break; }
      try { window.dispatchEvent(new CustomEvent(REMOTE_HOME_EVENT)); } catch { /* ignore */ }
      break;
    case 'voice':
      if (offScreen()) { tellAway(); break; }
      if (m.v) try { window.dispatchEvent(new CustomEvent(REMOTE_VOICE_EVENT, { detail: String(m.v).slice(0, 300) })); } catch { /* ignore */ }
      break;
  }
}

let lastFieldSent = '';
/**
 * Tell the phones whether a text box has focus on the TV (and, for a search
 * box, what's in it). Only while a phone is there; a focus change that
 * changes nothing sends nothing. A phone's hello is always answered, so a
 * phone that just arrived learns the state. `why` lets the phone tell a
 * reply to its hello from a new text box.
 */
function sendFieldState(why: 'focus' | 'hello'): void {
  if (!channel || connectedPhones() === 0) return;
  const el = document.activeElement;
  const typing = isTextField(el);
  const password = typing && (el as HTMLInputElement).type === 'password';
  const payload = {
    t: 'field',
    typing,
    value: typing && echoesValue(el) ? el.value.slice(0, 500) : '',
    password,
    label: typing ? (el.placeholder || el.getAttribute('aria-label') || '').slice(0, 80) : '',
  };
  const sig = JSON.stringify(payload);
  if (why === 'focus' && sig === lastFieldSent) return;
  lastFieldSent = sig;
  void channel.send({ type: 'broadcast', event: 'box', payload: { ...payload, why } });
}

let focusListening = false;
const onFocusChange = () => { window.setTimeout(() => sendFieldState('focus'), 0); };
/** Back on screen after another app: the phones hear from the box again. */
const onVisibility = () => { if (!offScreen()) sendFieldState('hello'); };

// ── a phone asking to join ─────────────────────────────────────────────────

/** A phone that entered this TV's code and waits for Allow / Don't allow. */
export interface PhoneRequest { rid: string; device: string; at: number }
/** What the edge function may say about the phone (see pairing.ts). */
const PHONE_KINDS = ['An iPhone', 'An iPad', 'An Android phone', 'An Android tablet', 'A phone or computer'];
const REQUEST_TTL_MS = 2 * 60_000;
let requests: PhoneRequest[] = [];
const answered = new Set<string>();

/** The request the TV should ask about now, if any. */
export const pendingPhoneRequest = (): PhoneRequest | null => {
  const now = Date.now();
  requests = requests.filter((r) => now - r.at < REQUEST_TTL_MS);
  return requests[0] ?? null;
};

function onServerMessage(m: { t?: string; rid?: unknown; device?: unknown } | null): void {
  if (!m || m.t !== 'request' || typeof m.rid !== 'string' || !/^[0-9a-f]{16}$/.test(m.rid)) return;
  if (answered.has(m.rid) || requests.some((r) => r.rid === m.rid)) return;
  const device = typeof m.device === 'string' && PHONE_KINDS.includes(m.device) ? m.device : 'A phone';
  requests.push({ rid: m.rid, device, at: Date.now() });
  // The code on screen is used up: the QR shows a new one (for another phone).
  codeUsedUp();
  emit();
}

/**
 * The TV's answer (its own remote pressed Allow or Don't allow). Allowing
 * keeps the box listening from now on, across restarts.
 */
export async function answerPhoneRequest(rid: string, allow: boolean): Promise<boolean> {
  requests = requests.filter((r) => r.rid !== rid);
  answered.add(rid);
  emit();
  const s = load();
  if (!s) return false;
  try {
    const r = await invoke({ op: 'answer', device_id: getDeviceId(), secret: s.secret, rid, allow });
    if (!r?.ok) return false;
  } catch {
    return false;
  }
  if (allow) {
    const now = load();
    if (now?.secret === s.secret) {
      store({ secret: s.secret, paired: true });
      listen(s.secret);
    }
    emit();
  }
  return true;
}

// ── the channel ────────────────────────────────────────────────────────────

/** The channel being left, until the server has let it go. */
let leaving: Promise<unknown> | null = null;

function listen(secret: string): void {
  if (channel && channelSecret === secret) return;
  stopListening();
  channelSecret = secret;
  const topic = `smc-remote:${secret}`;
  // supabase-js hands back a channel that is still being left under the same
  // name, and joining that one again does nothing: wait until it is gone.
  let stale = false;
  try { stale = supabase.getChannels().some((c) => c.topic === `realtime:${topic}`); } catch { /* older client */ }
  if (stale && leaving) {
    void leaving.then(() => { if (channelSecret === secret && !channel) listen(secret); });
    return;
  }
  const ch = supabase.channel(topic, { config: { broadcast: { self: false } } });
  channel = ch;
  ch.on('broadcast', { event: 'phone' }, ({ payload }) => onPhoneMessage(payload as PhoneMessage));
  ch.on('broadcast', { event: 'server' }, ({ payload }) => onServerMessage(payload as { t?: string }));
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') void ch.send({ type: 'broadcast', event: 'box', payload: { t: 'ready' } });
  });
  if (!focusListening) {
    focusListening = true;
    document.addEventListener('focusin', onFocusChange);
    document.addEventListener('focusout', onFocusChange);
    document.addEventListener('visibilitychange', onVisibility);
  }
}

function stopListening(): void {
  if (channel) {
    try {
      const p: Promise<unknown> = supabase.removeChannel(channel).catch(() => { /* gone anyway */ });
      leaving = p;
      void p.then(() => { if (leaving === p) leaving = null; });
    } catch { /* ignore */ }
  }
  channel = null;
  channelSecret = null;
  lastFieldSent = '';
  phones.clear();
}

/** At app start: listen for paired phones (nothing happens if none was ever allowed). */
export function startPhoneRemote(): void {
  if (isDemo()) return;
  const s = load();
  if (s?.paired) listen(s.secret);
}

// ── the code on screen ─────────────────────────────────────────────────────

export interface PairingCode { code: string; url: string; expiresAt: number }

/** "BCDFGHJK" → "BCDF-GHJK", the way the phone page shows it too. */
export const formatPairingCode = (code: string): string => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

const CODE_TTL_MS = 10 * 60_000;
/** A code with less than this left isn't shown again; a new one is fetched. */
const REUSE_MIN_LEFT_MS = 60_000;
/** How long the box keeps its code (and channel) after the last QR goes. */
const RELEASE_AFTER_MS = 60_000;

/** Bumped by "Unpair all": a pair answer from before it is dropped. */
let epoch = 0;
/** Bumped whenever the code on screen stops working; the QRs fetch a new one. */
let round = 0;
let inflight: Promise<PairingCode> | null = null;
/** The code the QRs show, reused while it has a minute left. */
let shown: { secret: string; code: PairingCode } | null = null;
/** QRs on screen now. */
let holders = 0;
let releaseTimer: number | null = null;

export const pairingRound = (): number => round;

function codeUsedUp(): void {
  shown = null;
  round++;
}

/** A QR came on screen. */
export function holdPairing(): void {
  holders++;
  if (releaseTimer != null) { window.clearTimeout(releaseTimer); releaseTimer = null; }
}

/**
 * A QR went away. A minute later, if none came back: the code stops working
 * and, unless a phone was allowed (or one is asking), the box stops listening.
 */
export function releasePairingListener(): void {
  holders = Math.max(0, holders - 1);
  scheduleRelease();
}

function scheduleRelease(): void {
  if (holders > 0 || releaseTimer != null) return;
  releaseTimer = window.setTimeout(() => {
    releaseTimer = null;
    if (holders > 0) return;
    const was = shown;
    shown = null;
    if (!load()?.paired && !pendingPhoneRequest()) stopListening();
    if (was) void invoke({ op: 'release', device_id: getDeviceId(), secret: was.secret }).catch(() => { /* it runs out anyway */ });
  }, RELEASE_AFTER_MS);
}

/** A code (and QR address) for pairing a phone; listens while a QR shows it. */
export function getPairingCode(): Promise<PairingCode> {
  const s = load();
  if (shown && s?.secret === shown.secret && shown.code.expiresAt - Date.now() > REUSE_MIN_LEFT_MS) {
    if (holders > 0) listen(shown.secret);
    return Promise.resolve(shown.code);
  }
  if (inflight) return inflight;
  const e = epoch;
  const p = (async (): Promise<PairingCode> => {
    const cur = load();
    const r = await invoke({ op: 'pair', device_id: getDeviceId(), secret: cur?.secret, label: 'Snow Media Center' });
    // "Unpair all" ran meanwhile: this answer belongs to the old pairing.
    if (e !== epoch) throw new Error('unpaired');
    const secret = typeof r?.secret === 'string' ? r.secret : '';
    const code = typeof r?.code === 'string' ? r.code : '';
    if (!r?.ok || !/^[0-9a-f]{64}$/.test(secret) || !code) throw new Error(String(r?.reason || 'pair_failed'));
    const now = load();
    store({ secret, paired: now?.secret === secret ? !!now.paired : false });
    // Timed on this box's own clock: the server's clock and the box's may
    // disagree by hours.
    const ttl = Number(r.expires_in) > 0 ? Number(r.expires_in) * 1000 : CODE_TTL_MS;
    const pc: PairingCode = { code, url: `${REMOTE_URL}?c=${code}`, expiresAt: Date.now() + ttl };
    shown = { secret, code: pc };
    // Nobody shows it any more (the QR came and went while this was on its
    // way): keep the code for a QR that comes back, but don't listen, and
    // let it go a minute from now like any other.
    if (holders > 0 || load()?.paired) listen(secret);
    if (holders === 0) scheduleRelease();
    emit();
    return pc;
  })();
  inflight = p;
  const done = () => { if (inflight === p) inflight = null; };
  p.then(done, done);
  return p;
}

/** "Unpair all phones": they stop working; a new code pairs again. */
export async function unpairAllPhones(): Promise<void> {
  epoch++;
  inflight = null;
  requests = [];
  // The QRs on screen fetch a new pairing (and code) straight away.
  codeUsedUp();
  const cur = load();
  if (channel) void channel.send({ type: 'broadcast', event: 'box', payload: { t: 'unpaired' } });
  stopListening();
  store(null);
  emit();
  if (cur) {
    try { await invoke({ op: 'reset', device_id: getDeviceId(), secret: cur.secret }); } catch { /* offline: the box forgot it anyway */ }
  }
}

/** Tests only. */
export const __phoneRemoteForTests = {
  onPhoneMessage, onServerMessage, setFieldValue, isTextField, echoesValue, sendFieldState,
  listen, stopListening,
  reset: () => {
    stopListening(); requests = []; answered.clear(); shown = null; inflight = null; holders = 0;
    if (releaseTimer != null) { window.clearTimeout(releaseTimer); releaseTimer = null; }
  },
};
