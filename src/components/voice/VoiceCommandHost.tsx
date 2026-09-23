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
import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, X } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import VoiceInput, { type VoiceLifecycleControls } from '@/components/VoiceInput';
import { supabase } from '@/integrations/supabase/client';
import {
  installApp, openInstalledApp, openPlexTitle, openScreen, playChannel, reportChannel, setPreference, generateWallpaper,
  SCREEN_LABELS, type Navigate, type PreferenceKey, type Screen,
} from '@/lib/appActions';
import { getDeviceId, trackEvent } from '@/lib/analytics';
import { kidsLevel } from '@/lib/kidsFilter';
import { openProfiles } from '@/lib/profilesUi';
import { parseVoiceCommand, type VoiceAction } from '@/lib/voiceCommands';
import { OPEN_VOICE_EVENT } from '@/lib/voiceUi';
import { MEDIA_KEY_EVENT } from '@/lib/mediaKeys';

/** Screens a Kids profile does not open by voice either. */
const GROWN_UP_SCREENS = new Set<Screen>([
  'game_lounge', 'snow_gems', 'giveaway', 'dashboard', 'settings', 'settings_ui', 'wallpaper',
  'player_settings', 'player_appearance', 'main_apps',
]);

const SEARCH_KEYS = new Set(['BrowserSearch', 'Search', 'LaunchAssistant']);
const isSearchKey = (e: KeyboardEvent) => SEARCH_KEYS.has(e.key) || e.keyCode === 84 || e.keyCode === 170 || e.keyCode === 231;
const isBack = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.keyCode === 4 || e.keyCode === 27;
const isOk = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66;

type Phase =
  | { kind: 'listening' }
  | { kind: 'working'; heard: string; doing: string }
  | { kind: 'reply'; heard: string; text: string };

interface AiCall { name: string; arguments: Record<string, unknown> }

const EXAMPLES = ['"Put on ESPN"', '"Watch The Office"', '"Open YouTube"', '"Go to the Guide"', '"Search for Batman"'];

