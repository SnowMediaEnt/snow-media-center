// Support › Device check, the quick scan (ported from Tronix lib/deviceCheckScan,
// owner 2026-10-29: "can we add the device check to SMC like we just added to
// Tronix"). A few seconds, no keyboard, nothing personal: what this device has
// and how it is connected, rated by lib/deviceScanRating.
//
// Not to be mixed up with lib/deviceCheck.ts: that is Device Health's 30 s /
// 1-minute STREAM check (play and measure). This one plays nothing.
//
// Android: Device Health's vitals (lib/deviceHealth readVitals: model, sdk,
// cores, memory, free storage, Wi-Fi signal / link / frequency, wired) plus
// AppManager.getDeviceScan (android/.../health/DeviceScan.kt: the screen's
// modes and HDR, the video decoders, ABIs, storage total, connection type,
// Wi-Fi standard). The web, or an Android build from before this one: what the
// browser tells (navigator.deviceMemory / hardwareConcurrency, the screen,
// MediaSource / MediaCapabilities, navigator.connection). Anything not known
// stays null and is simply not rated.
//
// The internet speed is the Speed test's own run (components/SpeedTest's
// onResult, from this screen or Support's Speedtest card), kept for this app
// run (session storage, 30 minutes).
import { AppManager, type NativeCodec, type NativeDeviceScan } from '@/capacitor/AppManager';
import type { DeviceVitals } from '@/capacitor/DeviceHealth';
import { readVitals } from '@/lib/deviceHealth';
import { parseDeviceInfo, parseFormFactor } from '@/lib/appInfo';
import { isNativePlatform } from '@/utils/platform';

export type NetType = 'ethernet' | 'wifi' | 'cellular' | 'other' | 'none' | 'unknown';
export type CodecName = 'avc' | 'hevc' | 'vp9' | 'av1';
export const CODEC_NAMES: readonly CodecName[] = ['avc', 'hevc', 'vp9', 'av1'];

/** One video type: null = not known (the web can't always tell). */
export interface CodecSupport {
  decoder: boolean | null;
  hardware: boolean | null;
  uhd: boolean | null;
  tenBit: boolean | null;
}

export interface SpeedResult {
  downMbps: number;
  upMbps: number;
  pingMs: number | null;
  jitterMs: number | null;
  at: number;
}

export interface DeviceScan {
  at: number;
  /** 'native': the Android plugin answered; 'web': the browser's view only. */
  source: 'native' | 'web';
  formFactor: 'tv' | 'phone' | 'tablet' | null;
  model: string | null;
  osVersion: string | null;
  apiLevel: number | null;
  webview: number | null;
  ramTotal: number | null;
  ramFree: number | null;
  ramLow: boolean | null;
  lowRamDevice: boolean | null;
  storageFree: number | null;
  storageTotal: number | null;
  cores: number | null;
  is64bit: boolean | null;
  /** The largest mode the screen takes (a box: what the TV accepts). */
  screen: { width: number; height: number; refreshHz: number | null; hdr: string[] } | null;
  codecs: Record<CodecName, CodecSupport>;
  network: { type: NetType; downKbps: number | null; vpn: boolean };
  wifi: { band: '2.4' | '5' | '6' | null; linkMbps: number | null; rssi: number | null; standard: number | null } | null;
  speed: SpeedResult | null;
}

/** What the scan knows of the device before the plugins: model, versions, form. */
export interface ScanBase {
  model: string | null;
  osVersion: string | null;
  webview: number | null;
  formFactor: DeviceScan['formFactor'];
}

const UNKNOWN_CODEC: CodecSupport = { decoder: null, hardware: null, uhd: null, tenBit: null };

const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const GB = 1024 ** 3;
const MB = 1024 ** 2;

const codecOf = (c: NativeCodec | undefined): CodecSupport => (c
  ? { decoder: bool(c.decoder), hardware: bool(c.hardware), uhd: bool(c.uhd), tenBit: bool(c.tenBit) }
  : { ...UNKNOWN_CODEC });

const netTypeOf = (v: unknown): NetType =>
  v === 'ethernet' || v === 'wifi' || v === 'cellular' || v === 'none' ? v : v === 'vpn' || v === 'other' ? 'other' : 'unknown';

