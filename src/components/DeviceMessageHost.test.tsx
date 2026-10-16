/**
 * Messages to this TV (DeviceMessageHost over lib/deviceInbox): the check-in
 * brings them, the card shows one at a time with the sender's title, OK or
 * Back reads it (and the server hears so), the remote is the card's while it
 * is up, and a Kids profile or "Who's watching?" holds them for a grown-up.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Body = Record<string, unknown> & { action: string };
const h = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown> & { action: string }>,
  messages: [] as unknown[],
  kidsLevel: null as null | string,
  backButton: null as null | (() => void),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async (_name: string, { body }: { body: Body }) => {
        h.calls.push(body);
        if (body.action === 'checkin') return { data: { ok: true, messages: h.messages }, error: null };
        return { data: { ok: true }, error: null };
      }),
    },
  },
}));
vi.mock('@/lib/xtream', () => ({ loadCreds: async () => ({ host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw', output: 'm3u8' }) }));
vi.mock('@/hooks/useVersion', () => ({ loadVersion: async () => ({ version: '1.9.2', versionCode: 70 }) }));
vi.mock('@/hooks/useActiveProfile', () => ({ useActiveProfile: () => ({ profile: { id: 'p', name: 'Me', kidsLevel: h.kidsLevel }, count: 1 }) }));
vi.mock('@capacitor/preferences', () => {
  const store = new Map<string, string>();
  return {
    Preferences: {
      get: async ({ key }: { key: string }) => ({ value: store.get(key) ?? null }),
      set: async ({ key, value }: { key: string; value: string }) => { store.set(key, value); },
    },
  };
});
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (ev: string, cb: () => void) => {
      if (ev === 'backButton') h.backButton = cb;
      return { remove: vi.fn() };
    }),
  },
}));

import DeviceMessageHost, { ARM_MS } from './DeviceMessageHost';
import { __resetDeviceInboxForTests, checkinNow } from '@/lib/deviceInbox';

const key = (k: string) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); for (let i = 0; i < 10; i += 1) await Promise.resolve(); }); };
const dismissed = () => h.calls.filter((c) => c.action === 'dismiss').map((c) => c.id);
const card = () => document.querySelector('[data-device-message]');
/** Lets the check-in (and the module loads it waits on) run until `cond` holds. */
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i += 1) await settle(10);
  expect(cond()).toBe(true);
};
/** The first check-in has brought its messages, and the card is past its first moment. */
const up = async () => {
  await until(() => !!card());
  await settle(ARM_MS + 50);
};

const MSGS = [
  { id: 'm2', body: 'Please switch to the other account.', sender: 'owner', created_at: '2026-10-16T11:59:00Z' },
  { id: 'm1', body: 'Line one\nLine two <b>not bold</b>', sender: 'admin', created_at: '2026-10-16T11:58:00Z' },
];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
  __resetDeviceInboxForTests();
  localStorage.clear();
  h.calls.length = 0;
  h.messages = [...MSGS];
  h.kidsLevel = null;
  h.backButton = null;
});
afterEach(() => { __resetDeviceInboxForTests(); vi.useRealTimers(); });

describe('DeviceMessageHost', () => {
  it('shows the oldest first with its sender\'s title, as plain text with its line breaks; OK reads it and the next one shows', async () => {
    render(<DeviceMessageHost />);
    await until(() => !!card());
    expect(h.calls.map((c) => c.action)).toEqual(['register', 'checkin']);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Message from Snow Media');
    const body = document.querySelector('[data-device-message-body]')!;
    expect(body.textContent).toBe('Line one\nLine two <b>not bold</b>');
    expect(body.querySelector('b')).toBeNull();
    expect(screen.getByText('Sent 2 minutes ago')).toBeTruthy();

    // A press the moment it pops up was meant for the screen underneath.
    key('Enter');
    expect(dismissed()).toEqual([]);
    await settle(ARM_MS + 50);
    key('Enter');
    await settle();
    expect(dismissed()).toEqual(['m1']);
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Message from the account owner');
    expect(screen.getByText('Please switch to the other account.')).toBeTruthy();

    // Back reads it too.
    await settle(ARM_MS + 50);
    key('Escape');
    await settle();
    expect(dismissed()).toEqual(['m1', 'm2']);
    expect(card()).toBeNull();
  });

  it('the remote\'s Back button (Capacitor backButton) dismisses as well', async () => {
    h.messages = [MSGS[0]];
    render(<DeviceMessageHost />);
    await up();
    act(() => { h.backButton!(); });
    await settle();
    expect(dismissed()).toEqual(['m2']);
    expect(card()).toBeNull();
  });

  it('owns the remote while a message is up, and leaves it alone otherwise', async () => {
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    h.messages = [MSGS[0]];
    render(<DeviceMessageHost />);
    await up();
    key('ArrowDown'); key('ArrowLeft'); key('Escape');
    expect(behind).not.toHaveBeenCalled();
    await settle();
    expect(card()).toBeNull();
    key('ArrowDown');
    key('Enter');
    expect(behind).toHaveBeenCalledTimes(2);
    window.removeEventListener('keydown', behind);
  });

  it('holds messages on a Kids profile and behind "Who\'s watching?", and shows them to a grown-up', async () => {
    h.kidsLevel = 'kids';
    const { rerender } = render(<DeviceMessageHost />);
    await until(() => h.calls.some((c) => c.action === 'checkin'));
    await settle(ARM_MS + 50);
    expect(card()).toBeNull();
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    key('Enter');
    expect(behind).toHaveBeenCalledTimes(1); // nothing up: the keys are the screen's
    window.removeEventListener('keydown', behind);
    expect(dismissed()).toEqual([]);

    h.kidsLevel = null;
    rerender(<DeviceMessageHost blocked />);
    await settle();
    expect(card()).toBeNull();

    rerender(<DeviceMessageHost />);
    await settle();
    expect(card()?.getAttribute('data-device-message')).toBe('admin');
  });

  it('a message that arrives later joins the queue behind the one showing', async () => {
    h.messages = [MSGS[0]];
    render(<DeviceMessageHost />);
    await up();
    h.messages = [MSGS[0], { id: 'm3', body: 'Later', sender: 'owner', created_at: '2026-10-16T12:00:30Z' }];
    await act(async () => { await checkinNow(); });
    expect(screen.getByText('Please switch to the other account.')).toBeTruthy();
    key('Enter');
    await settle();
    expect(screen.getByText('Later')).toBeTruthy();
  });
});
