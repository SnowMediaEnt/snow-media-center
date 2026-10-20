/**
 * Recordings on a computer (NetworkFolderScreen): Find computers fills
 * Computer, Test and save sends the fields and says what happened in plain
 * words (free space, or why it failed), a saved folder shows its name and
 * keeps its password when Password is left empty, Stop using this computer
 * asks once, and the remote walks the rows (Back / Left leave).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Args = { host: string; share: string; folder?: string; user?: string; password?: string };
const h = vi.hoisted(() => ({
  folder: { configured: false } as Record<string, unknown>,
  /** What getNetworkFolder answers once a save worked. */
  afterSave: null as null | Record<string, unknown>,
  computers: [] as Array<{ host: string; name?: string }>,
  result: { ok: true, freeBytes: 0 } as { ok: boolean; reason?: string; freeBytes?: number },
  saveThrows: false,
  saves: [] as Args[],
  clears: 0,
  finds: 0,
  changed: 0,
}));

vi.mock('@/capacitor/SnowRecorder', () => ({
  notifyRecordingsChanged: () => { h.changed += 1; },
  SnowRecorder: {
    getNetworkFolder: async () => h.folder,
    findComputers: async () => { h.finds += 1; return { computers: h.computers }; },
    saveNetworkFolder: async (a: Args) => {
      h.saves.push(a);
      if (h.saveThrows) throw new Error('plugin');
      if (h.result.ok && h.afterSave) h.folder = h.afterSave;
      return h.result;
    },
    testNetworkFolder: async () => h.result,
    clearNetworkFolder: async () => { h.clears += 1; h.folder = { configured: false }; return {}; },
  },
}));

import NetworkFolderScreen, { DEFAULT_FOLDER } from './NetworkFolderScreen';
import { splitAddress } from '@/lib/recording';

const TB = 1024 ** 4;
const key = (k: string) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); for (let i = 0; i < 10; i += 1) await Promise.resolve(); }); };
const until = async (cond: () => boolean) => {
  await settle(); // what a key started finishes inside act, even when the condition already holds
  for (let i = 0; i < 100 && !cond(); i += 1) await settle(10);
  expect(cond()).toBe(true);
};
const focusedRow = () => document.querySelector('[data-row][data-focused="true"]')?.getAttribute('data-row');
const input = (row: string) => document.querySelector(`[data-row="${row}"] input`) as HTMLInputElement;
const type = (row: string, value: string) => act(() => { fireEvent.change(input(row), { target: { value } }); });
const result = () => document.querySelector('[data-network-result]');
/** Walks the highlight down to a row (fails the test if it isn't there). */
const goTo = (row: string) => {
  for (let i = 0; i < 20 && focusedRow() !== row; i += 1) key('ArrowDown');
  expect(focusedRow()).toBe(row);
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  h.folder = { configured: false };
  h.afterSave = null;
  h.computers = [];
  h.result = { ok: true, freeBytes: 0 };
  h.saveThrows = false;
  h.saves = [];
  h.clears = 0;
  h.finds = 0;
  h.changed = 0;
});
afterEach(() => { vi.useRealTimers(); });

const renderScreen = async (over: Partial<Parameters<typeof NetworkFolderScreen>[0]> = {}) => {
  const onBack = vi.fn();
  let r!: ReturnType<typeof render>;
  // The saved folder is asked for on the first render: let its answer land inside act.
  await act(async () => { r = render(<NetworkFolderScreen onBack={onBack} embedded active {...over} />); });
  await settle();
  return { ...r, onBack };
};

