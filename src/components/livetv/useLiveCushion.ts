// The Live buffer (lib/liveBuffer) for the channel Live TV is playing: the
// cushion it loads with, and what a real stall on it does (Auto: one size
// more, told to the player at once so this very refill is the bigger one).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SnowPlayer } from '@/capacitor/SnowPlayer';
import {
  LIVE_BUFFER_EVENT, channelBufferKey, cushionFor, loadLiveBuffer, noteStall,
  type LiveBufferChoice, type LiveCushion,
} from '@/lib/liveBuffer';

export interface LiveCushionChannel {
  /** lineChannelKey(line, stream_id): kept hashed, never the login itself. */
  lineChannelKey: string;
  name?: string | null;
  category?: string | null;
}

export interface LiveCushionState {
  /** null while no channel is playing. */
  cushion: LiveCushion | null;
  /** useNativePlayer's onLiveStall. */
  onStall: () => void;
}

export function useLiveCushion(channel: LiveCushionChannel | null): LiveCushionState {
  const [choice, setChoice] = useState<LiveBufferChoice>(loadLiveBuffer);
  useEffect(() => {
    const read = () => setChoice(loadLiveBuffer());
    window.addEventListener(LIVE_BUFFER_EVENT, read);
    return () => window.removeEventListener(LIVE_BUFFER_EVENT, read);
  }, []);
  const key = channel ? channelBufferKey(channel.lineChannelKey) : null;
  const name = channel?.name ?? null;
  const category = channel?.category ?? null;
  // Bumped when a stall stepped the channel up (the cushion is read again).
  const [stepped, setStepped] = useState(0);
  const cushion = useMemo(
    () => (key ? cushionFor(choice, { key, name, category }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [choice, key, name, category, stepped],
  );
  const now = useRef({ choice, key, name, category, cushion });
  now.current = { choice, key, name, category, cushion };
  const onStall = useCallback(() => {
    const c = now.current;
    if (!c.key || !c.cushion) return;
    const next = noteStall(c.choice, { key: c.key, name: c.name, category: c.category }, c.cushion);
    if (!next) return;
    void SnowPlayer.setLiveBuffer({ liveStartBufferMs: next.startMs, liveRebufferMs: next.rebufferMs }).catch(() => { /* an older build */ });
    setStepped((n) => n + 1);
  }, []);
  return { cushion, onStall };
}