/** 2.4, 5 or 6 GHz from a Wi-Fi frequency in MHz; null when unknown. */
export function bandOf(mhz: unknown): '2.4' | '5' | '6' | null {
  const f = num(mhz, 1, 100000);
  if (f === null) return null;
  if (f >= 2400 && f <= 2500) return '2.4';
  if (f >= 4900 && f <= 5899) return '5';
  if (f >= 5925 && f <= 7125) return '6';
  return null;
}

const HDR_NAMES = new Set(['hdr10', 'hdr10plus', 'hlg', 'dolbyVision', 'hdr']);

/** The web engine's major version from the WebView's user agent ("Chrome/66.0…"). */
export function webviewMajor(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''): number | null {
  const m = /Chrome\/(\d+)\./.exec(ua);
  return m ? num(Number(m[1]), 1, 1000) : null;
}

/** Model, Android version, web engine and form factor from the user agent (lib/appInfo). */
export function scanBase(): ScanBase {
  let model: string | null = null;
  let osVersion: string | null = null;
  try { ({ model, android: osVersion } = parseDeviceInfo()); } catch { /* unknown */ }
  let formFactor: ScanBase['formFactor'] = null;
  try { formFactor = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '') ? parseFormFactor() : null; } catch { formFactor = null; }
  return { model, osVersion, webview: webviewMajor(), formFactor };
}

/**
 * Device Health's vitals + the scan plugin's answer, made one scan (exported
 * for tests). Either may be empty: an older build has the vitals only.
 */
export function scanFromNative(v: DeviceVitals | null, n: NativeDeviceScan | null, base: ScanBase, speed: SpeedResult | null, at = Date.now()): DeviceScan {
  const d = n?.display;
  const w = num(d?.maxWidthPx, 1, 20000) ?? num(d?.widthPx, 1, 20000);
  const h = num(d?.maxHeightPx, 1, 20000) ?? num(d?.heightPx, 1, 20000);
  const memTotal = num(v?.memTotalMb, 1, 1024 * 1024);
  const memAvail = num(v?.memAvailMb, 0, 1024 * 1024);
  const storeFree = num(v?.storageFreeMb, 0, 1e9);
  // The connection: the plugin's type; else what the vitals tell.
  let type: NetType = n?.network ? netTypeOf(n.network.type) : 'unknown';
  if (type === 'unknown' && v) {
    if (v.wired) type = 'ethernet';
    else if (num(v.wifiFreqMhz, 1, 100000) !== null || num(v.wifiRssi, -126, -1) !== null) type = 'wifi';
    else if (v.online === false) type = 'none';
  }
  const onWifi = type === 'wifi' || (type === 'unknown' && v?.wifiFreqMhz != null);
  const sdk = num(v?.sdk, 1, 100);
  return {
    at,
    source: 'native',
    formFactor: base.formFactor,
    model: (typeof v?.model === 'string' && v.model.trim() ? v.model.trim().slice(0, 80) : null) ?? base.model,
    osVersion: base.osVersion,
    apiLevel: sdk,
    webview: base.webview,
    ramTotal: memTotal === null ? null : memTotal * MB,
    ramFree: memAvail === null ? null : memAvail * MB,
    ramLow: bool(v?.lowMemory),
    lowRamDevice: bool(v?.lowRamDevice),
    storageFree: storeFree === null ? null : storeFree * MB,
    storageTotal: num(n?.storage?.totalBytes, 1, 1e15),
    cores: num(n?.cpu?.cores, 1, 256) ?? num(v?.cpuCores, 1, 256),
    is64bit: bool(n?.cpu?.is64bit),
    screen: w && h ? {
      // Landscape figures, whichever way a phone is held.
      width: Math.max(w, h),
      height: Math.min(w, h),
      refreshHz: num(d?.refreshHz, 1, 1000),
      hdr: Array.isArray(d?.hdr) ? d!.hdr.filter((x) => HDR_NAMES.has(x)) : [],
    } : null,
    codecs: {
      avc: codecOf(n?.codecs?.avc),
      hevc: codecOf(n?.codecs?.hevc),
      vp9: codecOf(n?.codecs?.vp9),
      av1: codecOf(n?.codecs?.av1),
    },
    network: {
      type,
      downKbps: num(n?.network?.downKbps, 1, 1e8),
      vpn: n?.network?.vpn === true || n?.network?.type === 'vpn',
    },
    wifi: onWifi ? {
      band: bandOf(v?.wifiFreqMhz),
      linkMbps: num(n?.wifi?.rxLinkMbps, 1, 100000) ?? num(v?.wifiLinkMbps, 1, 100000),
      rssi: num(v?.wifiRssi, -126, -1),
      standard: num(n?.wifi?.standard, 1, 20),
    } : null,
    speed,
  };
}

