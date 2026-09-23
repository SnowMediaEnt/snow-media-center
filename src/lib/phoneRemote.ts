// Phone remote, the box's side. A phone opens snowmediaent.com/remote, enters
// the code this box shows (or scans its QR) and becomes a remote: the D-pad,
// OK, Back, Home, play/pause, typing into the box's text boxes, and voice.
//
// Pairing goes through the phone-remote edge function; after that the phone
// and the box talk over the Realtime broadcast channel "smc-remote:<secret>".
// The box keeps a live connection only once a phone has actually connected
// (it keeps its secret, so a phone stays paired across restarts until
// "Unpair all phones"); while a QR is on screen it listens for the phone, and
// if none came, it lets go when the QR goes away.
//
// Keys are pressed natively (AppManager.injectKey) so they behave exactly
// like the box's own remote; off-device they fall back to synthetic keydowns.
// Text goes straight into the focused text box. While a text box has focus,
// the phone is told, so it can show its keyboard with what is typed so far.
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

interface Stored { secret: string; /** A phone has connected at least once. */ paired?: boolean }
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

// ── what the phone asks for ────────────────────────────────────────────────

const isTextField = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement => {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (!(el instanceof HTMLInputElement)) return false;
  const t = (el.type || 'text').toLowerCase();
  return !el.readOnly && !el.disabled && ['text', 'search', 'email', 'password', 'url', 'tel', 'number'].includes(t);
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

export async function pressRemoteKey(name: string): Promise<void> {
  const k = REMOTE_KEYS[name];
  if (!k) return;
  try {
    await AppManager.injectKey({ keyCode: k.code });
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
  if (m.id) {
    const s = load();
    if (s && !s.paired) store({ ...s, paired: true });
    const isNew = !phones.has(m.id);
    phones.set(m.id, Date.now());
    if (isNew) { emit(); try { trackEvent('phone_remote_connected', 'remote'); } catch { void 0; } }
  }
  switch (m.t) {
    case 'hello':
      sendFieldState();
      break;
    case 'bye':
      if (m.id) { phones.delete(m.id); emit(); }
      break;
    case 'key':
      void pressRemoteKey(m.k);
      break;
    case 'text': {
      const el = document.activeElement;
      if (isTextField(el)) setFieldValue(el, String(m.v ?? '').slice(0, 500));
      break;
    }
    case 'submit':
      void pressRemoteKey('enter');
      break;
    case 'home':
      try { window.dispatchEvent(new CustomEvent(REMOTE_HOME_EVENT)); } catch { /* ignore */ }
      break;
    case 'voice':
      if (m.v) try { window.dispatchEvent(new CustomEvent(REMOTE_VOICE_EVENT, { detail: String(m.v).slice(0, 300) })); } catch { /* ignore */ }
      break;
  }
}

/** Tell the phones whether a text box has focus on the TV (and what's in it). */
function sendFieldState(): void {
  if (!channel) return;
  const el = document.activeElement;
  const typing = isTextField(el);
  const secret = typing && (el as HTMLInputElement).type === 'password';
  void channel.send({
    type: 'broadcast',
    event: 'box',
    payload: {
      t: 'field',
      typing,
      value: typing && !secret ? (el as HTMLInputElement).value.slice(0, 500) : '',
      password: secret,
      label: typing ? ((el as HTMLInputElement).placeholder || el?.getAttribute('aria-label') || '').slice(0, 80) : '',
    },
  });
}

let focusListening = false;
const onFocusChange = () => { window.setTimeout(sendFieldState, 0); };

function listen(secret: string): void {
  if (channel && channelSecret === secret) return;
  stopListening();
  channelSecret = secret;
  channel = supabase.channel(`smc-remote:${secret}`, { config: { broadcast: { self: false } } });
  channel.on('broadcast', { event: 'phone' }, ({ payload }) => onPhoneMessage(payload as PhoneMessage));
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') void channel?.send({ type: 'broadcast', event: 'box', payload: { t: 'ready' } });
  });
  if (!focusListening) {
    focusListening = true;
    document.addEventListener('focusin', onFocusChange);
    document.addEventListener('focusout', onFocusChange);
  }
}

function stopListening(): void {
  if (channel) { try { void supabase.removeChannel(channel); } catch { /* ignore */ } }
  channel = null;
  channelSecret = null;
  phones.clear();
}

/** At app start: listen for paired phones (nothing happens if none ever paired). */
export function startPhoneRemote(): void {
  if (isDemo()) return;
  const s = load();
  if (s?.paired) listen(s.secret);
}

/** A QR went away: if no phone ever came, stop listening. */
export function releasePairingListener(): void {
  if (!load()?.paired) stopListening();
}

export interface PairingCode { code: string; url: string; expiresAt: number }

/** A code (and QR address) for pairing a phone; starts listening. */
export async function getPairingCode(): Promise<PairingCode> {
  const cur = load();
  const { data, error } = await supabase.functions.invoke('phone-remote', {
    body: { op: 'pair', device_id: getDeviceId(), secret: cur?.secret, label: 'Snow Media Center' },
  });
  if (error) throw error;
  const r = data as { ok?: boolean; secret?: string; code?: string; expires_at?: string; reason?: string } | null;
  if (!r?.ok || !r.secret || !r.code) throw new Error(r?.reason || 'pair_failed');
  store({ secret: r.secret, paired: cur?.secret === r.secret ? cur.paired : false });
  listen(r.secret);
  emit();
  return { code: r.code, url: `${REMOTE_URL}?c=${r.code}`, expiresAt: Date.parse(r.expires_at ?? '') || Date.now() + 10 * 60_000 };
}

/** "Unpair all phones": they stop working; a new code pairs again. */
export async function unpairAllPhones(): Promise<void> {
  const cur = load();
  if (channel) void channel.send({ type: 'broadcast', event: 'box', payload: { t: 'unpaired' } });
  stopListening();
  store(null);
  emit();
  if (cur) {
    try { await supabase.functions.invoke('phone-remote', { body: { op: 'reset', device_id: getDeviceId(), secret: cur.secret } }); } catch { /* offline: the box forgot it anyway */ }
  }
}

/** Tests only. */
export const __phoneRemoteForTests = { onPhoneMessage, setFieldValue, isTextField };
