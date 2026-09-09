import { registerPlugin } from '@capacitor/core';

interface SnowKeyboardPlugin {
  show(): Promise<void>;
}

export const SnowKeyboard = registerPlugin<SnowKeyboardPlugin>('SnowKeyboard');