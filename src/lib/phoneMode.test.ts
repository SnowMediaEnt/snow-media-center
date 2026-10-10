import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setPhoneModeForTests, fingerIsDriving, isPhoneUI, isTvUserAgent, phoneLayoutNow, phoneModeFrom, UPRIGHT_TABLET_MAX_WIDTH } from './phoneMode';
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

// Upright (Tronix 4369a23, ab2b621): a phone held upright, or a narrow tablet
// held upright, gets the upright phone layout (html.is-upright); sideways
// both keep the TV layout, which the app scales to fit.
describe('the upright layout', () => {
  afterEach(() => __setPhoneModeForTests({ touch: false, phone: false }));

  it('a phone: upright and sideways follow the orientation', () => {
    const cl = document.documentElement.classList;
    __setPhoneModeForTests({ touch: true, phone: true, portrait: true });
    expect(phoneLayoutNow()).toBe('portrait');
    expect(cl.contains('is-upright')).toBe(true);
    __setPhoneModeForTests({ touch: true, phone: true, portrait: false });
    expect(phoneLayoutNow()).toBe('landscape');
    expect(cl.contains('is-upright')).toBe(false);
    expect(cl.contains('is-phone')).toBe(true);
    __setPhoneModeForTests({ touch: false, phone: false, portrait: true });
    expect(phoneLayoutNow()).toBeNull();
    expect(cl.contains('is-upright')).toBe(false);
  });

  it('a narrow tablet held upright is laid out as a phone held upright; a wider one, or sideways, is not', () => {
    const real = window.screen;
    const screenOf = (width: number, height: number) => Object.defineProperty(window, 'screen', { configurable: true, value: { width, height } });
    const cl = document.documentElement.classList;
    try {
      for (const [w, h] of [[600, 1024], [800, 1280]]) {
        screenOf(w, h);
        __setPhoneModeForTests({ touch: true, phone: false, portrait: true });
        expect(phoneLayoutNow()).toBe('portrait');
        expect(cl.contains('is-upright')).toBe(true);
        expect(cl.contains('is-phone')).toBe(false); // still a tablet
        expect(isPhoneUI()).toBe(false);
        __setPhoneModeForTests({ touch: true, phone: false, portrait: false });
        expect(phoneLayoutNow()).toBeNull();
        expect(cl.contains('is-upright')).toBe(false);
      }
      screenOf(UPRIGHT_TABLET_MAX_WIDTH, 1180);
      __setPhoneModeForTests({ touch: true, phone: false, portrait: true });
      expect(phoneLayoutNow()).toBeNull();
    } finally {
      Object.defineProperty(window, 'screen', { configurable: true, value: real });
    }
  });
});

describe('startPhoneMode', () => {
  const PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36';
  const BOX = 'Mozilla/5.0 (Linux; Android 9; X96Max_Plus Build/PPR1) AppleWebKit/537.36 Chrome/66.0 Safari/537.36';
  const TABLET = 'Mozilla/5.0 (Linux; Android 11; KFTRWI) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
  const realScreen = window.screen;
  const realUa = window.navigator.userAgent;
  const booted: Array<typeof import('./phoneMode')> = [];
  const setScreen = (width: number, height: number, type: string) =>
    Object.defineProperty(window, 'screen', { configurable: true, value: { width, height, orientation: { type } } });
  const boot = async (o: { coarse: boolean; ua: string; screen: [number, number]; orientation: string }) => {
    vi.resetModules();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: q === '(pointer: coarse)' ? o.coarse : false }) });
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: o.ua });
    setScreen(o.screen[0], o.screen[1], o.orientation);
    const mod = await import('./phoneMode');
    booted.push(mod);
    mod.startPhoneMode();
    return mod;
  };
  afterEach(() => {
    for (const m of booted.splice(0)) m.__stopPhoneModeForTests();
    document.documentElement.className = '';
    Object.defineProperty(window, 'screen', { configurable: true, value: realScreen });
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: realUa });
  });

  it('a phone held upright: the upright layout from the first frame; turned, it follows', async () => {
    const mod = await boot({ coarse: true, ua: PHONE, screen: [412, 915], orientation: 'portrait-primary' });
    const { result } = renderHook(() => mod.usePhoneLayout());
    expect(result.current).toBe('portrait');
    expect(document.documentElement.classList.contains('is-upright')).toBe(true);
    setScreen(915, 412, 'landscape-primary');
    window.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => expect(result.current).toBe('landscape'));
    expect(document.documentElement.classList.contains('is-upright')).toBe(false);
    expect(document.documentElement.classList.contains('is-phone')).toBe(true);
  });

  it('a tablet held upright: touch at once (a TV box is never upright)', async () => {
    const mod = await boot({ coarse: true, ua: TABLET, screen: [800, 1280], orientation: 'portrait-primary' });
    expect(mod.isTouchUI()).toBe(true);
    expect(mod.phoneLayoutNow()).toBe('portrait');
  });

  it('a tablet sideways waits for a finger; turned upright first, it is touch and upright', async () => {
    const mod = await boot({ coarse: true, ua: TABLET, screen: [1280, 800], orientation: 'landscape-primary' });
    expect(mod.isTouchUI()).toBe(false);
    setScreen(800, 1280, 'portrait-primary');
    window.dispatchEvent(new Event('resize'));
    await vi.waitFor(() => expect(mod.phoneLayoutNow()).toBe('portrait'));
    expect(mod.isTouchUI()).toBe(true);
  });

  it('a TV box whose firmware reports a touch input: a remote key first and it is never switched', async () => {
    const mod = await boot({ coarse: true, ua: BOX, screen: [960, 540], orientation: 'landscape-primary' });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 20 }));
    window.dispatchEvent(new Event('touchstart'));
    expect(mod.isTouchUI()).toBe(false);
    expect(document.documentElement.className).not.toMatch(/is-(touch|phone|upright)/);
  });
});
