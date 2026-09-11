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
}

export const SnowKeyboard = registerPlugin<SnowKeyboardPlugin>('SnowKeyboard');