describe('NetworkFolderScreen', () => {
  it('says what it is for and how to share a folder on Windows and Mac', async () => {
    await renderScreen();
    expect(screen.getByText('Save recordings to a shared folder on a computer or NAS on your home network.')).toBeTruthy();
    const howto = document.querySelector('[data-network-howto]')!.textContent!;
    expect(howto).toContain('How to share a folder');
    expect(howto).toContain('Windows: right-click the folder › Properties › Sharing › Share');
    expect(howto).toContain('Mac: System Settings › General › Sharing › File Sharing');
    // Nothing saved yet: no saved line, no "Stop using", the default folder inside the share.
    expect(document.querySelector('[data-network-saved]')).toBeNull();
    expect(document.querySelector('[data-row="clear"]')).toBeNull();
    expect(input('folder').value).toBe(DEFAULT_FOLDER);
    expect(input('pass').type).toBe('password');
  });

  it('Find computers: a spinner, then the computers found; OK on one fills Computer and moves on to Shared folder', async () => {
    h.computers = [{ host: '192.168.1.20', name: 'DESKTOP-ABC' }, { host: '192.168.1.30' }, { host: '192.168.1.20', name: 'DESKTOP-ABC' }];
    let answer: () => void = () => {};
    const gate = new Promise<void>((r) => { answer = r; });
    const { SnowRecorder } = await import('@/capacitor/SnowRecorder');
    const real = SnowRecorder.findComputers;
    SnowRecorder.findComputers = async () => { await gate; return real(); };
    try {
      await renderScreen();
      expect(focusedRow()).toBe('find');
      key('Enter');
      await settle();
      expect(document.querySelector('[data-network-find="searching"]')?.textContent).toBe('Looking for computers… this takes a few seconds.');
      answer();
      await until(() => !!document.querySelector('[data-row="pc:0"]'));
    } finally { SnowRecorder.findComputers = real; }
    // One row per computer, the name first and its address beside it.
    expect(document.querySelectorAll('[data-row^="pc:"]')).toHaveLength(2);
    expect(document.querySelector('[data-row="pc:0"]')?.textContent).toBe('DESKTOP-ABC192.168.1.20');
    expect(document.querySelector('[data-row="pc:1"]')?.textContent).toBe('192.168.1.30');
    key('ArrowDown');
    expect(focusedRow()).toBe('pc:0');
    key('Enter');
    expect(input('host').value).toBe('192.168.1.20');
    expect(focusedRow()).toBe('share');
  });

  it('Find computers with none found says to type the name or address', async () => {
    await renderScreen();
    key('Enter');
    await until(() => h.finds === 1 && !!document.querySelector('[data-network-find="none"]'));
    expect(document.querySelector('[data-network-find="none"]')?.textContent).toBe('No computers found. Type its name or address below.');
    expect(document.querySelector('[data-row^="pc:"]')).toBeNull();
  });

  it('Test and save: sends the fields, then says it is saved with the free space on the computer', async () => {
    h.result = { ok: true, freeBytes: 1.2 * TB };
    h.afterSave = { configured: true, host: '192.168.1.20', share: 'TV', folder: DEFAULT_FOLDER, user: 'josh', label: 'DESKTOP-ABC' };
    await renderScreen();
    type('host', '192.168.1.20');
    type('share', 'TV');
    type('user', 'josh');
    type('pass', 'hunter2');
    goTo('save');
    key('Enter');
    await until(() => !!result());
    expect(h.saves).toEqual([{ host: '192.168.1.20', share: 'TV', folder: DEFAULT_FOLDER, user: 'josh', password: 'hunter2' }]);
    expect(result()?.getAttribute('data-network-result')).toBe('ok');
    expect(screen.getByRole('status').textContent).toBe('Saved. 1.2 TB free on DESKTOP-ABC.');
    // The typed password is forgotten; the saved folder shows, with Stop using this computer.
    expect(input('pass').value).toBe('');
    expect(document.querySelector('[data-network-saved]')?.textContent).toContain('Recordings go to DESKTOP-ABC.');
    expect(document.querySelector('[data-row="clear"]')).toBeTruthy();
    expect(h.changed).toBe(1);
  });

  it.each([
    ['unreachable', "Couldn't reach that computer. Is it on and on the same network?"],
    ['auth', 'The computer refused that user name or password.'],
    ['no_share', 'That computer has no shared folder by that name.'],
    ['no_folder', "The folder can't be written to: check its sharing permissions allow changes."],
    ['read_only', "The folder can't be written to: check its sharing permissions allow changes."],
    ['error', "That didn't work. Check the details and try again."],
    ['something_new', "That didn't work. Check the details and try again."],
  ])('Test and save that fails (%s) says why, plainly, and saves nothing', async (reason, text) => {
    h.result = { ok: false, reason };
    await renderScreen();
    type('host', 'DESKTOP-ABC');
    type('share', 'TV');
    goTo('save');
    key('Enter');
    await until(() => !!result());
    expect(screen.getByRole('status').textContent).toBe(text);
    expect(document.querySelector('[data-network-saved]')).toBeNull();
    expect(h.changed).toBe(0);
    // No password typed, none sent.
    expect(h.saves[0]).not.toHaveProperty('password');
  });

  it('a save the app could not even try (the plugin threw) is "That didn\'t work"', async () => {
    h.saveThrows = true;
    await renderScreen();
    type('host', 'DESKTOP-ABC');
    type('share', 'TV');
    goTo('save');
    key('Enter');
    await until(() => !!result());
    expect(result()?.getAttribute('data-network-result')).toBe('error');
  });

  it('asks for the computer and the shared folder before trying; a pasted \\\\PC\\share is split into both', async () => {
    await renderScreen();
    goTo('save');
    key('Enter');
    await settle();
    expect(screen.getByRole('status').textContent).toBe("Type the computer's name or address.");
    expect(focusedRow()).toBe('host');
    type('host', '\\\\DESKTOP-ABC\\TV');
    goTo('save');
    key('Enter');
    await until(() => h.saves.length === 1);
    expect(h.saves[0]).toMatchObject({ host: 'DESKTOP-ABC', share: 'TV' });
    expect(input('host').value).toBe('DESKTOP-ABC');
    expect(input('share').value).toBe('TV');

    expect(splitAddress('smb://nas/Media/TV')).toEqual({ host: 'nas', share: 'Media' });
    expect(splitAddress('  192.168.1.20 ')).toEqual({ host: '192.168.1.20', share: undefined });
  });

  it('a saved folder: its name, the fields filled, and an empty Password keeps the saved one', async () => {
    h.folder = { configured: true, host: '192.168.1.20', share: 'TV', folder: 'Recs', user: 'josh', label: 'DESKTOP-ABC' };
    h.result = { ok: true, freeBytes: 0 };
    await renderScreen();
    expect(document.querySelector('[data-network-saved]')?.textContent).toContain('Recordings go to DESKTOP-ABC.');
    expect(document.querySelector('[data-network-saved]')?.textContent).toContain('\\\\192.168.1.20\\TV\\Recs');
    expect(input('host').value).toBe('192.168.1.20');
    expect(input('share').value).toBe('TV');
    expect(input('folder').value).toBe('Recs');
    expect(input('user').value).toBe('josh');
    expect(input('pass').value).toBe('');
    expect(input('pass').placeholder).toBe('Leave empty to keep the saved password');
    goTo('pass');
    expect(document.querySelector('[data-row="pass"]')?.textContent).toContain('Leave empty to keep the saved password');
    key('ArrowDown');
    key('Enter');
    await until(() => !!result());
    expect(h.saves).toEqual([{ host: '192.168.1.20', share: 'TV', folder: 'Recs', user: 'josh' }]);
    expect(screen.getByRole('status').textContent).toBe('Saved. Recordings go to DESKTOP-ABC.');
  });

  it('Stop using this computer asks once, then forgets the folder', async () => {
    h.folder = { configured: true, host: '192.168.1.20', share: 'TV', folder: DEFAULT_FOLDER, user: 'josh', label: 'DESKTOP-ABC' };
    await renderScreen();
    goTo('clear');
    key('Enter');
    await settle();
    expect(h.clears).toBe(0);
    expect(document.querySelector('[data-network-confirm]')?.textContent).toBe('Stop saving recordings to DESKTOP-ABC? Press OK again.');
    // Moving off takes the question back.
    key('ArrowUp');
    key('ArrowDown');
    expect(document.querySelector('[data-network-confirm]')).toBeNull();
    key('Enter');
    await settle();
    expect(h.clears).toBe(0);
    key('Enter');
    await until(() => h.clears === 1);
    await settle();
    expect(document.querySelector('[data-network-saved]')).toBeNull();
    expect(document.querySelector('[data-row="clear"]')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Done. Recordings already on the computer stay there.');
    expect(focusedRow()).toBe('save');
    expect(h.changed).toBe(1);
  });

  it('the remote: Up / Down walk the rows and stop at the ends; Left and Back return; no key is taken while inactive', async () => {
    const { onBack, rerender } = await renderScreen();
    const seen: string[] = [focusedRow()!];
    for (let i = 0; i < 8; i += 1) { key('ArrowDown'); seen.push(focusedRow()!); }
    expect(seen).toEqual(['find', 'host', 'share', 'folder', 'user', 'pass', 'save', 'save', 'save']);
    for (let i = 0; i < 8; i += 1) key('ArrowUp');
    expect(focusedRow()).toBe('find');
    key('ArrowLeft');
    expect(onBack).toHaveBeenCalledTimes(1);
    key('Escape');
    expect(onBack).toHaveBeenCalledTimes(2);

    rerender(<NetworkFolderScreen onBack={onBack} embedded active={false} />);
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    key('ArrowDown'); key('Enter'); key('Escape');
    expect(behind).toHaveBeenCalledTimes(3);
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(focusedRow()).toBeUndefined();
    window.removeEventListener('keydown', behind);
  });

  it('typing: OK opens a field, the keyboard\'s Enter goes field to field and lands on Test and save; its parting Enter is not a press; Back puts the keyboard away first', async () => {
    const { onBack } = await renderScreen();
    goTo('user');
    key('Enter');
    expect(document.activeElement).toBe(input('user'));
    key('Enter'); // the echo of that OK
    expect(document.activeElement).toBe(input('user'));
    type('user', 'josh');
    await settle(900);
    key('Enter'); // the keyboard's Next
    expect(focusedRow()).toBe('pass');
    expect(document.activeElement).toBe(input('pass'));
    await settle(900);
    key('Enter'); // the keyboard's Done on the last field
    expect(focusedRow()).toBe('save');
    expect(document.activeElement).not.toBe(input('pass'));
    key('Enter'); // its parting Enter
    await settle();
    expect(h.saves).toHaveLength(0);
    expect(result()).toBeNull();

    // Back while typing: only the keyboard goes.
    await settle(800);
    key('ArrowUp');
    key('Enter');
    expect(document.activeElement).toBe(input('pass'));
    key('Escape');
    expect(onBack).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(input('pass'));
    await settle(800);
    key('Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('on its own: a Back button at the top, reached with Left; OK on it goes back', async () => {
    const { onBack } = await renderScreen({ embedded: false });
    expect(focusedRow()).toBe('find');
    key('ArrowLeft');
    expect(document.querySelector('[data-focus-id="back"]')?.getAttribute('data-focused')).toBe('true');
    key('Enter');
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
