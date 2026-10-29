// Device Health's native side (android/.../health/DeviceHealthPlugin.kt):
// the box's vitals on demand, and how the last run(s) of the app ended.
// Numbers and device facts only — never an SSID, an address or a name.
import { registerPlugin } from '@capacitor/core';

export interface DeviceVitals {
  model?: string;
  sdk?: number;
  /** Processor cores: cpuPct adds them all up. */
  cpuCores?: number;
  memAvailMb?: number;
  memTotalMb?: number;
  lowMemory?: boolean;
  lowRamDevice?: boolean;
  storageFreeMb?: number;
  wifiRssi?: number;
  wifiLinkMbps?: number;
  wifiFreqMhz?: number;
  wired?: boolean;
  online?: boolean;
  uptimeSec?: number;
  appUptimeSec?: number;
}

/** One way a previous run ended (HealthStore.kt). */
export interface LastExit {
  kind: 'crash' | 'killed';
  /** crash, crash_native, anr, low_memory, renderer_crashed, renderer_killed, box_restarted, signaled, unknown, … */
  exitReason?: string;
  /** Exception class + top 5 frames (no message). */
  stack?: string;
  /** ms since the epoch; 0 when unknown. */
  at?: number;
  onScreenSec?: number;
  pssMb?: number;
  exitStatus?: number;
  playerActive?: boolean;
  memAvailMb?: number;
  memTotalMb?: number;
  lowMemory?: boolean;
}

export interface DeviceHealthPlugin {
  getDeviceVitals(): Promise<DeviceVitals>;
  takeLastExits(): Promise<{ exits: LastExit[] }>;
}

const webFallback: DeviceHealthPlugin = {
  async getDeviceVitals() {
    const v: DeviceVitals = {};
    try { v.online = typeof navigator === 'undefined' || navigator.onLine !== false; } catch { /* ignore */ }
    return v;
  },
  async takeLastExits() { return { exits: [] }; },
};

export const DeviceHealth = registerPlugin<DeviceHealthPlugin>('DeviceHealth', { web: webFallback });
