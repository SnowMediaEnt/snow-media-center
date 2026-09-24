// snowmediaent.com/remote — a phone as the Snow Media Center remote.
//
// Self-contained page for the website (Snow Media Launchpad): it talks to the
// Snow Media Center backend (not the website's own), using its public key.
//   1. The TV shows an 8-letter code and a QR (Settings → Phone Remote, or
//      the card next to any text box). The QR opens this page with ?c=CODE.
//   2. The phone-remote function takes the code (each works once) and asks
//      the TV, which shows "Allow this phone?". Once the TV's own remote says
//      Allow, the phone collects the TV's pairing and remembers it, so next
//      time it just connects.
//   3. Buttons, typing and voice go to the TV over the Realtime channel
//      "smc-remote:<secret>" (event "phone"); the TV answers on event "box"
//      (ready, the text box it has open, away, unpaired). Messages wait while
//      the channel (re)connects, and it reconnects on its own.
//
// Needs: react, @supabase/supabase-js, lucide-react, Tailwind. Route it at
// /remote (and /r). Keep this file as it is in the SMC repo
// (web/phone-remote/PhoneRemotePage.tsx) so both sides stay in step: the TV
// app and the phone-remote function of the same release expect this version.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { RealtimeClient, createClient, type RealtimeChannel } from '@supabase/supabase-js';
import {
  ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FastForward, Home, Keyboard, Loader2,
  Menu, Mic, Pause, Rewind, Smartphone, Tv, Unlink,
} from 'lucide-react';

// The Snow Media Center backend — its public (publishable) key, the same one
// the TV app ships with.
const SMC_URL = 'https://falmwzhvxoefvkfsiylp.supabase.co';
const SMC_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbG13emh2eG9lZnZrZnNpeWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE4MjIwNDMsImV4cCI6MjA2NzM5ODA0M30.I-YfvZxAuOvhehrdoZOgrANirZv0-ucGUKbW9gOfQak';

const STORE_KEY = 'smc-phone-remote';
const HELLO_EVERY_MS = 30_000;
/** No word from the TV this long after a hello: it isn't answering. */
const REPLY_WITHIN_MS = 8_000;
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 140;
/** Presses held while the channel reconnects are sent if still this fresh. */
const QUEUE_KEEP_MS = 15_000;
const CLAIM_EVERY_MS = 2_500;
const CLAIM_GIVE_UP_MS = 150_000;
/** Longest the mic listens before it stops by itself. */
const VOICE_MAX_MS = 10_000;
/** A pause this long after words means they're done (Safari may never say "final"). */
const VOICE_PAUSE_MS = 1_500;

// Codes: 8 letters from these consonants (the TV shows them as ABCD-EFGH).
const CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const cleanCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z]/g, '').split('').filter((ch) => CODE_ALPHABET.includes(ch)).join('').slice(0, 8);
const showCode = (c: string) => (c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c);

interface Pairing { secret: string; label: string; id: string }

// One client for the page's calls, separate from the website's own sign-in.
// The channel gets a Realtime connection of its own, made new on every
// reconnect: a socket a phone slept on can look alive for a minute, and a
// channel being left can't be joined again under the same name.
let smc: ReturnType<typeof createClient> | null = null;
const newRealtime = () => new RealtimeClient(`${SMC_URL.replace(/^http/, 'ws')}/realtime/v1`, { params: { apikey: SMC_ANON_KEY } });
const client = () => (smc ??= createClient(SMC_URL, SMC_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'smc-phone-remote-auth' } }));
const call = async (body: Record<string, unknown>) => {
  const { data, error } = await client().functions.invoke('phone-remote', { body });
  if (error) throw error;
  return (data ?? {}) as { ok?: boolean; reason?: string; [k: string]: unknown };
};

const loadPairing = (): Pairing | null => {
  try { const p = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return p && /^[0-9a-f]{64}$/.test(p.secret) ? p : null; } catch { return null; }
};
const savePairing = (p: Pairing | null) => {
  try { if (p) localStorage.setItem(STORE_KEY, JSON.stringify(p)); else localStorage.removeItem(STORE_KEY); } catch { /* private mode */ }
};
const codeFromUrl = () => { try { return cleanCode(new URLSearchParams(window.location.search).get('c') || ''); } catch { return ''; } };
const clearUrl = () => { try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ } };
const buzz = () => { try { navigator.vibrate?.(12); } catch { /* not supported */ } };
const newId = () => {
  try { const a = new Uint8Array(8); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); } catch { return Math.random().toString(36).slice(2, 12); }
};

