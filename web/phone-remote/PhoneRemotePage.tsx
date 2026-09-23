// snowmediaent.com/remote — a phone as the Snow Media Center remote.
//
// Self-contained page for the website (Snow Media Launchpad): it talks to the
// Snow Media Center backend (not the website's own), using its public key.
//   1. The TV shows a 6-digit code and a QR (Settings → Phone Remote, or the
//      card next to any text box). The QR opens this page with ?c=CODE.
//   2. The phone-remote function trades the code for the TV's pairing; the
//      phone remembers it, so next time it just connects.
//   3. Buttons, typing and voice go to the TV over the Realtime channel
//      "smc-remote:<secret>" (event "phone"); the TV answers on event "box"
//      (ready, the text box it has open, unpaired).
//
// Needs: react, @supabase/supabase-js, lucide-react, Tailwind. Route it at
// /remote (and /r). Keep this file as it is in the SMC repo
// (web/phone-remote/PhoneRemotePage.tsx) so both sides stay in step.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
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
const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 140;

interface Pairing { secret: string; label: string; id: string }

// One client for the page, separate from the website's own sign-in.
let smc: ReturnType<typeof createClient> | null = null;
const client = () => (smc ??= createClient(SMC_URL, SMC_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: 'smc-phone-remote-auth' } }));

const loadPairing = (): Pairing | null => {
  try { const p = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); return p && /^[0-9a-f]{64}$/.test(p.secret) ? p : null; } catch { return null; }
};
const savePairing = (p: Pairing | null) => {
  try { if (p) localStorage.setItem(STORE_KEY, JSON.stringify(p)); else localStorage.removeItem(STORE_KEY); } catch { /* private mode */ }
};
const buzz = () => { try { navigator.vibrate?.(12); } catch { /* not supported */ } };

type Speech = { start: () => void; stop: () => void; lang: string; interimResults: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
const speechCtor = (): (new () => Speech) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Speech; webkitSpeechRecognition?: new () => Speech };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

// ── pairing screen ─────────────────────────────────────────────────────────

