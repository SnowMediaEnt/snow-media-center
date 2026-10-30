// Support › Device check's rating (ported from Tronix): specs and thresholds only, calm levels, the
// areas and the categories worth a look.
import { describe, expect, it } from 'vitest';
import { THRESHOLDS, needsReason, rateScan, sizeText, worst, type Finding } from './deviceScanRating';
import type { CodecSupport, DeviceScan } from './deviceScan';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const hw: CodecSupport = { decoder: true, hardware: true, uhd: true, tenBit: true };
const hdOnly: CodecSupport = { decoder: true, hardware: true, uhd: false, tenBit: false };
const none: CodecSupport = { decoder: false, hardware: false, uhd: false, tenBit: false };

/** A strong box on a 4K HDR TV, wired, fast: every line green. */
const good = (over: Partial<DeviceScan> = {}): DeviceScan => ({
  at: 0,
  source: 'native',
  formFactor: 'tv',
  model: 'Streamer One',
  osVersion: '11',
  apiLevel: 30,
  webview: 120,
  ramTotal: 3.8 * GB,
  ramFree: 1.6 * GB,
  ramLow: false,
  lowRamDevice: false,
  storageFree: 6 * GB,
  storageTotal: 16 * GB,
  cores: 4,
  is64bit: true,
  screen: { width: 3840, height: 2160, refreshHz: 60, hdr: ['hdr10'] },
  codecs: { avc: hw, hevc: hw, vp9: hw, av1: hw },
  network: { type: 'ethernet', downKbps: null, vpn: false },
  wifi: null,
  speed: { downMbps: 180, upMbps: 20, pingMs: 18, jitterMs: 2, at: 0 },
  ...over,
});

const find = (findings: Finding[], key: string) => findings.find((f) => f.key === key);