type SpeechResults = ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
type Speech = {
  start: () => void; stop: () => void; abort?: () => void;
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: { results: SpeechResults }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};
const speechCtor = (): (new () => Speech) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Speech; webkitSpeechRecognition?: new () => Speech };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

// ── pairing ────────────────────────────────────────────────────────────────

function PairScreen({ onPaired, message, saved, onKeepSaved }: {
  onPaired: (p: Pairing) => void;
  message?: string | null;
  /** A TV this phone is already the remote for. */
  saved: Pairing | null;
  onKeepSaved: () => void;
}) {
  const [code, setCode] = useState(codeFromUrl);
  // Opened from a QR while already paired: switching TVs takes a tap, so a
  // link someone sends can't quietly take this phone's remote elsewhere.
  const [askSwitch, setAskSwitch] = useState(() => !!saved && codeFromUrl().length === 8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(message ?? null);
  const [waiting, setWaiting] = useState<{ token: string; label: string } | null>(null);
  const tried = useRef(false);

  const join = useCallback(async (c: string) => {
    if (c.length !== 8 || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await call({ op: 'join', code: c });
      if (!r.ok || typeof r.token !== 'string') {
        setError(r.reason === 'too_many' ? 'Too many tries from this network. Wait ten minutes and try again.'
          : r.reason === 'busy' ? 'A lot of phones are pairing right now. Try again in a minute.'
            : r.reason === 'wrong_code' ? "That code didn't work. Check the code on the TV — each code works once."
              : r.reason === 'bad_code' ? 'The code is 8 letters, like BCDF-GHJK.'
                : "Couldn't connect. Check your internet and try again.");
        return;
      }
      clearUrl();
      setWaiting({ token: r.token, label: typeof r.label === 'string' && r.label ? r.label : 'Snow Media Center' });
    } catch {
      setError("Couldn't connect. Check your internet and try again.");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  // Opened from the TV's QR: connect straight away.
  useEffect(() => {
    if (!askSwitch && !tried.current && code.length === 8) { tried.current = true; void join(code); }
  }, [askSwitch, code, join]);

  if (waiting) {
    return (
      <WaitScreen
        token={waiting.token}
        label={waiting.label}
        onPaired={onPaired}
        onStop={(msg) => { setWaiting(null); setCode(''); setError(msg); }}
      />
    );
  }

  if (askSwitch && saved) {
    return (
      <div className="min-h-screen bg-[#071b3a] text-white flex flex-col items-center justify-center px-6">
        <Tv className="w-14 h-14 text-[#d4af6a] mb-4" />
        <h1 className="text-2xl font-bold text-center mb-2">Pair with a different TV?</h1>
        <p className="text-white/70 text-center mb-8 max-w-sm">
          This phone is already the remote for “{saved.label}”. Pairing with the TV showing code {showCode(code)} replaces it.
        </p>
        <button type="button" onClick={() => setAskSwitch(false)} className="w-72 rounded-2xl bg-[#d4af6a] text-black font-bold text-lg py-4">
          Pair with the new TV
        </button>
        <button type="button" onClick={() => { clearUrl(); onKeepSaved(); }} className="mt-3 w-72 rounded-2xl bg-white/10 font-semibold py-4">
          Keep using “{saved.label}”
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#071b3a] text-white flex flex-col items-center justify-center px-6">
      <Tv className="w-14 h-14 text-[#d4af6a] mb-4" />
      <h1 className="text-3xl font-bold text-center mb-2">Snow Media Remote</h1>
      <p className="text-white/70 text-center mb-8 max-w-sm">
        On your TV, open Snow Media Center → Settings → Phone Remote, then scan the QR code or type the 8-letter code here.
      </p>
      <input
        value={showCode(code)}
        onChange={(e) => setCode(cleanCode(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter') void join(code); }}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        aria-label="Code shown on the TV"
        placeholder="BCDF-GHJK"
        className="w-72 text-center text-3xl tracking-[0.15em] font-bold rounded-2xl bg-white/10 border border-white/20 py-4 outline-none focus:border-[#d4af6a] uppercase"
      />
      <button
        type="button"
        onClick={() => void join(code)}
        disabled={code.length !== 8 || busy}
        className="mt-6 w-72 rounded-2xl bg-[#d4af6a] text-black font-bold text-lg py-4 disabled:opacity-40 flex items-center justify-center"
      >
        {busy ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Smartphone className="w-5 h-5 mr-2" />}
        Connect
      </button>
      {saved && (
        <button type="button" onClick={onKeepSaved} className="mt-4 text-white/60 text-sm underline">
          Back to “{saved.label}”
        </button>
      )}
      {error && <p className="mt-4 text-amber-300 text-center max-w-sm">{error}</p>}
    </div>
  );
}

/** The code was right; the TV now asks "Allow this phone?". */
function WaitScreen({ token, label, onPaired, onStop }: {
  token: string; label: string;
  onPaired: (p: Pairing) => void;
  onStop: (message: string | null) => void;
}) {
  const onPairedRef = useRef(onPaired); onPairedRef.current = onPaired;
  const onStopRef = useRef(onStop); onStopRef.current = onStop;
  const labelRef = useRef(label); labelRef.current = label;
  useEffect(() => {
    const onPaired = (p: Pairing) => onPairedRef.current(p);
    const onStop = (msg: string | null) => onStopRef.current(msg);
    let alive = true;
    let timer = 0;
    const started = Date.now();
    const poll = async () => {
      if (!alive) return;
      try {
        const r = await call({ op: 'claim', token });
        if (!alive) return;
        if (r.ok && typeof r.secret === 'string' && /^[0-9a-f]{64}$/.test(r.secret)) {
          const p: Pairing = { secret: r.secret, label: typeof r.label === 'string' && r.label ? r.label : labelRef.current, id: newId() };
          savePairing(p);
          buzz();
          onPaired(p);
          return;
        }
        if (!r.ok && r.reason === 'denied') { onStop("The TV didn't allow this phone."); return; }
        if (!r.ok && r.reason === 'expired') { onStop("The TV didn't answer in time. Enter the new code on the TV to try again."); return; }
      } catch { /* a network blip: keep asking */ }
      if (Date.now() - started > CLAIM_GIVE_UP_MS) { onStop("The TV didn't answer in time. Enter the new code on the TV to try again."); return; }
      timer = window.setTimeout(() => void poll(), CLAIM_EVERY_MS);
    };
    void poll();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [token]);

  return (
    <div className="min-h-screen bg-[#071b3a] text-white flex flex-col items-center justify-center px-6">
      <Tv className="w-14 h-14 text-[#d4af6a] mb-4" />
      <h1 className="text-2xl font-bold text-center mb-2">Almost there</h1>
      <p className="text-white/80 text-center mb-2 max-w-sm">
        “{label}” is asking whether to allow this phone. Choose <span className="font-semibold text-white">Allow</span> with the TV's remote (press OK).
      </p>
      <Loader2 className="w-8 h-8 animate-spin text-white/70 my-6" />
      <button type="button" onClick={() => onStop(null)} className="text-white/60 text-sm underline">Cancel</button>
    </div>
  );
}

// ── the remote ─────────────────────────────────────────────────────────────

function Pad({ onKey }: { onKey: (k: string) => void }) {
  const timer = useRef<number | null>(null);
  const stop = () => { if (timer.current) { window.clearTimeout(timer.current); window.clearInterval(timer.current); timer.current = null; } };
  const press = (k: string) => (e: ReactPointerEvent) => {
    e.preventDefault();
    stop();
    onKey(k);
    // Arrows repeat while held, like a real remote.
    if (k !== 'ok') {
      timer.current = window.setTimeout(() => { timer.current = window.setInterval(() => onKey(k), REPEAT_EVERY_MS); }, REPEAT_DELAY_MS);
    }
  };
  useEffect(() => stop, []);
  const btn = 'absolute flex items-center justify-center text-white active:bg-white/20 rounded-full select-none touch-none';
  return (
    <div className="relative w-72 h-72 rounded-full bg-white/10 border border-white/15 mx-auto" onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}>
      <button type="button" aria-label="Up" className={`${btn} left-1/2 -translate-x-1/2 top-2 w-24 h-20`} onPointerDown={press('up')}><ChevronUp className="w-10 h-10" /></button>
      <button type="button" aria-label="Down" className={`${btn} left-1/2 -translate-x-1/2 bottom-2 w-24 h-20`} onPointerDown={press('down')}><ChevronDown className="w-10 h-10" /></button>
      <button type="button" aria-label="Left" className={`${btn} top-1/2 -translate-y-1/2 left-2 w-20 h-24`} onPointerDown={press('left')}><ChevronLeft className="w-10 h-10" /></button>
      <button type="button" aria-label="Right" className={`${btn} top-1/2 -translate-y-1/2 right-2 w-20 h-24`} onPointerDown={press('right')}><ChevronRight className="w-10 h-10" /></button>
      <button type="button" aria-label="OK" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 rounded-full bg-[#d4af6a] text-black text-2xl font-bold active:scale-95 select-none touch-none" onPointerDown={press('ok')}>OK</button>
    </div>
  );
}

type Field = { typing: boolean; value: string; password: boolean; label: string };
const NO_FIELD: Field = { typing: false, value: '', password: false, label: '' };

function RemoteScreen({ pairing, onUnpaired }: { pairing: Pairing; onUnpaired: (msg?: string) => void }) {
  /** connecting: channel not up yet · live: the TV answers · quiet: it doesn't · away: SMC isn't on the TV screen */
  const [status, setStatus] = useState<'connecting' | 'live' | 'quiet' | 'away'>('connecting');
  const [field, setField] = useState<Field>(NO_FIELD);
  const fieldRef = useRef<Field>(NO_FIELD);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const realtimeRef = useRef<RealtimeClient | null>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<Array<{ payload: Record<string, unknown>; at: number }>>([]);
  const heardAtRef = useRef(0);
  const connectRef = useRef<() => void>(() => {});
  const textTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<{ stop: (send: boolean) => void } | null>(null);
  const Speech = useMemo(speechCtor, []);
  const onUnpairedRef = useRef(onUnpaired); onUnpairedRef.current = onUnpaired;

  const send = useCallback((payload: Record<string, unknown>) => {
    const msg = { ...payload, id: pairing.id };
    const ch = channelRef.current;
    if (ch && readyRef.current) { void ch.send({ type: 'broadcast', event: 'phone', payload: msg }); return; }
    // Not connected (yet, or again): hold it until the channel is up, and
    // don't let a reconnect sit out its back-off while someone is pressing.
    queueRef.current.push({ payload: msg, at: Date.now() });
    if (queueRef.current.length > 30) queueRef.current.shift();
    connectRef.current();
  }, [pairing.id]);

  useEffect(() => {
    let alive = true;
    let retry = 0;
    let retryTimer = 0;
    let replyTimer = 0;
    let lastCheck = 0;
    let attemptAt = 0;
    const secret = pairing.secret;

    // Is this pairing still there? (The TV may have unpaired while this page
    // was closed, and then nothing on the channel will ever answer.)
    const check = async (force = false) => {
      if (!force && Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      try {
        const r = await call({ op: 'check', secret });
        if (alive && r.ok && r.exists === false) {
          savePairing(null);
          onUnpairedRef.current('This TV unpaired its phones. Pair again with the new code on the TV.');
        }
      } catch { /* offline: try again later */ }
    };

    const hello = () => {
      const ch = channelRef.current;
      if (!ch || !readyRef.current) return;
      const sentAt = Date.now();
      void ch.send({ type: 'broadcast', event: 'phone', payload: { t: 'hello', id: pairing.id } });
      window.clearTimeout(replyTimer);
      replyTimer = window.setTimeout(() => {
        if (!alive || heardAtRef.current >= sentAt) return;
        setStatus('quiet');
        void check();
      }, REPLY_WITHIN_MS);
    };

    const onBox = (m: { t?: string; typing?: boolean; value?: string; password?: boolean; label?: string; why?: string }) => {
      heardAtRef.current = Date.now();
      if (m.t === 'away') { setStatus('away'); return; }
      setStatus('live');
      if (m.t === 'field') {
        const prev = fieldRef.current;
        const f: Field = { typing: !!m.typing, value: String(m.value ?? '').slice(0, 500), password: !!m.password, label: String(m.label ?? '').slice(0, 80) };
        const changed = prev.typing !== f.typing || prev.label !== f.label || prev.password !== f.password;
        fieldRef.current = f;
        setField(f);
        // A reply to our hello about the same text box: what the phone has
        // typed stays (the TV's copy may be a keystroke behind).
        if (m.why === 'hello' && !changed) return;
        if (f.typing) setText(f.value);
      }
      if (m.t === 'unpaired') {
        // Only the pairing's own record decides (anyone on the channel could
        // say this); give the TV a moment to finish unpairing first.
        window.setTimeout(() => void check(true), 1500);
        window.setTimeout(() => void check(true), 6000);
      }
    };

    const flush = () => {
      const ch = channelRef.current;
      if (!ch) return;
      const now = Date.now();
      const q = queueRef.current.filter((m) => now - m.at < QUEUE_KEEP_MS);
      queueRef.current = [];
      for (const m of q) void ch.send({ type: 'broadcast', event: 'phone', payload: m.payload });
    };

    const close = (rt: RealtimeClient | null) => { if (rt) { try { void rt.removeAllChannels(); rt.disconnect(); } catch { /* already gone */ } } };
    const drop = () => {
      const rt = realtimeRef.current;
      realtimeRef.current = null;
      channelRef.current = null;
      readyRef.current = false;
      close(rt);
    };

    const connect = () => {
      if (!alive) return;
      attemptAt = Date.now();
      window.clearTimeout(retryTimer);
      drop();
      const rt = newRealtime();
      realtimeRef.current = rt;
      const ch = rt.channel(`smc-remote:${secret}`, { config: { broadcast: { self: false } } });
      channelRef.current = ch;
      ch.on('broadcast', { event: 'box' }, ({ payload }) => { if (alive && channelRef.current === ch) onBox(payload as Parameters<typeof onBox>[0]); });
      ch.subscribe((s) => {
        if (!alive || channelRef.current !== ch) return;
        if (s === 'SUBSCRIBED') {
          // (Also after the library rejoined by itself: no need to start over.)
          window.clearTimeout(retryTimer);
          readyRef.current = true;
          retry = 0;
          hello();
          flush();
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
          // Dropped (a phone asleep, a network change): start over, sooner
          // at first, then every ten seconds.
          readyRef.current = false;
          setStatus((st) => (st === 'live' ? 'connecting' : st));
          window.clearTimeout(retryTimer);
          retryTimer = window.setTimeout(connect, Math.min(10_000, 1000 * 2 ** retry++));
        }
      });
    };
    // A press while down: try now, unless a try has just started.
    connectRef.current = () => { if (!readyRef.current && Date.now() - attemptAt > 3000) { retry = 0; connect(); } };
    connect();
    void check(true);

    const helloTimer = window.setInterval(hello, HELLO_EVERY_MS);
    // Back from the lock screen or another app: the socket may be dead
    // without knowing it yet, so start fresh unless the TV answers at once.
    const onShow = () => {
      if (document.visibilityState !== 'visible') return;
      if (!readyRef.current) { retry = 0; connect(); return; }
      const before = heardAtRef.current;
      hello();
      window.setTimeout(() => { if (alive && heardAtRef.current === before) { retry = 0; connect(); } }, 4000);
    };
    const bye = () => {
      const ch = channelRef.current;
      if (ch && readyRef.current) void ch.send({ type: 'broadcast', event: 'phone', payload: { t: 'bye', id: pairing.id } });
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('pageshow', onShow);
    window.addEventListener('online', onShow);
    window.addEventListener('pagehide', bye);
    return () => {
      alive = false;
      window.clearInterval(helloTimer);
      window.clearTimeout(retryTimer);
      window.clearTimeout(replyTimer);
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('online', onShow);
      window.removeEventListener('pagehide', bye);
      bye();
      queueRef.current = [];
      connectRef.current = () => {};
      const rt = realtimeRef.current;
      realtimeRef.current = null;
      channelRef.current = null;
      readyRef.current = false;
      // After the bye has gone out.
      window.setTimeout(() => close(rt), 300);
    };
  }, [pairing.secret, pairing.id]);

  const key = useCallback((k: string) => { buzz(); send({ t: 'key', k }); }, [send]);

  const onType = (v: string) => {
    setText(v);
    if (textTimer.current) window.clearTimeout(textTimer.current);
    textTimer.current = window.setTimeout(() => send({ t: 'text', v }), 120);
  };

  const openKeyboard = () => {
    setKeyboardOpen(true);
    // Focus inside the tap itself, so the phone's keyboard comes up (iOS
    // only opens it from a tap), and once more after the panel renders.
    try { inputRef.current?.focus(); } catch { /* not there yet */ }
    window.setTimeout(() => inputRef.current?.focus(), 50);
  };

  // Voice. A tap listens; a tap while listening stops (and sends what was
  // heard). Whatever the browser does, it never stays on "Listening…": a
  // pause after words, an error, or ten seconds end it.
  const talk = () => {
    if (!Speech) return;
    if (recRef.current) { recRef.current.stop(true); return; }
    let r: Speech;
    try { r = new Speech(); } catch { setVoiceNote("Voice isn't available in this browser."); return; }
    let heard = '';
    let done = false;
    let pauseTimer = 0;
    let maxTimer = 0;
    const handle = { stop: (sendIt: boolean) => finish(sendIt, null) };
    /** `note`: what to say when nothing is sent (undefined: "didn't catch that"). */
    const finish = (sendIt: boolean, note?: string | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(pauseTimer);
      window.clearTimeout(maxTimer);
      if (recRef.current === handle) recRef.current = null;
      r.onresult = null; r.onend = null; r.onerror = null;
      try { if (r.abort) r.abort(); else r.stop(); } catch { /* already stopped */ }
      setListening(false);
      const said = heard.trim();
      if (sendIt && said) {
        setVoiceNote(null);
        // With a text box open on the TV, words go into it; otherwise they are a command.
        if (fieldRef.current.typing) { setKeyboardOpen(true); onType(said); } else send({ t: 'voice', v: said });
      } else {
        setVoiceNote(note === undefined ? "Didn't catch that. Tap the mic and try again." : note);
      }
    };
    maxTimer = window.setTimeout(() => finish(true), VOICE_MAX_MS);
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      let said = '';
      let final = false;
      for (let i = 0; i < e.results.length; i++) {
        said += e.results[i]?.[0]?.transcript ?? '';
        if (e.results[i]?.isFinal) final = true;
      }
      heard = said;
      window.clearTimeout(pauseTimer);
      if (final) { finish(true); return; }
      pauseTimer = window.setTimeout(() => finish(true), VOICE_PAUSE_MS);
    };
    r.onerror = (e) => {
      const why = e?.error;
      if (why === 'not-allowed' || why === 'service-not-allowed') finish(false, 'The microphone is blocked. Allow it for this site in your browser settings, then try again.');
      else if (why === 'audio-capture') finish(false, 'No microphone was found on this phone.');
      else if (why === 'network') finish(true, 'Voice needs an internet connection. Try again.');
      else if (why === 'aborted') finish(true, null);
      else if (why === 'no-speech') finish(true);
      else finish(true, 'Voice stopped. Tap the mic to try again.');
    };
    r.onend = () => finish(true);
    recRef.current = handle;
    setListening(true);
    setVoiceNote(null);
    buzz();
    try { r.start(); } catch { finish(false, "Couldn't start the microphone. Try again."); }
  };
  // Leaving the page (or this TV) stops the mic.
  useEffect(() => () => { recRef.current?.stop(false); }, []);

  const small = 'flex flex-col items-center justify-center rounded-2xl bg-white/10 active:bg-white/20 py-3 text-xs text-white/80 select-none';
  const typingOnTv = field.typing && !keyboardOpen;
  return (
    <div className="min-h-screen bg-[#071b3a] text-white px-5 pt-5 pb-8 flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full mr-2 ${status === 'live' ? 'bg-emerald-400' : status === 'quiet' || status === 'away' ? 'bg-amber-400' : 'bg-white/40 animate-pulse'}`} />
          <span className="truncate font-semibold">{pairing.label}</span>
        </div>
        <button type="button" onClick={() => { savePairing(null); onUnpaired(); }} className="text-white/60 text-sm flex items-center"><Unlink className="w-4 h-4 mr-1" /> Forget</button>
      </div>
      {status === 'quiet' && (
        <p className="mb-4 rounded-xl bg-amber-500/15 border border-amber-400/40 px-3 py-2 text-sm text-amber-200">
          The TV isn't answering. Make sure Snow Media Center is open on it — the remote works while the app is on screen.
        </p>
      )}
      {status === 'away' && (
        <p className="mb-4 rounded-xl bg-amber-500/15 border border-amber-400/40 px-3 py-2 text-sm text-amber-200">
          Another app is on the TV screen. Use the TV's own remote to get back to Snow Media Center — this remote works while it's on screen.
        </p>
      )}

      <div className="grid grid-cols-3 gap-3 mb-6">
        <button type="button" className={small} onClick={() => key('back')}><ArrowLeft className="w-6 h-6 mb-1" />Back</button>
        <button type="button" className={small} onClick={() => { buzz(); send({ t: 'home' }); }}><Home className="w-6 h-6 mb-1" />Home</button>
        <button type="button" className={small} onClick={() => key('menu')}><Menu className="w-6 h-6 mb-1" />Options</button>
      </div>

      {typingOnTv && (
        <button type="button" onClick={openKeyboard} className="mb-4 rounded-xl bg-[#d4af6a]/20 border border-[#d4af6a]/60 px-3 py-2 text-sm text-left">
          <span className="font-semibold">A text box is open on the TV</span>
          {field.label ? <span className="text-white/70"> (“{field.label}”)</span> : null}. Tap to type it here.
        </button>
      )}

      <Pad onKey={key} />

      <div className="grid grid-cols-3 gap-3 mt-6">
        <button type="button" className={small} onClick={() => key('rw')}><Rewind className="w-6 h-6 mb-1" />Rewind</button>
        <button type="button" className={small} onClick={() => key('playpause')}><Pause className="w-6 h-6 mb-1" />Play/Pause</button>
        <button type="button" className={small} onClick={() => key('ff')}><FastForward className="w-6 h-6 mb-1" />Forward</button>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <button type="button" className={`${small} ${typingOnTv ? 'ring-2 ring-[#d4af6a]' : ''}`} onClick={() => { if (keyboardOpen) setKeyboardOpen(false); else openKeyboard(); }}>
          <Keyboard className="w-6 h-6 mb-1" />Keyboard
        </button>
        <button type="button" className={`${small} ${listening ? 'bg-red-500/40' : ''}`} onClick={talk} disabled={!Speech}>
          <Mic className="w-6 h-6 mb-1" />{Speech ? (listening ? 'Listening… tap to stop' : 'Voice') : 'Voice (not on this phone)'}
        </button>
      </div>
      {voiceNote && <p className="mt-2 text-center text-sm text-amber-200">{voiceNote}</p>}

      {keyboardOpen && (
        <div className="mt-4 rounded-2xl bg-white/10 p-3">
          <div className="text-xs text-white/60 mb-2">
            {field.typing
              ? <>TV text box{field.label ? <>: “{field.label}”</> : null}{field.password ? ' (a password: what you type goes to the TV)' : ''}</>
              : 'Pick a text box on the TV (a search or sign-in box), then type here.'}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (textTimer.current) window.clearTimeout(textTimer.current); send({ t: 'text', v: text }); window.setTimeout(() => send({ t: 'submit' }), 150); buzz(); }} className="flex">
            <input
              ref={inputRef}
              type={field.password ? 'password' : 'text'}
              value={text}
              onChange={(e) => onType(e.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="go"
              className="flex-1 rounded-xl bg-black/30 border border-white/20 px-3 py-3 text-lg outline-none focus:border-[#d4af6a]"
              placeholder="Type here"
            />
            <button type="submit" className="ml-2 rounded-xl bg-[#d4af6a] text-black font-bold px-4">Go</button>
          </form>
        </div>
      )}
    </div>
  );
}

export default function PhoneRemotePage() {
  const [pairing, setPairing] = useState<Pairing | null>(() => {
    // A code in the address means a (maybe different) TV: the pairing screen
    // decides (it asks first when this phone already has a TV).
    if (codeFromUrl().length === 8) return null;
    return loadPairing();
  });
  const [message, setMessage] = useState<string | null>(null);
  const onUnpaired = useCallback((msg?: string) => { setPairing(null); setMessage(msg ?? null); }, []);
  const onPaired = useCallback((p: Pairing) => { setMessage(null); setPairing(p); }, []);
  const onKeepSaved = useCallback(() => { setMessage(null); setPairing(loadPairing()); }, []);
  useEffect(() => { document.title = 'Snow Media Remote'; }, []);
  return pairing
    ? <RemoteScreen key={pairing.secret} pairing={pairing} onUnpaired={onUnpaired} />
    : <PairScreen onPaired={onPaired} message={message} saved={loadPairing()} onKeepSaved={onKeepSaved} />;
}