// ── the browser's view (the web, an older Android build) ────────────────────

type NavConnection = { type?: string; downlink?: number };
type NavPlus = Navigator & { deviceMemory?: number; connection?: NavConnection };

const MSE_TYPES: Record<CodecName, string> = {
  avc: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L150.B0"',
  vp9: 'video/webm; codecs="vp09.00.10.08"',
  av1: 'video/mp4; codecs="av01.0.08M.08"',
};
const TEN_BIT_TYPES: Partial<Record<CodecName, string>> = {
  hevc: 'video/mp4; codecs="hvc1.2.4.L153.B0"',
  vp9: 'video/webm; codecs="vp09.02.10.10"',
  av1: 'video/mp4; codecs="av01.0.08M.10"',
};

function canPlay(type: string): boolean | null {
  try {
    const ms = (globalThis as { MediaSource?: { isTypeSupported?: (t: string) => boolean } }).MediaSource;
    if (ms?.isTypeSupported) return !!ms.isTypeSupported(type);
    if (typeof document === 'undefined') return null;
    const el = document.createElement('video');
    if (typeof el.canPlayType !== 'function') return null;
    const r = el.canPlayType(type);
    return r === 'probably' || r === 'maybe';
  } catch {
    return null;
  }
}

type Decoding = { supported?: boolean; smooth?: boolean; powerEfficient?: boolean };
async function decodingInfo(contentType: string, width: number, height: number): Promise<Decoding | null> {
  try {
    const mc = (navigator as Navigator & { mediaCapabilities?: { decodingInfo?: (c: unknown) => Promise<Decoding> } }).mediaCapabilities;
    if (!mc?.decodingInfo) return null;
    return await mc.decodingInfo({ type: 'media-source', video: { contentType, width, height, bitrate: 15_000_000, framerate: 30 } });
  } catch {
    return null;
  }
}

async function webCodec(name: CodecName): Promise<CodecSupport> {
  const decoder = canPlay(MSE_TYPES[name]);
  if (decoder === false) return { decoder: false, hardware: false, uhd: false, tenBit: false };
  const hd = await decodingInfo(MSE_TYPES[name], 1920, 1080);
  const uhd = await decodingInfo(MSE_TYPES[name], 3840, 2160);
  const ten = TEN_BIT_TYPES[name] ? canPlay(TEN_BIT_TYPES[name]!) : null;
  return {
    decoder: decoder ?? (hd ? !!hd.supported : null),
    // A power-efficient decode is a hardware one; otherwise unknown on the web.
    hardware: hd?.powerEfficient === true ? true : null,
    uhd: uhd ? !!(uhd.supported && uhd.smooth) : null,
    tenBit: ten,
  };
}

function webScreen(): DeviceScan['screen'] {
  try {
    const dpr = num(window.devicePixelRatio, 0.5, 8) ?? 1;
    const w = Math.round((num(window.screen?.width, 1, 20000) ?? 0) * dpr);
    const h = Math.round((num(window.screen?.height, 1, 20000) ?? 0) * dpr);
    if (!w || !h) return null;
    let hdr = false;
    try { hdr = window.matchMedia('(dynamic-range: high)').matches; } catch { hdr = false; }
    return { width: Math.max(w, h), height: Math.min(w, h), refreshHz: null, hdr: hdr ? ['hdr'] : [] };
  } catch {
    return null;
  }
}

