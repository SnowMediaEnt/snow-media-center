// Hands the keyboard_voice_attrs switch (lib/playerFlags) to the native
// WebView (SnowWebView.kt), which reads it from Preferences each time a text
// field opens the keyboard. Native boxes only; never throws.
import { Preferences } from '@capacitor/preferences';
import { isNativePlatform } from '@/utils/platform';
import { KEYBOARD_VOICE_FLAG, playerFlag } from '@/lib/playerFlags';

export const KEYBOARD_VOICE_PREF = 'smc-kb-voice-attrs';

export async function mirrorKeyboardVoiceFlag(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await Preferences.set({ key: KEYBOARD_VOICE_PREF, value: playerFlag(KEYBOARD_VOICE_FLAG) ? '1' : '0' });
  } catch { /* the native side keeps its last value */ }
}