const VoiceCommandHost = ({ navigate, blocked = false }: { navigate: Navigate; blocked?: boolean }) => {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'listening' });
  const [attempt, setAttempt] = useState(0);
  const [focus, setFocus] = useState<'mic' | 'close'>('mic');
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const navigateRef = useRef(navigate); navigateRef.current = navigate;
  const blockedRef = useRef(blocked); blockedRef.current = blocked;
  const openRef = useRef(open); openRef.current = open;

  const close = useCallback(() => {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(false);
  }, []);
  const closeSoon = useCallback((ms = 1200) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => { closeTimer.current = null; setOpen(false); }, ms);
  }, []);

  const start = useCallback(() => {
    if (blockedRef.current) return;
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    setPhase({ kind: 'listening' });
    setFocus('mic');
    setAttempt((a) => a + 1);
    setOpen(true);
    try { trackEvent('voice_open', 'ai'); } catch { void 0; }
  }, []);

  // ── ways in ──
  useEffect(() => {
    const onOpen = () => start();
    const onMedia = (e: Event) => { if ((e as CustomEvent).detail === 'search' && !openRef.current) start(); };
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchKey(e) || openRef.current) return;
      e.preventDefault(); e.stopImmediatePropagation();
      start();
    };
    window.addEventListener(OPEN_VOICE_EVENT, onOpen);
    window.addEventListener(MEDIA_KEY_EVENT, onMedia);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener(OPEN_VOICE_EVENT, onOpen);
      window.removeEventListener(MEDIA_KEY_EVENT, onMedia);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [start]);

  // ── doing it ──
  const say = useCallback((heard: string, doing: string, closeAfter = 1200) => {
    setPhase({ kind: 'working', heard, doing });
    if (closeAfter > 0) closeSoon(closeAfter);
  }, [closeSoon]);

  const act = useCallback(async (heard: string, a: VoiceAction): Promise<void> => {
    const nav = navigateRef.current;
    const kids = !!kidsLevel();
    const grownUp = (what: string) => say(heard, `${what} needs a grown-up — switch profile first.`, 2600);
    switch (a.kind) {
      case 'screen':
        if (kids && GROWN_UP_SCREENS.has(a.screen)) { grownUp(SCREEN_LABELS[a.screen]); return; }
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
        say(heard, await openInstalledApp(a.name, nav), 2000);
        return;
      case 'install':
        if (kids) { grownUp('Installing apps'); return; }
        say(heard, `Finding ${a.name} in Main Apps…`, 1800);
        installApp(a.name, nav);
        return;
      case 'ai':
        await askAssistant(heard);
        return;
    }
  // askAssistant is declared below and stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close, say]);

  const runAiCall = useCallback(async (heard: string, call: AiCall): Promise<boolean> => {
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
        say(heard, 'Making your background — this takes a moment.', 2200);
        generateWallpaper(str('prompt'), nav);
        return true;
      default:
        return false;
    }
  }, [act, say]);

  const askAssistant = useCallback(async (heard: string) => {
    setPhase({ kind: 'working', heard, doing: 'Thinking…' });
    try {
      const currentVersion = await fetch('/version.json').then((r) => r.json()).then((d) => d.currentVersion).catch(() => undefined);
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke('snow-media-ai', {
        body: {
          message: heard,
          mode: 'voice_command',
          userId: session?.user?.id,
          conversationId: null,
          saveConversation: false,
          currentVersion,
          device_id: getDeviceId(),
        },
      });
      if (!openRef.current) return;
      if (error) throw error;
      const d = data as { blocked?: boolean; reason?: string; response?: string; message?: string; functionCall?: AiCall } | null;
      if (d?.blocked) { setPhase({ kind: 'reply', heard, text: d.reason || 'The assistant is busy right now. Try again in a bit.' }); return; }
      // Signed in: the same 0.01 Snow Gems an AI Chat message costs.
      if (session?.user) {
        void supabase.rpc('update_user_credits', {
          p_user_id: session.user.id, p_amount: 0.01, p_transaction_type: 'deduction', p_description: `Voice command - "${heard.slice(0, 50)}"`,
        }).then(() => undefined, () => undefined);
      }
      if (d?.functionCall && (await runAiCall(heard, d.functionCall))) return;
      const text = (d?.response || d?.message || '').trim();
      setPhase({ kind: 'reply', heard, text: text || "Sorry, I didn't get that. Try \"put on ESPN\" or \"open Plex\"." });
      setFocus('close');
    } catch {
      if (!openRef.current) return;
      setPhase({ kind: 'reply', heard, text: "Couldn't reach the assistant. Check the internet connection and try again." });
      setFocus('close');
    }
  }, [runAiCall]);

  const onTranscription = useCallback(async (text: string, controls: VoiceLifecycleControls) => {
    controls.setVoiceState('idle');
    const heard = text.trim();
    if (!heard) return;
    try { trackEvent('voice_command', 'ai', { local: parseVoiceCommand(heard).kind !== 'ai' }); } catch { void 0; }
    await act(heard, parseVoiceCommand(heard));
  }, [act]);

  // ── keys while open ──
  const lastBack = useRef(0);
  const back = useCallback(() => {
    const now = Date.now();
    if (now - lastBack.current < 350) return;
    lastBack.current = now;
    (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = now;
    close();
  }, [close]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (isBack(e)) { e.preventDefault(); back(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocus((f) => (f === 'mic' ? 'close' : 'mic'));
        return;
      }
      if (isSearchKey(e)) { e.preventDefault(); start(); return; }
      if (isOk(e)) {
        e.preventDefault();
        if (focus === 'close') close();
        else rootRef.current?.querySelector<HTMLButtonElement>('[data-voice-mic] button')?.click();
      }
    };
    window.addEventListener('keydown', onKey, true);
    let handle: { remove: () => void } | null = null;
    let cancelled = false;
    void CapApp.addListener('backButton', back).then((h) => { if (cancelled) h.remove(); else handle = h; }).catch(() => { /* web */ });
    return () => { window.removeEventListener('keydown', onKey, true); cancelled = true; handle?.remove(); };
  }, [open, focus, back, close, start]);

  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);

  if (!open) return null;
  const heard = phase.kind === 'listening' ? null : phase.heard;
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      data-state="open"
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
            ) : (
              <>
                <div className="text-2xl font-bold">Listening…</div>
                <div className="mt-1 text-base text-white/70">Try {EXAMPLES.join(' · ')}</div>
              </>
            )}
          </div>
          <div className="ml-5 flex shrink-0 items-center">
            <div data-voice-mic className={`mr-3 rounded-xl ${focus === 'mic' ? 'ring-4 ring-white' : ''}`}>
              <VoiceInput key={attempt} autoStart prompt="Say a command" onTranscription={onTranscription} />
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
