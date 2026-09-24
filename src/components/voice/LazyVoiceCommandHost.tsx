// Voice commands, loaded the first time they are asked for. The panel, the
// recognizer (VoiceInput), the command parser and the assistant call are not
// needed for Home's first paint, so until then only the ways in listen here:
// the mic button (openVoice), the remote's Search key (as a key or as the
// 'search' media key MainActivity raises) and the phone remote's voice button.
// What was asked for is replayed once VoiceCommandHost is up, so the first
// press works like every later one.
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Navigate } from '@/lib/appActions';
import { MEDIA_KEY_EVENT } from '@/lib/mediaKeys';
import { REMOTE_VOICE_EVENT } from '@/lib/phoneRemote';
import { OPEN_VOICE_EVENT, openVoice } from '@/lib/voiceUi';

const VoiceCommandHost = lazy(() => import('@/components/voice/VoiceCommandHost'));

// VoiceCommandHost's Search keys. Its bare key codes are Android's, which on
// a keyboard are letters (84 is 'T'), so here they count only when the key
// is not a character being typed.
const SEARCH_KEYS = new Set(['BrowserSearch', 'Search', 'LaunchAssistant']);
const isSearchKey = (e: KeyboardEvent) =>
  SEARCH_KEYS.has(e.key) || ((e.keyCode === 84 || e.keyCode === 170 || e.keyCode === 231) && (e.key || '').length !== 1);

type Wanted = { kind: 'open' } | { kind: 'phone'; heard: string };

/** Runs once, after VoiceCommandHost's own effects (it is the next sibling). */
const WhenMounted = ({ run }: { run: () => void }) => {
  useEffect(() => { run(); }, [run]);
  return null;
};

const LazyVoiceCommandHost = ({ navigate, blocked = false }: { navigate: Navigate; blocked?: boolean }) => {
  const [load, setLoad] = useState(false);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const wanted = useRef<Wanted | null>(null);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  useEffect(() => {
    if (ready) return;
    // Blocked ("Who's watching?" is up): VoiceCommandHost would ignore it too.
    const want = (w: Wanted) => {
      if (readyRef.current || blockedRef.current) return;
      wanted.current = w;
      setLoad(true);
    };
    const onOpen = () => want({ kind: 'open' });
    const onMedia = (e: Event) => { if ((e as CustomEvent).detail === 'search') want({ kind: 'open' }); };
    const onKey = (e: KeyboardEvent) => {
      if (readyRef.current || !isSearchKey(e)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      want({ kind: 'open' });
    };
    const onPhone = (e: Event) => {
      const heard = String((e as CustomEvent<string>).detail || '').trim();
      if (heard) want({ kind: 'phone', heard });
    };
    window.addEventListener(OPEN_VOICE_EVENT, onOpen);
    window.addEventListener(MEDIA_KEY_EVENT, onMedia);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener(REMOTE_VOICE_EVENT, onPhone);
    return () => {
      window.removeEventListener(OPEN_VOICE_EVENT, onOpen);
      window.removeEventListener(MEDIA_KEY_EVENT, onMedia);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener(REMOTE_VOICE_EVENT, onPhone);
    };
  }, [ready]);

  const replay = useCallback(() => {
    readyRef.current = true;
    setReady(true);
    const w = wanted.current;
    wanted.current = null;
    if (!w) return;
    if (w.kind === 'open') openVoice();
    else try { window.dispatchEvent(new CustomEvent(REMOTE_VOICE_EVENT, { detail: w.heard })); } catch { /* ignore */ }
  }, []);

  if (!load) return null;
  return (
    <Suspense fallback={null}>
      <VoiceCommandHost navigate={navigate} blocked={blocked} />
      <WhenMounted run={replay} />
    </Suspense>
  );
};

export default LazyVoiceCommandHost;
