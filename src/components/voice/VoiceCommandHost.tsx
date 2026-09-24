// Talk to the TV: "put on ESPN", "watch The Office", "open YouTube", "take me
// to the Device Cleaner", "what channel has the Lakers game?".
//
// Opens from the home screen's mic button, the remote's Search key (raised by
// MainActivity as the 'search' media key, or delivered as a key), or
// openVoice(). Listening is VoiceInput's: the box's own speech recognizer on
// Android TV, the recorded-clip fallback (elevenlabs-stt) elsewhere.
//
// What was said is understood on the box when it can be (voiceCommands.ts)
// and acted on at once; anything else goes to the assistant (snow-media-ai in
// voice mode), whose answer is either one of the same actions or a short
// reply shown here. A Kids profile keeps its limits: no Store, Games,
// Settings or other apps by voice.
//
// While it is up it owns the remote, over the Player too: its key handler is
// the first window listener (voiceUi.setVoiceKeyHandler), and Back closes
// only the overlay. It does not open over another popup.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, X } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import VoiceInput, { type VoiceLifecycleControls, type VoiceState } from '@/components/VoiceInput';
import { supabase } from '@/integrations/supabase/client';
import {
  installApp, openInstalledApp, openPlexTitle, openScreen, playChannel, reportChannel, setPreference, generateWallpaper,
  KIDS_BLOCKED_SCREENS, SCREEN_LABELS, type Navigate, type PreferenceKey, type Screen,
} from '@/lib/appActions';
import { getDeviceId, trackEvent } from '@/lib/analytics';
import { kidsLevel } from '@/lib/kidsFilter';
import { getPreferredTier, setPreferredTier } from '@/lib/aiTiers';
import { KIDS_AI_SHORT } from '@/lib/kidsAiNotice';
import { openProfiles } from '@/lib/profilesUi';
import { parseVoiceCommand, type VoiceAction } from '@/lib/voiceCommands';
import { OPEN_VOICE_EVENT, setVoiceKeyHandler } from '@/lib/voiceUi';
import { MEDIA_KEY_EVENT } from '@/lib/mediaKeys';
import { REMOTE_VOICE_EVENT } from '@/lib/phoneRemote';

// The remote's Search key reaches the page as the 'search' media key
// (MainActivity takes KEYCODE_SEARCH). As a key it is a keyboard's named
// Search key: Android's code for it, 84, is the letter T in a keydown, and
// no typed character counts ('*' is 170 in some browsers).
const SEARCH_KEYS = new Set(['BrowserSearch', 'Search', 'LaunchAssistant']);
const isSearchKey = (e: KeyboardEvent) => SEARCH_KEYS.has(e.key) || (e.keyCode === 170 && (e.key || '').length !== 1);
const isBack = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.keyCode === 4 || e.keyCode === 27;
const isOk = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;
const isArrow = (e: KeyboardEvent) => e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown';

/** Another popup (What's New, a boot notice, a kickoff reminder, a Player
 *  dialog). The overlay does not open over one, and yields the keys to one
 *  that opens over it. */
const OTHER_POPUP = '[role="dialog"][aria-modal="true"]:not([data-voice-overlay]), [role="dialog"][data-state="open"]:not([data-voice-overlay]), [role="alertdialog"][data-state="open"], [data-notice-layer]';
const otherPopupOpen = () => { try { return !!document.querySelector(OTHER_POPUP); } catch { return false; } };

/** Commands from the phone remote: one at a time, at most one this often.
 *  Each can cost Snow Gems (the assistant), and whoever holds the pairing
 *  could send them in a loop. One whose answer never comes stops blocking
 *  the next after PHONE_STUCK_MS. */
const PHONE_GAP_MS = 3000;
const PHONE_STUCK_MS = 30000;

type Phase =
  | { kind: 'listening' }
  | { kind: 'working'; heard: string; doing: string }
  | { kind: 'reply'; heard: string; text: string }
  /** The mic stopped without hearing a command (failed, cancelled, silent). */
  | { kind: 'stopped'; reason: string };

interface AiCall { name: string; arguments: Record<string, unknown> }

const EXAMPLES = ['"Put on ESPN"', '"Watch The Office"', '"Open YouTube"', '"Go to the Guide"', '"Search for Batman"'];

