import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

const h = vi.hoisted(() => ({ set: vi.fn(async () => undefined), native: true, flag: false }));
vi.mock('@capacitor/preferences', () => ({ Preferences: { set: h.set } }));
vi.mock('@/utils/platform', () => ({ isNativePlatform: () => h.native }));
vi.mock('@/lib/playerFlags', () => ({ KEYBOARD_VOICE_FLAG: 'keyboard_voice_attrs', playerFlag: () => h.flag }));

import { KEYBOARD_VOICE_PREF, mirrorKeyboardVoiceFlag } from './keyboardVoice';

const ROOT = path.resolve(__dirname, '../..');

describe('keyboard voice switch', () => {
  beforeEach(() => { h.set.mockClear(); h.native = true; h.flag = false; });

  it('mirrors the remote switch to the native WebView, off by default, native only', async () => {
    await mirrorKeyboardVoiceFlag();
    expect(h.set).toHaveBeenLastCalledWith({ key: KEYBOARD_VOICE_PREF, value: '0' });
    h.flag = true;
    await mirrorKeyboardVoiceFlag();
    expect(h.set).toHaveBeenLastCalledWith({ key: KEYBOARD_VOICE_PREF, value: '1' });
    h.native = false; h.set.mockClear();
    await mirrorKeyboardVoiceFlag();
    expect(h.set).not.toHaveBeenCalled();
  });

  it('the native side reads the same key, touches plain text only, and logs numbers only', () => {
    const kt = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/com/snowmedia/keyboard/SnowWebView.kt'), 'utf8');
    expect(kt).toContain('getSharedPreferences("CapacitorStorage"');
    expect(kt).toContain(`getString("${KEYBOARD_VOICE_PREF}", null) == "1"`);
    expect(kt).toContain('if (on && isPlainText(before))');
    expect(kt).not.toMatch(/VARIATION_(WEB_)?PASSWORD|VARIATION_(WEB_)?EMAIL|VARIATION_URI/);
    const layout = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/layout/capacitor_bridge_layout_main.xml'), 'utf8');
    expect(layout).toContain('<com.snowmedia.keyboard.SnowWebView');
    expect(layout).toContain('android:id="@+id/webview"');
  });

  it('the flag defaults OFF (a missing row changes nothing)', async () => {
    const real = await vi.importActual<typeof import('@/lib/playerFlags')>('@/lib/playerFlags');
    expect(real.PLAYER_FLAG_DEFAULTS[real.KEYBOARD_VOICE_FLAG]).toBe(false);
  });
});
