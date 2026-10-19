/**
 * Rewind & recording › Recordings on a computer: the row says "Not set up" or
 * the saved computer's name, OK (or Right) opens the computer's page in this
 * page's place, and Back there comes back here (one Back = one step). Only
 * where recording is: not on the web, not in the demo, not on an app whose
 * native side can't answer.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  recorder: true,
  demo: false,
  folder: { configured: false } as Record<string, unknown>,
  folderFails: false,
  asked: 0,
}));
vi.mock('@/capacitor/SnowPlayer', () => ({
  SnowPlayer: { timeshiftUsage: async () => ({ usedBytes: 0, freeBytes: 20 * 1024 ** 3, totalBytes: 32 * 1024 ** 3 }) },
}));
vi.mock('@/hooks/usePlayerAccount', () => ({
  usePlayerAccount: () => ({ account: { host: 'http://h', username: 'u', password: 'p', maxConnections: 2 } }),
}));
vi.mock('@/lib/demoMode', () => ({ isDemo: () => h.demo }));
vi.mock('@/capacitor/SnowRecorder', () => ({
  hasRecorder: () => h.recorder,
  notifyRecordingsChanged: () => {},
  SnowRecorder: {
    getNetworkFolder: async () => {
      h.asked += 1;
      if (h.folderFails) throw new Error('not implemented');
      return h.folder;
    },
    findComputers: async () => ({ computers: [] }),
    saveNetworkFolder: async () => ({ ok: false, reason: 'error' }),
    clearNetworkFolder: async () => ({}),
  },
}));

import RewindSettingsScreen from './RewindSettingsScreen';
import { REWIND_SETTINGS_KEY } from '@/lib/liveRewind';
import { PADDING_KEY } from '@/lib/recordSchedule';

const key = (k: string) => { act(() => { fireEvent.keyDown(window, { key: k }); }); };
const settle = async () => { await act(async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); }); };
const focused = () => document.querySelector('[data-rewind-row][data-focused="true"]')?.getAttribute('data-rewind-row');
const netRow = () => document.querySelector('[data-rewind-row="net"]');
const open = async (props: Partial<Parameters<typeof RewindSettingsScreen>[0]> = {}) => {
  const onBack = vi.fn();
  const r = render(<RewindSettingsScreen onBack={onBack} {...props} />);
  await settle();
  return { ...r, onBack };
};

beforeEach(() => {
  localStorage.removeItem(REWIND_SETTINGS_KEY); localStorage.removeItem(PADDING_KEY);
  h.recorder = true; h.demo = false; h.folder = { configured: false }; h.folderFails = false; h.asked = 0;
});

describe('Rewind & recording › Recordings on a computer', () => {
  it('the last row, "Not set up" until a computer is saved', async () => {
    await open();
    expect(netRow()?.textContent).toContain('Recordings on a computer');
    expect(document.querySelector('[data-rewind-net-value]')?.textContent).toBe('Not set up');
    for (let i = 0; i < 6; i += 1) key('ArrowDown');
    expect(focused()).toBe('net');
  });

  it('a saved computer shows its name', async () => {
    h.folder = { configured: true, host: '192.168.1.20', share: 'TV', label: 'DESKTOP-ABC' };
    await open();
    expect(document.querySelector('[data-rewind-net-value]')?.textContent).toBe('DESKTOP-ABC');
  });

  it('OK opens the computer\'s page in this one\'s place; Back there comes back to the row, asking again what is saved', async () => {
    const { onBack } = await open();
    for (let i = 0; i < 4; i += 1) key('ArrowDown');
    expect(focused()).toBe('net');
    key('Enter');
    await settle();
    expect(document.querySelector('[data-network-folder]')).toBeTruthy();
    expect(netRow()).toBeNull();
    h.folder = { configured: true, host: '192.168.1.20', share: 'TV', label: 'DESKTOP-ABC' };
    key('Escape');
    await settle();
    expect(onBack).not.toHaveBeenCalled();
    expect(document.querySelector('[data-network-folder]')).toBeNull();
    expect(focused()).toBe('net');
    expect(document.querySelector('[data-rewind-net-value]')?.textContent).toBe('DESKTOP-ABC');
    expect(h.asked).toBe(3); // this page, the computer's page, this page again
    key('Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('beside the Settings menu: Right opens it, Left on the row goes back to the menu', async () => {
    const { onBack } = await open({ embedded: true, active: true });
    for (let i = 0; i < 4; i += 1) key('ArrowDown');
    expect(focused()).toBe('net');
    key('ArrowLeft');
    expect(onBack).toHaveBeenCalledTimes(1);
    key('ArrowRight');
    await settle();
    expect(document.querySelector('[data-network-folder]')).toBeTruthy();
    // Left on the computer's page comes back here, not to the menu.
    key('ArrowLeft');
    await settle();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(focused()).toBe('net');
  });

  it.each([
    ['on the web (no recorder)', () => { h.recorder = false; }],
    ['in the demo', () => { h.demo = true; }],
    ['on an app whose native side cannot answer', () => { h.folderFails = true; }],
  ])('no row %s', async (_name, set) => {
    set();
    await open();
    expect(netRow()).toBeNull();
    for (let i = 0; i < 6; i += 1) key('ArrowDown');
    expect(focused()).toBe('after');
  });
});
