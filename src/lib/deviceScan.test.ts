// Support › Device check's scan: Device Health's vitals + the scan plugin made
// one scan (figures checked, nothing guessed), an older build's vitals-only
// view, the browser's view, and the speed test's kept result.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ native: false, getDeviceScan: vi.fn(), readVitals: vi.fn() }));
vi.mock('@/utils/platform', () => ({ isNativePlatform: () => h.native }));
vi.mock('@/capacitor/AppManager', () => ({ AppManager: { getDeviceScan: h.getDeviceScan } }));
vi.mock('@/lib/deviceHealth', () => ({ readVitals: h.readVitals }));

import {
  SPEED_KEY, SPEED_MAX_AGE_MS, bandOf, keepSpeed, lastSpeed, scanDevice, scanFromNative, webviewMajor, type ScanBase,
} from './deviceScan';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const BASE: ScanBase = { model: 'AFTKA', osVersion: '11', webview: 112, formFactor: 'tv' };
const VITALS = {
  model: 'Amazon AFTKA', sdk: 30, cpuCores: 4, memAvailMb: 600, memTotalMb: 1900, lowMemory: false, lowRamDevice: false,
  storageFreeMb: 3000, wifiRssi: -58, wifiLinkMbps: 433, wifiFreqMhz: 5180, wired: false, online: true,
};

beforeEach(() => {
  sessionStorage.clear();
  h.native = false;
  h.getDeviceScan.mockReset();
  h.readVitals.mockReset();
  h.readVitals.mockResolvedValue(null);
});
afterEach(() => { vi.useRealTimers(); });

describe('device scan', () => {
  it('the vitals and the plugin, checked: sizes, the largest screen mode, decoders, Wi-Fi', () => {
    const s = scanFromNative(VITALS, {
      storage: { totalBytes: 8 * GB },
      cpu: { cores: 4, abis: ['arm64-v8a'], is64bit: true },
      display: { widthPx: 1920, heightPx: 1080, refreshHz: 60, maxWidthPx: 3840, maxHeightPx: 2160, hdr: ['hdr10', 'nonsense'] },
      codecs: { avc: { decoder: true, hardware: true, uhd: true, tenBit: false }, hevc: { decoder: true, hardware: true, uhd: true, tenBit: true } },
      network: { type: 'wifi', validated: true, downKbps: 50000 },
      wifi: { rxLinkMbps: 390, standard: 6 },
    }, BASE, null, 1);
    expect(s).toMatchObject({
      source: 'native', formFactor: 'tv', model: 'Amazon AFTKA', osVersion: '11', apiLevel: 30, webview: 112,
      ramTotal: 1900 * MB, ramFree: 600 * MB, storageFree: 3000 * MB, storageTotal: 8 * GB, cores: 4, is64bit: true,
      screen: { width: 3840, height: 2160, refreshHz: 60, hdr: ['hdr10'] },
      network: { type: 'wifi', downKbps: 50000, vpn: false },
      wifi: { band: '5', linkMbps: 390, rssi: -58, standard: 6 },
    });
    // A type the plugin did not answer: unknown, not "no".
    expect(s.codecs.av1).toEqual({ decoder: null, hardware: null, uhd: null, tenBit: null });
  });

  it('nonsense figures are dropped; a phone held upright still reads landscape; a VPN is "other"', () => {
    const s = scanFromNative({ memTotalMb: -5, memAvailMb: Number.NaN, wifiFreqMhz: 9000, wifiRssi: 0, wifiLinkMbps: -1 }, {
      display: { widthPx: 1080, heightPx: 2400 },
      network: { type: 'vpn' },
    }, { ...BASE, formFactor: 'phone' }, null, 1);
    expect(s.ramTotal).toBeNull();
    expect(s.ramFree).toBeNull();
    expect(s.screen).toMatchObject({ width: 2400, height: 1080 });
    expect(s.network).toEqual({ type: 'other', downKbps: null, vpn: true });
    expect(s.wifi).toBeNull();
  });

  it('with no type from the plugin, the vitals say wired, Wi-Fi or offline', () => {
    expect(scanFromNative({ wired: true, online: true }, {}, BASE, null).network.type).toBe('ethernet');
    expect(scanFromNative({ wifiFreqMhz: 2437, wifiRssi: -70 }, {}, BASE, null)).toMatchObject({ network: { type: 'wifi' }, wifi: { band: '2.4', rssi: -70 } });
    expect(scanFromNative({ online: false }, {}, BASE, null).network.type).toBe('none');
  });

  it('asks the plugin and the vitals; an older build (no plugin) keeps the vitals; the web never throws', async () => {
    h.native = true;
    h.readVitals.mockResolvedValue(VITALS);
    h.getDeviceScan.mockResolvedValue({ cpu: { cores: 8, abis: [], is64bit: true } });
    const a = await scanDevice();
    expect(a.source).toBe('native');
    expect(a.cores).toBe(8);
    expect(a.ramTotal).toBe(1900 * MB);
    h.getDeviceScan.mockRejectedValue(new Error('not implemented'));
    const b = await scanDevice();
    expect(b.source).toBe('web');
    expect(b.ramTotal).toBe(1900 * MB);
    expect(b.apiLevel).toBe(30);
    h.native = false;
    h.readVitals.mockResolvedValue({ online: true });
    const c = await scanDevice();
    expect(c.source).toBe('web');
    expect(c.storageFree).toBeNull();
    expect(h.getDeviceScan).toHaveBeenCalledTimes(2);
  });

  it('bands and the web engine', () => {
    expect(bandOf(2412)).toBe('2.4');
    expect(bandOf(5825)).toBe('5');
    expect(bandOf(5955)).toBe('6');
    expect(bandOf(0)).toBeNull();
    expect(bandOf(undefined)).toBeNull();
    expect(webviewMajor('Mozilla/5.0 (Linux; Android 9; AFTMM) AppleWebKit/537.36 Chrome/66.0.3359.158 Mobile Safari/537.36')).toBe(66);
    expect(webviewMajor('Safari')).toBeNull();
  });

  it('keeps the speed test for 30 minutes of this run', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(lastSpeed()).toBeNull();
    expect(keepSpeed({ downMbps: 42.5, upMbps: 9, pingMs: 25, jitterMs: 3 })).toEqual({ downMbps: 42.5, upMbps: 9, pingMs: 25, jitterMs: 3, at: 1_000_000 });
    expect(lastSpeed()?.downMbps).toBe(42.5);
    vi.setSystemTime(1_000_000 + SPEED_MAX_AGE_MS + 1);
    expect(lastSpeed()).toBeNull();
    expect(keepSpeed({ downMbps: Number.NaN, upMbps: 1, pingMs: null, jitterMs: null })).toBeNull();
    sessionStorage.setItem(SPEED_KEY, '{bad');
    expect(lastSpeed()).toBeNull();
  });
});
