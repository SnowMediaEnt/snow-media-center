// Open the voice command overlay (VoiceCommandHost) from anywhere.
export const OPEN_VOICE_EVENT = 'smc-voice:open';

export function openVoice(): void {
  try { window.dispatchEvent(new CustomEvent(OPEN_VOICE_EVENT)); } catch { /* ignore */ }
}
