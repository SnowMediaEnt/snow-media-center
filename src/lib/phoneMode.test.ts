import { afterEach, describe, expect, it } from 'vitest';
import { __setPhoneModeForTests, fingerIsDriving, isTvUserAgent, phoneModeFrom } from './phoneMode';
import { keepInView } from '@/utils/keepInView';

const FIRE_TV = 'Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7633) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/66.0 Mobile Safari/537.36';
const PIXEL = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

afterEach(() => __setPhoneModeForTests({ touch: false, phone: false }));

describe('phone mode', () => {
  it('never turns a TV into a touch screen, even one that reports a finger', () => {
    expect(isTvUserAgent(FIRE_TV)).toBe(true);
    expect(phoneModeFrom({ tv: true, mobile: true, coarse: true, shortSide: 360 })).toEqual({ touch: false, phone: false });
  });

  it('a remote-driven box (no coarse pointer) is not touch', () => {
    expect(phoneModeFrom({ tv: false, mobile: false, coarse: false, shortSide: 540 })).toEqual({ touch: false, phone: false });
  });

  it('a phone is touch and phone-sized; a tablet is touch only', () => {
    expect(isTvUserAgent(PIXEL)).toBe(false);
    expect(phoneModeFrom({ tv: false, mobile: true, coarse: true, shortSide: 412 })).toEqual({ touch: true, phone: true });
    expect(phoneModeFrom({ tv: false, mobile: false, coarse: true, shortSide: 800 })).toEqual({ touch: true, phone: false });
  });

  it('sets the <html> classes', () => {
    __setPhoneModeForTests({ touch: true, phone: true });
    expect(document.documentElement.classList.contains('is-touch')).toBe(true);
    expect(document.documentElement.classList.contains('is-phone')).toBe(true);
    __setPhoneModeForTests({ touch: false, phone: false });
    expect(document.documentElement.className).not.toMatch(/is-(touch|phone)/);
  });

  it('a finger scrolling a list is never pulled back to the highlight; a TV still follows it', () => {
    const box = document.createElement('div');
    const row = document.createElement('div');
    box.appendChild(row);
    box.getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100 }) as DOMRect;
    row.getBoundingClientRect = () => ({ top: 150, bottom: 180, height: 30 }) as DOMRect;

    __setPhoneModeForTests({ touch: true, phone: true, finger: true });
    expect(fingerIsDriving()).toBe(true);
    box.scrollTop = 0;
    keepInView(box, row);
    expect(box.scrollTop).toBe(0);

    __setPhoneModeForTests({ touch: false, phone: false, finger: true });
    expect(fingerIsDriving()).toBe(false);
    keepInView(box, row);
    expect(box.scrollTop).toBeGreaterThan(0);
  });
});