const VoiceCommandHost = ({ navigate, blocked = false }: { navigate: Navigate; blocked?: boolean }) => {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'listening' });
  const [attempt, setAttempt] = useState(0);
  // Heard on the phone remote: the words are already here, the TV's mic stays off.
  const [fromPhone, setFromPhone] = useState(false);
  const [focus, setFocus] = useState<'mic' | 'close'>('mic');
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const navigateRef = useRef(navigate); navigateRef.current = navigate;
  const blockedRef = useRef(blocked); blockedRef.current = blocked;
  const openRef = useRef(open); openRef.current = open;
  const focusRef = useRef(focus); focusRef.current = focus;
  const attemptRef = useRef(attempt); attemptRef.current = attempt;
  // Which request is current: bumped whenever the overlay opens, closes or
  // starts listening again, so a slow answer to an earlier one is dropped.
  const reqRef = useRef(0);

  const canOpen = useCallback(() => !blockedRef.current && !otherPopupOpen(), []);

  const close = useCallback(() => {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    reqRef.current += 1;
    setOpen(false);
  }, []);
  const closeSoon = useCallback((ms = 1200) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => { closeTimer.current = null; reqRef.current += 1; setOpen(false); }, ms);
  }, []);

  const start = useCallback(() => {
    if (!canOpen()) return;
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    reqRef.current += 1;
    setPhase({ kind: 'listening' });
    setFocus('mic');
    setFromPhone(false);
    setAttempt((a) => a + 1);
    setOpen(true);
    try { trackEvent('voice_open', 'ai'); } catch { void 0; }
  }, [canOpen]);

  // ── ways in ── (the Search key as a key: see "the remote" below)
  useEffect(() => {
    const onOpen = () => start();
    const onMedia = (e: Event) => { if ((e as CustomEvent).detail === 'search' && !openRef.current) start(); };
    window.addEventListener(OPEN_VOICE_EVENT, onOpen);
    window.addEventListener(MEDIA_KEY_EVENT, onMedia);
    return () => {
      window.removeEventListener(OPEN_VOICE_EVENT, onOpen);
      window.removeEventListener(MEDIA_KEY_EVENT, onMedia);
    };
  }, [start]);

  // ── doing it ──
  const say = useCallback((heard: string, doing: string, closeAfter = 1200) => {
    setPhase({ kind: 'working', heard, doing });
    if (closeAfter > 0) closeSoon(closeAfter);
  }, [closeSoon]);

  const act = useCallback(async (heard: string, a: VoiceAction, phone = false): Promise<void> => {
    const nav = navigateRef.current;
    const kids = !!kidsLevel();
    const req = reqRef.current;
    const grownUp = (what: string) => say(heard, `${what} needs a grown-up — switch profile first.`, 2600);
    switch (a.kind) {
      case 'screen':
        if (kids && KIDS_BLOCKED_SCREENS.has(a.screen)) { grownUp(SCREEN_LABELS[a.screen]); return; }
        say(heard, `Opening ${openScreen(a.screen, nav)}…`);
        return;
      case 'profiles':
        close();
        openProfiles('pick');
        return;
      case 'channel':
        say(heard, `Finding ${a.name}…`);
        playChannel(a.name, nav);
        return;
      case 'plex':
      case 'watch':
        say(heard, a.kind === 'plex' && !a.open ? `Searching Plex for ${a.query}…` : `Finding ${a.query} on Plex…`);
        openPlexTitle(a.query, a.kind === 'watch' ? true : a.open, nav);
        return;
      case 'app':
        if (kids) { grownUp('Opening other apps'); return; }
        setPhase({ kind: 'working', heard, doing: `Looking for ${a.name}…` });
        {
          const line = await openInstalledApp(a.name, nav);
          if (reqRef.current === req) say(heard, line, 2000);
        }
        return;
      case 'install':
        if (kids) { grownUp('Installing apps'); return; }
        say(heard, `Finding ${a.name} in Main Apps…`, 1800);
        installApp(a.name, nav);
        return;
      case 'ai':
        await askAssistant(heard, phone);
        return;
    }
  // askAssistant is declared below and stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close, say]);

  const runAiCall = useCallback(async (heard: string, call: AiCall, phone: boolean): Promise<boolean> => {
    const args = call.arguments || {};
    const nav = navigateRef.current;
    const str = (k: string) => String(args[k] ?? '').trim();
    switch (call.name) {
      case 'open_screen': await act(heard, { kind: 'screen', screen: str('screen') as Screen }); return true;
      case 'play_channel': if (!str('channel_name')) return false; await act(heard, { kind: 'channel', name: str('channel_name') }); return true;
      case 'plex_title': if (!str('title')) return false; await act(heard, { kind: 'plex', query: str('title'), open: str('action') !== 'search' }); return true;
      case 'open_app': if (!str('app_name')) return false; await act(heard, { kind: 'app', name: str('app_name') }); return true;
      case 'install_app': if (!str('app_name')) return false; await act(heard, { kind: 'install', name: str('app_name') }); return true;
      case 'report_channel':
        say(heard, `Opening a report for ${str('channel_name')} — press OK to send it.`, 2400);
        reportChannel({ search: str('channel_name'), issue: str('issue') || undefined, details: str('details') || undefined }, nav);
        return true;
      case 'set_preference': {
        if (kidsLevel()) { say(heard, 'Settings need a grown-up — switch profile first.', 2600); return true; }
        const said = setPreference(str('key') as PreferenceKey, str('value'));
        say(heard, said ?? "I couldn't change that one.", 2600);
        return true;
      }
      case 'generate_wallpaper':
        if (kidsLevel()) { say(heard, 'Backgrounds need a grown-up — switch profile first.', 2600); return true; }
        // From the phone the idea is only filled in: making it costs Snow
        // Gems, so Generate is pressed on the TV.
        if (phone) {
          say(heard, 'Your idea is in Settings → Media — press Generate on the TV.', 2600);
          generateWallpaper(str('prompt'), nav, false);
          return true;
        }
        say(heard, 'Making your background — this takes a moment.', 2200);
        generateWallpaper(str('prompt'), nav);
        return true;
      default:
        return false;
    }
  }, [act, say]);

  const askAssistant = useCallback(async (heard: string, phone = false) => {
    const req = reqRef.current;
    // Closed, or a newer command since: this answer is no longer wanted.
    const stale = () => !openRef.current || reqRef.current !== req;
    setPhase({ kind: 'working', heard, doing: 'Thinking…' });
    try {
      const currentVersion = await fetch('/version.json').then((r) => r.json()).then((d) => d.currentVersion).catch(() => undefined);
      const { data: { session } } = await supabase.auth.getSession();
      // The Snow AI level chosen under Settings → UI (Premium needs an account;
      // the server charges its gems). Never for a Kids profile (its Settings
      // has no such switch), nor from the phone remote.
      let premium = !phone && !!session?.user && !kidsLevel() && getPreferredTier('chat') === 'premium';
      const ask = (tier: boolean) => supabase.functions.invoke('snow-media-ai', {
        body: {
          message: heard,
          mode: 'voice_command',
          userId: session?.user?.id,
          conversationId: null,
          saveConversation: false,
          currentVersion,
          device_id: getDeviceId(),
          ...(tier ? { tier: 'premium' } : {}),
          ...(kidsLevel() ? { kids_level: kidsLevel() } : {}),
        },
      });
      const failureOf = async (error: unknown): Promise<{ error?: string; message?: string }> => {
        try { return await (error as { context?: Response }).context?.clone().json() ?? {}; } catch { return {}; }
      };
      let { data, error } = await ask(premium);
      if (error && premium && !stale() && (await failureOf(error)).error === 'premium_disabled') {
        // Premium was switched off after it was chosen, and its switch is
        // hidden now, so there is no way back to Free: go back to it here.
        setPreferredTier('chat', 'free');
        premium = false;
        ({ data, error } = await ask(false));
      }
      if (stale()) return;
      if (error) {
        const failure = await failureOf(error);
        if (failure.error === 'insufficient_gems' || failure.error === 'premium_disabled' || failure.error === 'premium_requires_signin') {
          setPhase({ kind: 'reply', heard, text: failure.message || 'Snow AI Premium isn\'t available right now — switch to Free under Settings → UI.' });
          setFocus('close');
          return;
        }
        throw error;
      }
      const d = data as { blocked?: boolean; reason?: string; response?: string; message?: string; functionCall?: AiCall } | null;
      if (d?.blocked) { setPhase({ kind: 'reply', heard, text: d.reason || 'The assistant is busy right now. Try again in a bit.' }); return; }
      // Signed in on Free: the same 0.01 Snow Gems an AI Chat message costs.
      if (session?.user && !premium) {
        void supabase.rpc('update_user_credits', {
          p_user_id: session.user.id, p_amount: 0.01, p_transaction_type: 'deduction', p_description: `Voice command - "${heard.slice(0, 50)}"`,
        }).then(() => undefined, () => undefined);
      }
      if (d?.functionCall && (await runAiCall(heard, d.functionCall, phone))) return;
      const text = (d?.response || d?.message || '').trim();
      setPhase({ kind: 'reply', heard, text: text || "Sorry, I didn't get that. Try \"put on ESPN\" or \"open Plex\"." });
      setFocus('close');
    } catch {
      if (stale()) return;
      setPhase({ kind: 'reply', heard, text: "Couldn't reach the assistant. Check the internet connection and try again." });
      setFocus('close');
    }
  }, [runAiCall]);

  // The phone remote's voice button: what it heard, run like a spoken
  // command — one at a time, and not faster than one every PHONE_GAP_MS.
  const actRef = useRef<(heard: string) => Promise<void>>(async () => {});
  const phoneBusy = useRef(false);
  const phoneLast = useRef(0);
  useEffect(() => {
    const on = (e: Event) => {
      const heard = String((e as CustomEvent<string>).detail || '').trim();
      if (!heard || !canOpen()) return;
      const now = Date.now();
      if (now - phoneLast.current < (phoneBusy.current ? PHONE_STUCK_MS : PHONE_GAP_MS)) return;
      phoneBusy.current = true;
      phoneLast.current = now;
      const mine = now;
      if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
      reqRef.current += 1;
      setFromPhone(true);
      setFocus('close');
      setOpen(true);
      void actRef.current(heard).catch(() => undefined).then(() => { if (phoneLast.current === mine) phoneBusy.current = false; });
    };
    window.addEventListener(REMOTE_VOICE_EVENT, on);
    return () => window.removeEventListener(REMOTE_VOICE_EVENT, on);
  }, [canOpen]);

  const onTranscription = useCallback(async (text: string, controls: VoiceLifecycleControls) => {
    controls.setVoiceState('idle');
    const heard = text.trim();
    // Heard after the overlay closed: the command is not wanted any more.
    if (!heard || !openRef.current) return;
    try { trackEvent('voice_command', 'ai', { local: parseVoiceCommand(heard).kind !== 'ai' }); } catch { void 0; }
    await act(heard, parseVoiceCommand(heard));
  }, [act]);
  actRef.current = (heard: string) => {
    try { trackEvent('voice_command', 'ai', { local: parseVoiceCommand(heard).kind !== 'ai', phone: true }); } catch { void 0; }
    return act(heard, parseVoiceCommand(heard), true);
  };

  // What the mic is doing. When it stops without a command (no recognizer,
  // no mic, not signed in, Back in the speech dialog, silence) the overlay
  // says so and why, instead of "Listening…" for good; OK on the mic tries
  // again. `forAttempt`: a mic that has since been replaced is not heard.
  const onVoiceState = useCallback((s: VoiceState, forAttempt: number) => {
    if (forAttempt !== attemptRef.current) return;
    if (s === 'error' || s === 'cancelled') {
      const reason = s === 'cancelled' ? 'Stopped listening.' : "Voice didn't work on this box.";
      setPhase((p) => (p.kind === 'listening' ? { kind: 'stopped', reason } : p));
    } else if (s === 'requesting_permission') {
      // Listening again (OK on the mic): whatever was on its way is dropped.
      if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
      reqRef.current += 1;
      setPhase({ kind: 'listening' });
    }
  }, []);
  const onVoiceError = useCallback((title: string, description: string | undefined, forAttempt: number) => {
    if (forAttempt !== attemptRef.current) return;
    const reason = description ? `${title}. ${description}` : title;
    setPhase((p) => (p.kind === 'listening' || p.kind === 'stopped' ? { kind: 'stopped', reason } : p));
  }, []);

  // ── the remote ──
  // One handler for the life of the host, run before every screen's own
  // listener (see voiceUi). While the overlay is up it keeps every key, and
  // the keyup of each one it took: the Live TV list plays a channel on OK's
  // keyup. A popup that opens over it (a kickoff reminder) gets the keys.
  const lastBack = useRef(0);
  const back = useCallback(() => {
    const now = Date.now();
    if (now - lastBack.current < 350) return;
    lastBack.current = now;
    (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = now;
    close();
  }, [close]);
  useEffect(() => {
    const taken = new Map<string, number>();
    const id = (e: KeyboardEvent) => `${e.key}|${e.keyCode}`;
    const onKey = (e: KeyboardEvent) => {
      const now = Date.now();
      if (e.type === 'keyup') {
        const at = taken.get(id(e));
        if (at === undefined) return;
        taken.delete(id(e));
        if (now - at < 3000) { e.preventDefault(); e.stopImmediatePropagation(); }
        return;
      }
      if (e.type !== 'keydown') return;
      if (!openRef.current) {
        // The Player's copy of a Back the overlay's own backButton listener
        // has just answered (it synthesizes an Escape): already handled.
        if (isBack(e) && now - lastBack.current < 350) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        // Only while it can open: otherwise the key is left alone.
        if (!isSearchKey(e) || !canOpen()) return;
        e.preventDefault(); e.stopImmediatePropagation();
        taken.set(id(e), now);
        start();
        return;
      }
      if (otherPopupOpen()) return;
      e.stopImmediatePropagation();
      taken.set(id(e), now);
      if (isBack(e)) { e.preventDefault(); back(); return; }
      if (isArrow(e)) {
        e.preventDefault();
        setFocus((f) => (f === 'mic' ? 'close' : 'mic'));
        return;
      }
      if (isSearchKey(e)) { e.preventDefault(); if (!e.repeat) start(); return; }
      if (isOk(e)) {
        e.preventDefault();
        if (e.repeat) return;
        if (focusRef.current === 'close') close();
        else rootRef.current?.querySelector<HTMLButtonElement>('[data-voice-mic] button')?.click();
      }
    };
    const unhook = setVoiceKeyHandler(onKey);
    const onBack = () => { if (openRef.current && !otherPopupOpen()) back(); };
    let handle: { remove: () => void } | null = null;
    let cancelled = false;
    void CapApp.addListener('backButton', onBack).then((h) => { if (cancelled) h.remove(); else handle = h; }).catch(() => { /* web */ });
    return () => { unhook(); cancelled = true; handle?.remove(); };
  }, [back, canOpen, close, start]);

  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);

  if (!open) return null;
  const heard = phase.kind === 'listening' || phase.kind === 'stopped' ? null : phase.heard;
  const mic = attempt;
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      data-state="open"
      data-voice-overlay=""
      aria-label="Voice"
      className="fixed inset-x-0 bottom-0 z-[160] flex justify-center px-6 pb-10 pointer-events-none"
    >
      <div
        className="pointer-events-auto w-full max-w-3xl rounded-3xl border border-white/20 px-8 py-6 text-white shadow-2xl"
        style={{ backgroundColor: 'rgba(7, 27, 58, 0.96)' }}
      >
        <div className="flex items-center">
          <div className="mr-5 flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-gold/90">
            <Mic className={`h-8 w-8 text-black ${phase.kind === 'listening' ? 'animate-pulse' : ''}`} />
          </div>
          <div className="min-w-0 flex-1">
            {heard ? (
              <>
                <div className="truncate text-2xl font-bold">“{heard}”</div>
                <div className="mt-1 text-lg text-white/80 max-h-40 overflow-y-auto">
                  {phase.kind === 'working' ? phase.doing : phase.kind === 'reply' ? phase.text : ''}
                </div>
              </>
            ) : phase.kind === 'stopped' ? (
              <>
                <div className="text-2xl font-bold">Didn’t catch that</div>
                <div className="mt-1 text-lg text-white/80 max-h-40 overflow-y-auto">{phase.reason} Press OK on the mic to try again.</div>
              </>
            ) : (
              <>
                <div className="text-2xl font-bold">Listening…</div>
                <div className="mt-1 text-base text-white/70">
                  {kidsLevel() ? KIDS_AI_SHORT : `Try ${EXAMPLES.join(' · ')}`}
                </div>
              </>
            )}
          </div>
          <div className="ml-5 flex shrink-0 items-center">
            <div data-voice-mic className={`mr-3 rounded-xl ${focus === 'mic' ? 'ring-4 ring-white' : ''}`}>
              <VoiceInput
                key={mic}
                autoStart={!fromPhone}
                prompt="Say a command"
                onTranscription={onTranscription}
                onVoiceStateChange={(st) => onVoiceState(st, mic)}
                onVoiceError={(title, description) => onVoiceError(title, description, mic)}
              />
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className={`rounded-xl p-2 ${focus === 'close' ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VoiceCommandHost;
