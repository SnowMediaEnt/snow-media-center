// Open the voice command overlay (VoiceCommandHost) from anywhere.
export const OPEN_VOICE_EVENT = 'smc-voice:open';

export function openVoice(): void {
  try { window.dispatchEvent(new CustomEvent(OPEN_VOICE_EVENT)); } catch { /* ignore */ }
}

// The overlay's remote. Capture listeners on window run in the order they
// were added, and a later one cannot stop an earlier one — the Player, Game
// Day and the Guide add theirs when they open. So the listener is added here,
// once, when this module is first imported (Home imports it at startup), and
// VoiceCommandHost hands it its handler when it mounts, which may be after
// the Player has opened. The handler acts only while the overlay is up.
type KeyHandler = (e: KeyboardEvent) => void;
let voiceKeys: KeyHandler | null = null;

/** VoiceCommandHost's keydown/keyup handler. Returns the unsubscribe. */
export function setVoiceKeyHandler(fn: KeyHandler): () => void {
  voiceKeys = fn;
  return () => { if (voiceKeys === fn) voiceKeys = null; };
}

if (typeof window !== 'undefined') {
  const run = (e: KeyboardEvent) => { voiceKeys?.(e); };
  try {
    window.addEventListener('keydown', run, true);
    window.addEventListener('keyup', run, true);
  } catch { /* ignore */ }
}

// Hardware Back reaches every Capacitor backButton listener, in separate
// turns. The Player's Escape is the overlay's to take (above); a screen
// whose own listener acts on Back directly (the Guide) asks here first:
// while the overlay is up, or just closed by this same press, the press was
// the overlay's.
let voiceUp = false;
let voiceBackAt = 0;

/** VoiceCommandHost: whether the overlay is up, and when Back closed it. */
export function noteVoiceOverlay(up: boolean, backAt?: number): void {
  voiceUp = up;
  if (backAt) voiceBackAt = backAt;
}

/** A hardware Back now is the voice overlay's, not the screen's. */
export const voiceOwnsBack = (): boolean => voiceUp || Date.now() - voiceBackAt < 350;
