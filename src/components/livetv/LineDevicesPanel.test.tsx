/**
 * "Devices on this line" (LineDevicesPanel): the list from device-inbox, the
 * remote walking it, All / some devices, a ready-made or own message, what
 * goes to the server, the not-signed-in / not-the-owner lines, and a TV on
 * a line with no email on file sending through support.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Body = Record<string, unknown> & { action: string };
const h = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown> & { action: string }>,
  reply: null as null | ((b: Record<string, unknown> & { action: string }) => unknown),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async (_name: string, { body }: { body: Body }) => {
        h.calls.push(body);
        return h.reply?.(body) ?? { data: { ok: true }, error: null };
      }),
    },
  },
}));

// The line this TV is signed into (support's way sends its password along).
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadCreds: async () => ({ host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw-1', output: 'm3u8' }),
}));

import LineDevicesPanel from './LineDevicesPanel';

const HOST = 'http://dstreams.xyz:8080';
const DEVICES = [
  { ref: 'r1', label: 'Fire TV AFTMM', app_version: '1.9.2', last_seen_at: '2026-10-16T11:55:00Z', watching_now: true, registered_at: '2026-10-01T00:00:00Z' },
  { ref: 'r2', label: 'onn 4K', app_version: '1.9.1', last_seen_at: '2026-10-16T09:00:00Z', watching_now: false, registered_at: '2026-10-02T00:00:00Z' },
];
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error('FunctionsHttpError'), { context: new Response(JSON.stringify(body), { status }) }),
});

const key = (k: string) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});
const settle = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); for (let i = 0; i < 10; i += 1) await Promise.resolve(); }); };
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i += 1) await settle(10);
  expect(cond()).toBe(true);
};
const focusedRow = () => document.querySelector('[data-row][data-focused="true"]')?.getAttribute('data-row');
const ticked = (row: string) => !!document.querySelector(`[data-row="${row}"] svg`); // the tick in its box
const sends = () => h.calls.filter((c) => c.action === 'send');

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
  h.calls.length = 0;
  h.reply = (b) => {
    if (b.action === 'devices') return { data: { ok: true, devices: DEVICES }, error: null };
    if (b.action === 'send') return { data: { ok: true, sent: Array.isArray(b.refs) ? b.refs.length : 2 }, error: null };
    return undefined;
  };
});
afterEach(() => { vi.useRealTimers(); });

const renderPanel = async (over: Partial<Parameters<typeof LineDevicesPanel>[0]> = {}) => {
  const onBack = vi.fn();
  const r = render(<LineDevicesPanel host={HOST} username="jsmith" onBack={onBack} embedded active {...over} />);
  await until(() => !document.querySelector('[data-line-devices="loading"]'));
  return { ...r, onBack };
};

describe('LineDevicesPanel', () => {
  it('lists the devices with their version and Watching now / Last opened', async () => {
    await renderPanel();
    expect(h.calls).toEqual([{ action: 'devices', host: HOST, username: 'jsmith' }]);
    expect(screen.getByText('Fire TV AFTMM')).toBeTruthy();
    expect(screen.getByText('Version 1.9.2')).toBeTruthy();
    expect(screen.getByText('Watching now')).toBeTruthy();
    expect(screen.getByText('Last opened 3 hours ago')).toBeTruthy();
  });

  it('walks the rows with Up / Down; OK ticks one device; Send goes to just that one with the ready-made message', async () => {
    await renderPanel();
    expect(focusedRow()).toBe('all');
    key('ArrowDown');
    expect(focusedRow()).toBe('dev:r1');
    key('Enter');
    expect(ticked('dev:r1')).toBe(true);
    expect(ticked('dev:r2')).toBe(false);
    key('ArrowDown'); key('ArrowDown');
    expect(focusedRow()).toBe('quick:0');
    key('Enter');
    for (let i = 0; i < 4; i += 1) key('ArrowDown');
    expect(focusedRow()).toBe('send');
    key('ArrowDown'); // stops at the end
    expect(focusedRow()).toBe('send');
    key('Enter');
    await until(() => !!document.querySelector('[data-send-result]'));
    expect(sends()).toEqual([{
      action: 'send', host: HOST, username: 'jsmith', refs: ['r1'],
      body: 'Too many people are on this line right now — please stop for a bit.',
    }]);
    expect(screen.getByRole('status').textContent).toBe('Sent to 1 device');
  });

  it('All devices sends to all; unticking one under All leaves the others ticked', async () => {
    await renderPanel();
    key('Enter'); // All
    expect(ticked('all') && ticked('dev:r1') && ticked('dev:r2')).toBe(true);
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(focusedRow()).toBe('quick:1');
    key('Enter');
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    key('Enter');
    await until(() => sends().length === 1);
    expect(sends()[0]).toMatchObject({ refs: 'all', body: 'Please switch to the other account.' });

    // Unticking r2 under All: r1 stays, All goes.
    for (let i = 0; i < 5; i += 1) key('ArrowUp');
    expect(focusedRow()).toBe('dev:r2');
    key('Enter');
    expect(ticked('all')).toBe(false);
    expect(ticked('dev:r1')).toBe(true);
    expect(ticked('dev:r2')).toBe(false);
  });

  it('says what is missing: no device picked, then no message picked', async () => {
    await renderPanel();
    for (let i = 0; i < 7; i += 1) key('ArrowDown');
    expect(focusedRow()).toBe('send');
    key('Enter');
    expect(screen.getByRole('status').textContent).toBe('Pick at least one device.');
    for (let i = 0; i < 7; i += 1) key('ArrowUp');
    key('Enter'); // All
    for (let i = 0; i < 7; i += 1) key('ArrowDown');
    key('Enter');
    expect(screen.getByRole('status').textContent).toBe('Pick a message or write your own.');
    expect(sends()).toEqual([]);
  });

  it('Write your own: OK opens the field, the keyboard\'s Enter moves to Send, and the text is what is sent', async () => {
    await renderPanel();
    key('Enter'); // All
    for (let i = 0; i < 6; i += 1) key('ArrowDown');
    expect(focusedRow()).toBe('custom');
    key('Enter');
    const input = document.querySelector('[data-row="custom"] input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, 'Movie night at 8, please hop off.');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(screen.getByText('33/200')).toBeTruthy();
    await settle(900);
    key('Enter'); // the keyboard's Enter: done
    expect(focusedRow()).toBe('send');
    key('Enter'); // the keyboard's parting Enter: not a press
    expect(sends()).toEqual([]);
    await settle(800);
    key('Enter');
    await until(() => sends().length === 1);
    expect(sends()[0]).toMatchObject({ refs: 'all', body: 'Movie night at 8, please hop off.' });
  });

  it('rate limited: says so', async () => {
    h.reply = (b) => (b.action === 'devices'
      ? { data: { ok: true, devices: DEVICES }, error: null }
      : { data: { ok: false, reason: 'rate_limited' }, error: null });
    await renderPanel();
    key('Enter');
    for (let i = 0; i < 3; i += 1) key('ArrowDown');
    key('Enter'); // quick:0
    for (let i = 0; i < 4; i += 1) key('ArrowDown');
    key('Enter');
    await until(() => !!document.querySelector('[data-send-result]'));
    expect(screen.getByRole('status').textContent).toBe("That's a lot of messages. Wait a few minutes, then try again.");
  });

  it('embedded: Left and Back return to the menu, and no key is taken while the remote is on the menu', async () => {
    const { onBack, rerender } = await renderPanel();
    key('ArrowLeft');
    expect(onBack).toHaveBeenCalledTimes(1);
    key('Escape');
    expect(onBack).toHaveBeenCalledTimes(2);
    rerender(<LineDevicesPanel host={HOST} username="jsmith" onBack={onBack} embedded active={false} />);
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    key('ArrowDown'); key('Enter'); key('ArrowLeft');
    expect(behind).toHaveBeenCalledTimes(3);
    expect(onBack).toHaveBeenCalledTimes(2);
    expect(focusedRow()).toBeUndefined(); // no highlight drawn on an inactive page
    window.removeEventListener('keydown', behind);
  });

  it('on its own: a Back button at the top, reached with Left; OK on it goes back', async () => {
    const { onBack } = await renderPanel({ embedded: false });
    expect(focusedRow()).toBe('all');
    key('ArrowLeft');
    expect(document.querySelector('[data-focus-id="back"]')?.getAttribute('data-focused')).toBe('true');
    key('Enter');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('not the owner (403): says only the owner can message its devices', async () => {
    h.reply = () => httpError(403, { ok: false, reason: 'not_owner' });
    await renderPanel();
    expect(document.querySelector('[data-line-devices="not_owner"]')?.textContent).toBe("Only this line's owner can message its devices.");
    expect(document.querySelector('[data-row]')).toBeNull();
  });

  it('not signed in (401): explains that signing in to the owning account lets you message them', async () => {
    h.reply = () => httpError(401, { ok: false, reason: 'not_signed_in' });
    await renderPanel();
    expect(document.querySelector('[data-line-devices="not_signed_in"]')?.textContent)
      .toBe('Sign in to the Snow Media account that owns this line to message its devices.');
    // The admin screen never offers support's way.
    expect(h.calls.map((c) => c.action)).toEqual(['devices']);
  });

  it('a TV on a line with no email on file: the messages without the list, and Send files them with support', async () => {
    h.reply = (b) => {
      if (b.action === 'devices') return httpError(401, { ok: false, reason: 'not_signed_in' });
      if (b.action === 'owner_status') return { data: { ok: true, email_on_file: false }, error: null };
      if (b.action === 'support_request') return { data: { ok: true }, error: null };
      return undefined;
    };
    await renderPanel({ viaSupport: true });
    expect(document.querySelector('[data-line-devices="support"]')).toBeTruthy();
    expect(screen.getByText(/This line has no email on file/)).toBeTruthy();
    expect(h.calls.find((c) => c.action === 'owner_status')).toMatchObject({ host: HOST, username: 'jsmith', inbox_key: expect.stringMatching(/^[A-Za-z0-9]{48}$/) });
    expect(document.querySelector('[data-row^="dev:"], [data-row="all"]')).toBeNull();
    expect(focusedRow()).toBe('quick:0');

    key('ArrowDown'); key('Enter'); // "Please switch to the other account."
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(focusedRow()).toBe('send');
    expect(document.querySelector('[data-row="send"]')?.textContent).toBe('Send to support');
    key('Enter');
    await until(() => !!document.querySelector('[data-send-result]'));
    expect(h.calls.filter((c) => c.action === 'support_request')).toEqual([{
      action: 'support_request', inbox_key: expect.stringMatching(/^[A-Za-z0-9]{48}$/), host: HOST, username: 'jsmith', password: 'pw-1', body: 'Please switch to the other account.',
    }]);
    expect(sends()).toEqual([]);
    expect(document.querySelector('[data-send-result="ok"]')?.textContent).toBe("Sent to support. They'll pass it on to the TVs on this line.");
    // Sent once: a second OK on Send files nothing more.
    key('Enter');
    await settle(50);
    expect(h.calls.filter((c) => c.action === 'support_request')).toHaveLength(1);
    expect(document.querySelector('[data-send-result]')?.textContent).toBe('Pick a message or write your own.');
  });

  it('a TV on a line with an email on file: the sign-in line, nothing for support', async () => {
    h.reply = (b) => {
      if (b.action === 'devices') return httpError(403, { ok: false, reason: 'not_owner' });
      if (b.action === 'owner_status') return { data: { ok: true, email_on_file: true }, error: null };
      return undefined;
    };
    await renderPanel({ viaSupport: true });
    expect(document.querySelector('[data-line-devices="not_owner"]')).toBeTruthy();
    expect(document.querySelector('[data-row]')).toBeNull();
  });

  it('a TV that can\'t tell whether the line has an email (not registered there yet): Try again, not "sign in"', async () => {
    h.reply = (b) => (b.action === 'devices' ? httpError(401, { ok: false, reason: 'not_signed_in' })
      : b.action === 'owner_status' ? { data: { ok: false, reason: 'unknown_key' }, error: null } : undefined);
    await renderPanel({ viaSupport: true });
    expect(document.querySelector('[data-line-devices="not_signed_in"]')).toBeNull();
    expect(screen.getByText("Couldn't load the devices.")).toBeTruthy();
    expect(focusedRow()).toBe('retry');
  });

  it('a failed load offers Try again', async () => {
    h.reply = () => { throw new Error('offline'); };
    await renderPanel();
    expect(screen.getByText("Couldn't load the devices.")).toBeTruthy();
    expect(focusedRow()).toBe('retry');
    h.reply = (b) => (b.action === 'devices' ? { data: { ok: true, devices: DEVICES }, error: null } : undefined);
    key('Enter');
    await until(() => !!document.querySelector('[data-line-devices="ready"]'));
    expect(focusedRow()).toBe('all');
  });
});