describe('device check rating', () => {
  it('a strong wired box on a 4K TV: green everywhere, nothing worth a look', () => {
    const r = rateScan(good());
    expect(r.overall).toBe('green');
    expect(r.areas).toEqual({ device: 'green', connection: 'green', screen: 'green' });
    expect(r.highlight).toEqual([]);
    expect(r.findings.filter(needsReason)).toEqual([]);
    expect(find(r.findings, 'netEthernet')?.level).toBe('green');
    expect(find(r.findings, 'hevcHw')?.level).toBe('green');
    expect(find(r.findings, 'extras')?.params).toEqual({ list: 'VP9, AV1' });
  });

  it('memory: 3 GB green, 2 GB yellow, 1.5 GB orange, 1 GB red (Android reports under the label)', () => {
    const lvl = (b: number) => find(rateScan(good({ ramTotal: b })).findings, 'ram')?.level;
    expect(lvl(2.8 * GB)).toBe('green');
    expect(lvl(THRESHOLDS.ramTotal.green)).toBe('green');
    expect(lvl(1.85 * GB)).toBe('yellow');
    expect(lvl(1.4 * GB)).toBe('orange');
    expect(lvl(0.9 * GB)).toBe('red');
    // Android's own low-memory device flag: at least orange.
    expect(find(rateScan(good({ ramTotal: 2.8 * GB, lowRamDevice: true })).findings, 'ram')?.level).toBe('orange');
    // The web's rounded, capped figure is never worse than yellow.
    expect(find(rateScan(good({ source: 'web', ramTotal: 1 * GB })).findings, 'ram')?.level).toBe('yellow');
  });

  it('free memory now: Android saying low, or little free, is orange (a passing state: never red on its own)', () => {
    expect(find(rateScan(good({ ramLow: true, ramFree: 90 * MB })).findings, 'ramFree')?.level).toBe('orange');
    expect(rateScan(good({ ramLow: true, ramFree: 90 * MB })).overall).not.toBe('red');
    expect(find(rateScan(good({ ramFree: 200 * MB })).findings, 'ramFree')?.level).toBe('orange');
    expect(find(rateScan(good({ ramFree: 300 * MB })).findings, 'ramFree')?.level).toBe('yellow');
    expect(find(rateScan(good({ ramFree: 800 * MB })).findings, 'ramFree')?.level).toBe('green');
  });

  it('decoders: software H.264 is red, no hardware H.265 orange, 4K only matters on a 4K TV', () => {
    const r = rateScan(good({ codecs: { avc: { ...hw, hardware: false }, hevc: none, vp9: none, av1: none } }));
    expect(find(r.findings, 'avcSw')?.level).toBe('red');
    expect(find(r.findings, 'hevcNone')?.level).toBe('orange');
    expect(find(r.findings, 'uhdNo')?.level).toBe('orange');
    expect(find(r.findings, 'extrasNone')?.level).toBeNull();
    expect(r.areas.device).toBe('red');
    expect(r.overall).toBe('red');
    expect(r.highlight).toContain('device');
    // A Full HD TV: no 4K decode is shown but not rated.
    const fhd = rateScan(good({ screen: { width: 1920, height: 1080, refreshHz: 60, hdr: [] }, codecs: { avc: hw, hevc: hdOnly, vp9: hdOnly, av1: hdOnly } }));
    expect(find(fhd.findings, 'uhdNo')?.level).toBeNull();
    expect(fhd.areas.device).toBe('green');
  });

  it('an HDR TV with no 10-bit decode: yellow, fine', () => {
    const r = rateScan(good({ codecs: { avc: hw, hevc: { ...hw, tenBit: false }, vp9: { ...hw, tenBit: false }, av1: { ...hw, tenBit: false } } }));
    expect(find(r.findings, 'hdrDecodeNo')?.level).toBe('yellow');
    expect(r.overall).toBe('yellow');
  });

  it('Android and web engine age, storage', () => {
    const lv = (o: Partial<DeviceScan>, key: string) => find(rateScan(good(o)).findings, key)?.level;
    expect(lv({ apiLevel: 28 }, 'android')).toBe('green');
    expect(lv({ apiLevel: 25 }, 'android')).toBe('yellow');
    expect(lv({ apiLevel: 24 }, 'android')).toBe('orange');
    expect(lv({ webview: 100 }, 'webview')).toBe('green');
    expect(lv({ webview: 91 }, 'webview')).toBe('yellow');
    expect(lv({ webview: 70 }, 'webview')).toBe('orange');
    expect(lv({ webview: 60 }, 'webview')).toBe('red');
    expect(lv({ storageFree: 1.5 * GB }, 'storage')).toBe('yellow');
    expect(lv({ storageFree: 500 * MB }, 'storage')).toBe('orange');
    expect(lv({ storageFree: 100 * MB }, 'storage')).toBe('red');
    expect(lv({ cores: 2 }, 'cpu')).toBe('orange');
    expect(lv({ is64bit: false }, 'cpu32')).toBe('yellow');
  });

  it('Wi-Fi: 2.4 GHz is orange; signal and link by their thresholds; router and other worth a look', () => {
    const r = rateScan(good({
      network: { type: 'wifi', downKbps: null, vpn: false },
      wifi: { band: '2.4', linkMbps: 65, rssi: -72, standard: 4 },
    }));
    expect(find(r.findings, 'netWifi')?.level).toBeNull();
    expect(find(r.findings, 'band')?.level).toBe('orange');
    expect(find(r.findings, 'signal')?.level).toBe('orange');
    expect(find(r.findings, 'link')?.level).toBe('orange');
    expect(r.areas.connection).toBe('orange');
    expect(r.highlight).toEqual(['router', 'other']);
    const strong = rateScan(good({ network: { type: 'wifi', downKbps: null, vpn: false }, wifi: { band: '5', linkMbps: 433, rssi: -52, standard: 5 } }));
    expect(strong.areas.connection).toBe('green');
    expect(find(rateScan(good({ network: { type: 'wifi', downKbps: null, vpn: false }, wifi: { band: '5', linkMbps: 20, rssi: -80, standard: null } })).findings, 'signal')?.level).toBe('red');
  });

  it('speed: 50+ green, 25+ yellow, 10+ orange, less red; not tested is shown, not rated', () => {
    const lv = (down: number) => find(rateScan(good({ speed: { downMbps: down, upMbps: 5, pingMs: 30, jitterMs: 3, at: 0 } })).findings, 'speed')?.level;
    expect(lv(50)).toBe('green');
    expect(lv(30)).toBe('yellow');
    expect(lv(12)).toBe('orange');
    expect(lv(6)).toBe('red');
    const r = rateScan(good({ speed: null }));
    expect(find(r.findings, 'speedNone')?.level).toBeNull();
    expect(r.areas.connection).toBe('green');
    expect(find(rateScan(good({ speed: { downMbps: 80, upMbps: 10, pingMs: 250, jitterMs: 3, at: 0 } })).findings, 'ping')?.level).toBe('orange');
  });

  it('no connection is red; mobile data is yellow', () => {
    expect(rateScan(good({ network: { type: 'none', downKbps: null, vpn: false }, speed: null })).areas.connection).toBe('red');
    expect(rateScan(good({ network: { type: 'cellular', downKbps: null, vpn: false } })).areas.connection).toBe('yellow');
  });

  it('the screen: a TV is rated (4K green, Full HD yellow, less orange); a phone screen is not; the screen never sets the overall', () => {
    const hd = rateScan(good({ screen: { width: 1280, height: 720, refreshHz: 60, hdr: [] } }));
    expect(find(hd.findings, 'screen')?.level).toBe('orange');
    expect(hd.areas.screen).toBe('orange');
    expect(hd.overall).toBe('green');
    expect(hd.highlight).toEqual(['tv']);
    const phone = rateScan(good({ formFactor: 'phone', screen: { width: 2400, height: 1080, refreshHz: 120, hdr: [] } }));
    expect(find(phone.findings, 'screenDevice')?.level).toBeNull();
    expect(phone.areas.screen).toBeNull();
    expect(find(phone.findings, 'hdrNo')).toBeUndefined();
  });

  it('what is not known is not rated (the web with nothing to tell)', () => {
    const unknown: CodecSupport = { decoder: null, hardware: null, uhd: null, tenBit: null };
    const r = rateScan(good({
      source: 'web', apiLevel: null, osVersion: null, webview: null, ramTotal: null, ramFree: null, ramLow: null,
      lowRamDevice: null, storageFree: null, storageTotal: null, cores: null, is64bit: null, screen: null,
      codecs: { avc: unknown, hevc: unknown, vp9: unknown, av1: unknown },
      network: { type: 'unknown', downKbps: null, vpn: false }, speed: null,
    }));
    expect(r.overall).toBeNull();
    expect(r.areas).toEqual({ device: null, connection: null, screen: null });
    expect(r.findings.map((f) => f.key)).toEqual(['speedNone']);
  });

  it('worst, sizes', () => {
    expect(worst(['green', null, 'orange', 'yellow'])).toBe('orange');
    expect(worst([null, undefined])).toBeNull();
    expect(sizeText(1.9 * GB)).toBe('1.9 GB');
    expect(sizeText(740 * MB)).toBe('740 MB');
    expect(sizeText(32 * GB)).toBe('32 GB');
  });
});
