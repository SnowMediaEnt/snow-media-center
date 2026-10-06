import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { typingInField } from './typingInField';

afterEach(() => { document.body.innerHTML = ''; });

describe('typingInField: the remote Search/voice key is the keyboard\'s while typing', () => {
  it('is true for a focused text field or textarea, false for buttons, read-only fields and nothing', () => {
    document.body.innerHTML = '<input id="a"><textarea id="b"></textarea><button id="c">x</button><input id="d" readonly><input id="e" type="checkbox">';
    expect(typingInField()).toBe(false);
    for (const [id, want] of [['a', true], ['b', true], ['c', false], ['d', false], ['e', false]] as const) {
      (document.getElementById(id) as HTMLElement).focus();
      expect(typingInField(), id).toBe(want);
    }
  });

  it('MainActivity hands Search to the system while a field has the keyboard; both voice hosts leave it alone', () => {
    const root = path.resolve(__dirname, '../../..');
    const main = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/snowmedia/MainActivity.kt'), 'utf8');
    expect(main).toContain('KeyEvent.KEYCODE_SEARCH -> if (typingInField()) null else "search"');
    expect(main).toMatch(/isAcceptingText == true/);
    for (const f of ['VoiceCommandHost.tsx', 'LazyVoiceCommandHost.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      expect(src.match(/typingInField\(\)/g)?.length, f).toBeGreaterThanOrEqual(2);
    }
  });
});
