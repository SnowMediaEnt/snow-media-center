import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

interface SnowKeyboardPlugin {
  show(): Promise<void>;
  hide(): Promise<void>;
  /** What Android last reported, for a web layer that has lost track. */
  isVisible(): Promise<{ visible: boolean }>;
  /**
   * Fires on every genuine change in keyboard visibility, including the ones
   * the page did not ask for — Back closing a docked keyboard is handled
   * inside Android and is never seen by JavaScript any other way.
   */
  addListener(
    event: 'keyboardVisibility',
    listener: (state: { visible: boolean }) => void,
  ): Promise<PluginListenerHandle>;
}

export const SnowKeyboard = registerPlugin<SnowKeyboardPlugin>('SnowKeyboard');
