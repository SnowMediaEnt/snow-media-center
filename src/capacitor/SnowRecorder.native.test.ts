/**
 * On a box the recorder plugin tells the page when a recording or a schedule
 * starts, ends or changes by itself (a scheduled start, a full drive). That
 * 'recordingsChanged' event must reach every screen through the one
 * window event they already listen for (notifyRecordingsChanged), so the
 * Recordings list, the REC badge and the Rewind gate (streams minus
 * recordings) follow it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const plugin = vi.hoisted(() => ({
  listeners: [] as Array<{ event: string; cb: () => void }>,
  addListener: null as unknown as (event: string, cb: () => void) => Promise<{ remove: () => Promise<void> }>,
}));
plugin.addListener = async (event, cb) => { plugin.listeners.push({ event, cb }); return { remove: async () => {} }; };

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true },
  registerPlugin: () => plugin,
}));

afterEach(() => { plugin.listeners.length = 0; vi.resetModules(); });

describe('the native recordingsChanged event', () => {
  it('is listened for once when the module loads on a box, and fires the window event', async () => {
    vi.resetModules();
    const mod = await import('./SnowRecorder');
    expect(plugin.listeners.map((l) => l.event)).toEqual(['recordingsChanged']);
    let told = 0;
    const on = () => { told++; };
    window.addEventListener(mod.RECORDINGS_CHANGED_EVENT, on);
    plugin.listeners[0].cb();
    plugin.listeners[0].cb();
    window.removeEventListener(mod.RECORDINGS_CHANGED_EVENT, on);
    expect(told).toBe(2);
    expect(mod.hasRecorder()).toBe(true);
  });
});
