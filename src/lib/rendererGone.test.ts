/**
 * The page's renderer died under the app last time (MainActivity keeps a
 * record): the next start sends one 'webview_gone' event with device facts
 * only, and nothing on the web build or when there is no record.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state } = vi.hoisted(() => ({
  state: { native: true, record: undefined as Record<string, unknown> | undefined, fail: false, taken: 0 },
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => state.native } }));
vi.mock('@/capacitor/AppManager', () => ({
  AppManager: {
    takeRendererGone: async () => {
      state.taken++;
      if (state.fail) throw new Error('not implemented');
      const gone = state.record;
      state.record = undefined;
      return gone ? { gone } : {};
    },
  },
}));

import { rendererGoneProps, reportRendererGone } from './rendererGone';

const RECORD = {
  at: Date.UTC(2026, 9, 11, 20, 15, 0),
  didCrash: false,
  priority: 2,
  playerActive: true,
  model: 'Amlogic X96Max_Plus2',
  sdk: 28,
  totalMemMb: 1900,
  availMemMb: 140,
  lowMemory: true,
  webView: 'com.google.android.webview 66.0.3359.158',
  count: 1,
};

beforeEach(() => {
  state.native = true;
  state.record = undefined;
  state.fail = false;
  state.taken = 0;
  document.documentElement.classList.remove('legacy-webview');
});

describe('rendererGone', () => {
  it('one webview_gone event with the record\'s device facts', async () => {
    state.record = { ...RECORD };
    document.documentElement.classList.add('legacy-webview');
    const track = vi.fn();
    await reportRendererGone(track);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('webview_gone', 'app', {
      gone_at: '2026-10-11T20:15:00.000Z',
      did_crash: false,
      priority: 2,
      player_active: true,
      model: 'Amlogic X96Max_Plus2',
      sdk: 28,
      total_mem_mb: 1900,
      avail_mem_mb: 140,
      low_memory: true,
      webview: 'com.google.android.webview 66.0.3359.158',
      count: 1,
      legacy_webview: true,
    });
    // Once: the record is gone after it was taken.
    await reportRendererGone(track);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('passes on nothing the record should not have (an address, a user)', () => {
    const props = rendererGoneProps({ ...RECORD, url: 'http://x/live/user/pass/1.ts', username: 'u' } as never, false);
    expect(Object.keys(props).sort()).toEqual([
      'avail_mem_mb', 'count', 'did_crash', 'gone_at', 'legacy_webview', 'low_memory', 'model', 'player_active',
      'priority', 'sdk', 'total_mem_mb', 'webview',
    ]);
    expect(JSON.stringify(props)).not.toMatch(/live\/|pass|"u"/);
  });

  it('no record, the web build, or an older build without the call: nothing sent, nothing thrown', async () => {
    const track = vi.fn();
    await reportRendererGone(track);
    state.native = false;
    state.record = { ...RECORD };
    await reportRendererGone(track);
    expect(state.taken).toBe(1);
    state.native = true;
    state.fail = true;
    await expect(reportRendererGone(track)).resolves.toBeUndefined();
    expect(track).not.toHaveBeenCalled();
  });
});
