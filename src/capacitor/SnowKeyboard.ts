import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

interface SnowKeyboardPlugin {
  show(): Promise<void>;
  hide(): Promise<void>;
  /**
   * Fires on every genuine change in keyboard visibility. This is the only
   * source that works on Fire OS 7 (Android 9): @capacitor/keyboard detects the
   * keyboard through Android 11 inset animations, so keyboardDidShow never
   * arrives there and the page could not tell whether one was up.
   */
  addListener(
    event: 'keyboardVisibility',
    listener: (state: { visible: boolean }) => void,
  ): Promise<PluginListenerHandle>;
  /**
   * The keyboard's own action key (Next / Done / its Enter, or the remote's
   * Play mapped onto it), pressed while typing. The native side already
   * filters out the action Amazon's keyboard fires as it dismisses on Back,
   * so this is always a real press. The page moves to the next field on it.
   */
  addListener(
    event: 'editorAction',
    listener: (state: { action: 'next' }) => void,
  ): Promise<PluginListenerHandle>;
}

export const SnowKeyboard = registerPlugin<SnowKeyboardPlugin>('SnowKeyboard');