function PairScreen({ onPaired, message }: { onPaired: (p: Pairing) => void; message?: string | null }) {
  const [code, setCode] = useState(() => {
    try { return (new URLSearchParams(window.location.search).get('c') || '').replace(/\D/g, '').slice(0, 6); } catch { return ''; }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(message ?? null);
  const tried = useRef(false);

  const join = useCallback(async (c: string) => {
    if (c.length !== 6 || busy) return;
    setBusy(true); setError(null);
    try {
      const { data, error: err } = await client().functions.invoke('phone-remote', { body: { op: 'join', code: c } });
      const r = data as { ok?: boolean; secret?: string; label?: string; reason?: string } | null;
      if (err || !r?.ok || !r.secret) {
        setError(r?.reason === 'too_many' ? 'Too many tries. Wait a few minutes and try again.'
          : r?.reason === 'wrong_code' ? "That code didn't work. Check the code on the TV — it changes every few minutes."
            : "Couldn't connect. Check your internet and try again.");
        return;
      }
      const p: Pairing = { secret: r.secret, label: r.label || 'Snow Media Center', id: Math.random().toString(36).slice(2, 10) };
      savePairing(p);
      try { window.history.replaceState(null, '', window.location.pathname); } catch { /* ignore */ }
      onPaired(p);
    } finally {
      setBusy(false);
    }
  }, [busy, onPaired]);

  // Opened from the TV's QR: connect straight away.
  useEffect(() => {
    if (!tried.current && code.length === 6) { tried.current = true; void join(code); }
  }, [code, join]);

  return (
    <div className="min-h-screen bg-[#071b3a] text-white flex flex-col items-center justify-center px-6">
      <Tv className="w-14 h-14 text-[#d4af6a] mb-4" />
      <h1 className="text-3xl font-bold text-center mb-2">Snow Media Remote</h1>
      <p className="text-white/70 text-center mb-8 max-w-sm">
        On your TV, open Snow Media Center → Settings → Phone Remote, then scan the QR code or type the 6-digit code here.
      </p>
      <input
        inputMode="numeric"
        autoComplete="one-time-code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        placeholder="123456"
        className="w-64 text-center text-4xl tracking-[0.3em] font-bold rounded-2xl bg-white/10 border border-white/20 py-4 outline-none focus:border-[#d4af6a]"
      />
      <button
        type="button"
        onClick={() => void join(code)}
        disabled={code.length !== 6 || busy}
        className="mt-6 w-64 rounded-2xl bg-[#d4af6a] text-black font-bold text-lg py-4 disabled:opacity-40 flex items-center justify-center"
      >
        {busy ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Smartphone className="w-5 h-5 mr-2" />}
        Connect
      </button>
      {error && <p className="mt-4 text-amber-300 text-center max-w-sm">{error}</p>}
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

function RemoteScreen({ pairing, onUnpaired }: { pairing: Pairing; onUnpaired: (msg?: string) => void }) {
  const [status, setStatus] = useState<'connecting' | 'live' | 'quiet'>('connecting');
  const [field, setField] = useState<{ typing: boolean; value: string; password: boolean; label: string }>({ typing: false, value: '', password: false, label: '' });
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const textTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const Speech = useMemo(speechCtor, []);

  const send = useCallback((payload: Record<string, unknown>) => {
    void channelRef.current?.send({ type: 'broadcast', event: 'phone', payload: { ...payload, id: pairing.id } });
  }, [pairing.id]);

  useEffect(() => {
    const ch = client().channel(`smc-remote:${pairing.secret}`, { config: { broadcast: { self: false } } });
    channelRef.current = ch;
    let heard = false;
    ch.on('broadcast', { event: 'box' }, ({ payload }) => {
      const m = payload as { t?: string; typing?: boolean; value?: string; password?: boolean; label?: string };
      heard = true;
      setStatus('live');
      if (m.t === 'field') {
        const f = { typing: !!m.typing, value: m.value ?? '', password: !!m.password, label: m.label ?? '' };
        setField(f);
        if (f.typing) { setKeyboardOpen(true); setText(f.value); window.setTimeout(() => inputRef.current?.focus(), 50); }
      }
      if (m.t === 'unpaired') { savePairing(null); onUnpaired('This TV unpaired its phones. Pair again with the new code on the TV.'); }
    });
    ch.subscribe((s) => {
      if (s === 'SUBSCRIBED') {
        void ch.send({ type: 'broadcast', event: 'phone', payload: { t: 'hello', id: pairing.id } });
        window.setTimeout(() => { if (!heard) setStatus('quiet'); }, 5000);
      }
    });
    const hello = window.setInterval(() => { void ch.send({ type: 'broadcast', event: 'phone', payload: { t: 'hello', id: pairing.id } }); }, HELLO_EVERY_MS);
    const bye = () => { void ch.send({ type: 'broadcast', event: 'phone', payload: { t: 'bye', id: pairing.id } }); };
    window.addEventListener('pagehide', bye);
    return () => { window.clearInterval(hello); window.removeEventListener('pagehide', bye); bye(); void client().removeChannel(ch); channelRef.current = null; };
  }, [pairing.secret, pairing.id, onUnpaired]);

  const key = useCallback((k: string) => { buzz(); send({ t: 'key', k }); }, [send]);

  const onType = (v: string) => {
    setText(v);
    if (textTimer.current) window.clearTimeout(textTimer.current);
    textTimer.current = window.setTimeout(() => send({ t: 'text', v }), 120);
  };

  const talk = () => {
    if (!Speech || listening) return;
    const r = new Speech();
    r.lang = navigator.language || 'en-US';
    r.interimResults = false;
    r.onresult = (e) => {
      const said = e.results?.[0]?.[0]?.transcript?.trim();
      if (!said) return;
      // With a text box open on the TV, words go into it; otherwise they are a command.
      if (field.typing) { onType(said); } else send({ t: 'voice', v: said });
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    setListening(true);
    buzz();
    r.start();
  };

  const small = 'flex flex-col items-center justify-center rounded-2xl bg-white/10 active:bg-white/20 py-3 text-xs text-white/80 select-none';
  return (
    <div className="min-h-screen bg-[#071b3a] text-white px-5 pt-5 pb-8 flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full mr-2 ${status === 'live' ? 'bg-emerald-400' : status === 'quiet' ? 'bg-amber-400' : 'bg-white/40 animate-pulse'}`} />
          <span className="truncate font-semibold">{pairing.label}</span>
        </div>
        <button type="button" onClick={() => { savePairing(null); onUnpaired(); }} className="text-white/60 text-sm flex items-center"><Unlink className="w-4 h-4 mr-1" /> Forget</button>
      </div>
      {status === 'quiet' && (
        <p className="mb-4 rounded-xl bg-amber-500/15 border border-amber-400/40 px-3 py-2 text-sm text-amber-200">
          The TV isn't answering. Make sure Snow Media Center is open on it — the remote works while the app is on screen.
        </p>
      )}

      <div className="grid grid-cols-3 gap-3 mb-6">
        <button type="button" className={small} onClick={() => key('back')}><ArrowLeft className="w-6 h-6 mb-1" />Back</button>
        <button type="button" className={small} onClick={() => { buzz(); send({ t: 'home' }); }}><Home className="w-6 h-6 mb-1" />Home</button>
        <button type="button" className={small} onClick={() => key('menu')}><Menu className="w-6 h-6 mb-1" />Options</button>
      </div>

      <Pad onKey={key} />

      <div className="grid grid-cols-3 gap-3 mt-6">
        <button type="button" className={small} onClick={() => key('rw')}><Rewind className="w-6 h-6 mb-1" />Rewind</button>
        <button type="button" className={small} onClick={() => key('playpause')}><Pause className="w-6 h-6 mb-1" />Play/Pause</button>
        <button type="button" className={small} onClick={() => key('ff')}><FastForward className="w-6 h-6 mb-1" />Forward</button>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <button type="button" className={small} onClick={() => { setKeyboardOpen((o) => !o); window.setTimeout(() => inputRef.current?.focus(), 50); }}>
          <Keyboard className="w-6 h-6 mb-1" />Keyboard
        </button>
        <button type="button" className={`${small} ${listening ? 'bg-red-500/40' : ''}`} onClick={talk} disabled={!Speech}>
          <Mic className="w-6 h-6 mb-1" />{Speech ? (listening ? 'Listening…' : 'Voice') : 'Voice (not on this phone)'}
        </button>
      </div>

      {keyboardOpen && (
        <div className="mt-4 rounded-2xl bg-white/10 p-3">
          <div className="text-xs text-white/60 mb-2">
            {field.typing ? `Typing into the TV${field.label ? `: ${field.label}` : ''}` : 'Pick a text box on the TV (a search or sign-in box), then type here.'}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); send({ t: 'text', v: text }); window.setTimeout(() => send({ t: 'submit' }), 150); buzz(); }} className="flex">
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
    // A new code in the address means a (maybe different) TV: pair again.
    try { if (new URLSearchParams(window.location.search).get('c')) return null; } catch { /* ignore */ }
    return loadPairing();
  });
  const [message, setMessage] = useState<string | null>(null);
  const onUnpaired = useCallback((msg?: string) => { setPairing(null); setMessage(msg ?? null); }, []);
  useEffect(() => { document.title = 'Snow Media Remote'; }, []);
  return pairing
    ? <RemoteScreen pairing={pairing} onUnpaired={onUnpaired} />
    : <PairScreen onPaired={(p) => { setMessage(null); setPairing(p); }} message={message} />;
}
