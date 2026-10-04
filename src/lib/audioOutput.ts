// Whether the main player's sound goes out as a bitstream (Dolby / DTS passed
// through to the TV or receiver). No volume or boost in the app acts on it, so
// the volume controls say to use the TV's or receiver's instead. Set by
// useNativePlayer from the plugin's 'audioOutput' event; cleared when the
// player stops.
import { useSyncExternalStore } from 'react';

let passthrough = false;
const listeners = new Set<() => void>();

export function setAudioPassthrough(on: boolean): void {
  if (passthrough === on) return;
  passthrough = on;
  listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}

export function audioPassthrough(): boolean { return passthrough; }

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useAudioPassthrough(): boolean {
  return useSyncExternalStore(subscribe, audioPassthrough, audioPassthrough);
}