/** What the browser tells, with whatever the vitals gave (exported for tests). */
export async function webScan(v: DeviceVitals | null, base: ScanBase, speed: SpeedResult | null, at = Date.now()): Promise<DeviceScan> {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as NavPlus;
  const conn = nav.connection;
  const codecs = {} as Record<CodecName, CodecSupport>;
  for (const c of CODEC_NAMES) codecs[c] = await webCodec(c).catch(() => ({ ...UNKNOWN_CODEC }));
  const memGb = num(nav.deviceMemory, 0.1, 1024);
  // An Android build with the vitals but no scan plugin: its memory, storage
  // and Wi-Fi are real figures, so they are used as they are.
  if (v && (v.memTotalMb != null || v.sdk != null)) {
    const fromVitals = scanFromNative(v, null, base, speed, at);
    return {
      ...fromVitals,
      source: 'web',
      screen: webScreen(),
      codecs,
    };
  }
  return {
    at,
    source: 'web',
    formFactor: base.formFactor,
    model: base.model,
    osVersion: base.osVersion,
    apiLevel: null,
    webview: base.webview,
    // The browser rounds and caps it (at 8 GB): a floor, never "free".
    ramTotal: memGb ? memGb * GB : null,
    ramFree: null,
    ramLow: null,
    lowRamDevice: null,
    storageFree: null,
    storageTotal: null,
    cores: num(nav.hardwareConcurrency, 1, 256),
    is64bit: null,
    screen: webScreen(),
    codecs,
    network: {
      type: conn?.type ? netTypeOf(conn.type === 'wimax' ? 'other' : conn.type) : v?.online === false ? 'none' : 'unknown',
      downKbps: num(conn?.downlink, 0.01, 1e5) ? Math.round(conn!.downlink! * 1000) : null,
      vpn: false,
    },
    wifi: null,
    speed,
  };
}

// ── the speed test's last run ────────────────────────────────────────────────

export const SPEED_KEY = 'smc-device-scan-speed-v1';
/** A speed result older than this is not shown (the connection changes). */
export const SPEED_MAX_AGE_MS = 30 * 60 * 1000;

export function keepSpeed(r: { downMbps: number; upMbps: number; pingMs: number | null; jitterMs: number | null }, at = Date.now()): SpeedResult | null {
  const down = num(r.downMbps, 0, 100000);
  const up = num(r.upMbps, 0, 100000);
  if (down === null || up === null) return null;
  const out: SpeedResult = { downMbps: down, upMbps: up, pingMs: num(r.pingMs, 0, 60000), jitterMs: num(r.jitterMs, 0, 60000), at };
  try { sessionStorage.setItem(SPEED_KEY, JSON.stringify(out)); } catch { /* this screen still shows it */ }
  return out;
}

export function lastSpeed(now = Date.now()): SpeedResult | null {
  try {
    const o = JSON.parse(sessionStorage.getItem(SPEED_KEY) || 'null') as Partial<SpeedResult> | null;
    if (!o || typeof o.at !== 'number' || now - o.at > SPEED_MAX_AGE_MS || now < o.at) return null;
    const down = num(o.downMbps, 0, 100000);
    const up = num(o.upMbps, 0, 100000);
    if (down === null || up === null) return null;
    return { downMbps: down, upMbps: up, pingMs: num(o.pingMs, 0, 60000), jitterMs: num(o.jitterMs, 0, 60000), at: o.at };
  } catch {
    return null;
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p.catch(() => null), new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

/** The scan plugin's read, or null (the web, an older build, or over ~4 s). */
async function readNativeScan(): Promise<NativeDeviceScan | null> {
  let native = false;
  try { native = isNativePlatform(); } catch { native = false; }
  if (!native) return null;
  return withTimeout(AppManager.getDeviceScan(), 4000);
}

/** The whole scan. Never rejects; a second or two at most (4 s cap on each native read). */
export async function scanDevice(): Promise<DeviceScan> {
  const [n, v] = await Promise.all([readNativeScan(), withTimeout(readVitals(), 4000)]);
  const base = scanBase();
  const speed = lastSpeed();
  if (n) return scanFromNative(v, n, base, speed);
  return webScan(v, base, speed);
}
