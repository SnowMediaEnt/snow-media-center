// The Live buffer (lib/liveBuffer) for the channel Live TV is playing: the
// cushion it loads with, and what a real stall on it does (Auto: one size
// more, told to the player at once so this very refill is the bigger one).
//
// A preview stays quick (coordinator, 2026-10-26: people browse channels in
// the box): it always plays with the player's own 2.5 / 5 s. Once the
// channel is watched (full screen, held in the box, the box upright on a
// phone) the same stream is raised to the channel's cushion in place, no
// reload. A stall while previewing still steps the channel up, for when it
// is watched.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SnowPlayer } from '@/capacitor/SnowPlayer';
import {
  DEFAULT_CUSHION, LIVE_BUFFER_EVENT, channelBufferKey, cushionFor, loadLiveBuffer, noteStall,
  type LiveBufferChoice, type LiveCushion,
} from '@/lib/liveBuffer';

export interface LiveCushionChannel {
  /** lineChannelKey(line, stream_id): kept hashed, never the login itself. */
  lineChannelKey: string;
  name?: string | null;
  category?: string | null;
}

export interface LiveCushionState {
  /** The channel's own cushion; null while no channel is playing. */
  cushion: LiveCushion | null;
  /** What the player holds right now: the channel's cushion when watched,
   *  the player's own in a preview (useNativePlayer's liveBuffer). */
  playing: LiveCushion | null;
  /** useNativePlayer's onLiveStall. */
  onStall: () => void;
}

export function useLiveCushion(channelIn: LiveCushionChannel | null, watched: boolean, engine: 'exo' | 'mpv' = 'exo'): LiveCushionState {
  // MPV buffers its own way: no cushion sent, no step-up, no "bigger buffer".
  const channel = engine === 'mpv' ? null : channelIn;
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
  const playing = cushion ? (watched ? cushion : DEFAULT_CUSHION) : null;
  const now = useRef({ choice, key, name, category, cushion, watched });
  now.current = { choice, key, name, category, cushion, watched };
  // Watched (or back to a preview), or a bigger one after a stall: the
  // player is told in place. The load sends the same, so a new channel's
  // own load needs nothing more.
  const startMs = playing?.startMs ?? 0;
  const rebufferMs = playing?.rebufferMs ?? 0;
  const told = useRef<string | null>(null);
  useEffect(() => {
    if (!key || !startMs) { told.current = null; return; }
    const at = `${key}:${startMs}:${rebufferMs}`;
    // The first cushion of a channel goes with its load.
    if (told.current === null || !told.current.startsWith(`${key}:`)) { told.current = at; return; }
    if (told.current === at) return;
    told.current = at;
    void SnowPlayer.setLiveBuffer({ liveStartBufferMs: startMs, liveRebufferMs: rebufferMs }).catch(() => { /* an older build */ });
  }, [key, startMs, rebufferMs]);
  const onStall = useCallback(() => {
    const c = now.current;
    if (!c.key || !c.cushion) return;
    // Stepped from the channel's own cushion, previewing or not; the player
    // hears of it through the effect above only while it is watched.
    if (!noteStall(c.choice, { key: c.key, name: c.name, category: c.category }, c.cushion)) return;
    setStepped((n) => n + 1);
  }, []);
  return { cushion, playing, onStall };
}
