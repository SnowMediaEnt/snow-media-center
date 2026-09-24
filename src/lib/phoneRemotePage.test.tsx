import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// The phone page (web/phone-remote/PhoneRemotePage.tsx, served on the
// website) against a fake Realtime server and phone-remote function.
const h = vi.hoisted(() => {
  type Sub = (s: string) => void;
  type Chan = { topic: string; sent: Array<Record<string, unknown>>; box?: (m: { payload: unknown }) => void; sub?: Sub };
  const clients: Array<{ channels: Chan[]; closed: boolean }> = [];
  const calls: Array<Record<string, unknown>> = [];
  const replies: { fn: (body: Record<string, unknown>) => Record<string, unknown> } = { fn: () => ({ ok: true, exists: true }) };
  class RealtimeClient {
    rec = { channels: [] as Chan[], closed: false };
    constructor() { clients.push(this.rec); }
    channel(topic: string) {
      const c: Chan = { topic, sent: [] };
      this.rec.channels.push(c);
      const api = {
        on: (_t: string, _f: unknown, fn: (m: { payload: unknown }) => void) => { c.box = fn; return api; },
        subscribe: (cb: Sub) => { c.sub = cb; return api; },
        send: (m: { payload: Record<string, unknown> }) => { c.sent.push(m.payload); return Promise.resolve('ok'); },
      };
      return api;
    }
    removeAllChannels() { return Promise.resolve([]); }
    disconnect() { this.rec.closed = true; }
  }
  const createClient = () => ({
    functions: { invoke: async (_n: string, o: { body: Record<string, unknown> }) => { calls.push(o.body); return { data: replies.fn(o.body), error: null }; } },
  });
  return { clients, calls, replies, RealtimeClient, createClient };
});
vi.mock('@supabase/supabase-js', () => ({ RealtimeClient: h.RealtimeClient, createClient: h.createClient }));

import PhoneRemotePage from '../../web/phone-remote/PhoneRemotePage';

const SECRET = 'd'.repeat(64);
const pairing = { secret: SECRET, label: 'Living Room', id: 'phone1' };
const chan = () => h.clients[h.clients.length - 1].channels[0];
const sent = () => chan().sent;
const fromBox = (payload: Record<string, unknown>) => act(() => { chan().box!({ payload }); });
const status = (s: string) => act(() => { chan().sub!(s); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

// A stand-in for the browser's speech recognition.
class FakeSpeech {
  static last: FakeSpeech | null = null;
  static failStart = false;
  lang = ''; interimResults = false; continuous = false; maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  started = false; aborted = false;
  constructor() { FakeSpeech.last = this; }
  start() { if (FakeSpeech.failStart) throw new Error('InvalidStateError'); this.started = true; }
  stop() { this.aborted = true; }
  abort() { this.aborted = true; }
  say(text: string, isFinal: boolean) { this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal })] }); }
}

beforeEach(() => {
  vi.useFakeTimers();
  h.clients.length = 0;
  h.calls.length = 0;
  h.replies.fn = () => ({ ok: true, exists: true });
  localStorage.clear();
  window.history.replaceState(null, '', '/remote');
  FakeSpeech.last = null;
  FakeSpeech.failStart = false;
  (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeSpeech;
});
afterEach(() => { vi.useRealTimers(); delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition; });

describe('the phone remote page: the channel', () => {
  it('holds presses until the channel is up, then sends hello and them', async () => {
    localStorage.setItem('smc-phone-remote', JSON.stringify(pairing));
    render(<PhoneRemotePage />);
    fireEvent.click(screen.getByText('Back'));
    expect(sent()).toEqual([]);
    status('SUBSCRIBED');
    expect(sent().map((p) => p.t)).toEqual(['hello', 'key']);
    expect(sent()[1]).toMatchObject({ k: 'back', id: 'phone1' });
  });

  it('starts over on a new connection after the channel drops, and sends what was pressed meanwhile', async () => {
    localStorage.setItem('smc-phone-remote', JSON.stringify(pairing));
    render(<PhoneRemotePage />);
    status('SUBSCRIBED');
    status('CHANNEL_ERROR');
    fireEvent.click(screen.getByText('Home'));
    await act(async () => { vi.advanceTimersByTime(3500); });
    expect(h.clients.length).toBeGreaterThanOrEqual(2);
    expect(h.clients[0].closed).toBe(true);
    status('SUBSCRIBED');
    expect(sent().map((p) => p.t)).toEqual(['hello', 'home']);
  });

  it('back on screen with no answer from the TV: a fresh connection', async () => {
    localStorage.setItem('smc-phone-remote', JSON.stringify(pairing));
    render(<PhoneRemotePage />);
    status('SUBSCRIBED');
    const before = h.clients.length;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { vi.advanceTimersByTime(4500); });
    expect(h.clients.length).toBe(before + 1);
  });

  it('a TV that forgot this phone sends it back to pairing', async () => {
    localStorage.setItem('smc-phone-remote', JSON.stringify(pairing));
    h.replies.fn = (b) => (b.op === 'check' ? { ok: true, exists: false } : { ok: true });
    render(<PhoneRemotePage />);
    await flush();
    expect(screen.getByText(/This TV unpaired its phones/)).toBeTruthy();
    expect(localStorage.getItem('smc-phone-remote')).toBeNull();
  });

  it('a text box on the TV lights up the keyboard but never opens it by itself; a hello reply keeps what is typed', async () => {
    localStorage.setItem('smc-phone-remote', JSON.stringify(pairing));
    render(<PhoneRemotePage />);
    status('SUBSCRIBED');
    fromBox({ t: 'field', typing: true, value: 'bat', password: false, label: 'Search', why: 'focus' });
    expect(screen.queryByPlaceholderText('Type here')).toBeNull();
    fireEvent.click(screen.getByText(/A text box is open on the TV/));
    const input = screen.getByPlaceholderText('Type here') as HTMLInputElement;
    expect(input.value).toBe('bat');
    fireEvent.change(input, { target: { value: 'batm' } });
    fromBox({ t: 'field', typing: true, value: 'bat', password: false, label: 'Search', why: 'hello' });
    expect(input.value).toBe('batm');
  });
});

describe('the phone remote page: voice', () => {
  const mic = () => screen.getByText(/Voice|Listening/).closest('button')!;

  it('a second tap stops listening and sends what was heard', async () => {
    localStorage.setItem('smc-phone-remote', JSON.stringify(pairing));
    render(<PhoneRemotePage />);
    status('SUBSCRIBED');
    fireEvent.click(mic());
    expect(screen.getByText(/Listening/)).toBeTruthy();
    act(() => { FakeSpeech.last!.say('play espn', false); });
    fireEvent.click(mic());
    expect(screen.queryByText(/Listening/)).toBeNull();
    expect(FakeSpeech.last!.aborted).toBe(true);
    expect(sent().filter((p) => p.t === 'voice')).toEqual([{ t: 'voice', v: 'play espn', id: 'phone1' }]);
    // And it works again the second time.
    fireEvent.click(mic());
    act(() => { FakeSpeech.last!.say('open settings', true); });
    expect(sent().filter((p) => p.t === 'voice').map((p) => p.v)).toEqual(['play espn', 'open settings']);
    expect(screen.queryByText(/Listening/)).toBeNull();
  });

  it('never stays on "Listening" when the browser never ends the session', async () => {
    localStorage.setItem('smc-phone-remote', JSON.stringify(pairing));
    render(<PhoneRemotePage />);
    status('SUBSCRIBED');
    fireEvent.click(mic());
    await act(async () => { vi.advanceTimersByTime(10_500); });
    expect(screen.queryByText(/Listening/)).toBeNull();
    expect(screen.getByText(/Didn't catch that/)).toBeTruthy();
  });

  it('a pause after words sends them (Safari may never mark them final)', async () => {
    localStorage.setItem('smc-phone-remote', JSON.stringify(pairing));
    render(<PhoneRemotePage />);
    status('SUBSCRIBED');
    fireEvent.click(mic());
    act(() => { FakeSpeech.last!.say('find batman', false); });
    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(sent().filter((p) => p.t === 'voice').map((p) => p.v)).toEqual(['find batman']);
  });

  it('says why when the mic is blocked or won\'t start, and is ready again', async () => {
    localStorage.setItem('smc-phone-remote', JSON.stringify(pairing));
    render(<PhoneRemotePage />);
    status('SUBSCRIBED');
    fireEvent.click(mic());
    act(() => { FakeSpeech.last!.onerror?.({ error: 'not-allowed' }); });
    expect(screen.getByText(/microphone is blocked/)).toBeTruthy();
    FakeSpeech.failStart = true;
    fireEvent.click(mic());
    expect(screen.getByText(/Couldn't start the microphone/)).toBeTruthy();
    expect(screen.queryByText(/Listening/)).toBeNull();
  });

  it('voice said while the channel is reconnecting is sent once it is back', async () => {
    localStorage.setItem('smc-phone-remote', JSON.stringify(pairing));
    render(<PhoneRemotePage />);
    status('SUBSCRIBED');
    status('TIMED_OUT');
    fireEvent.click(mic());
    act(() => { FakeSpeech.last!.say('play cnn', true); });
    await act(async () => { vi.advanceTimersByTime(3500); });
    status('SUBSCRIBED');
    expect(sent().filter((p) => p.t === 'voice').map((p) => p.v)).toEqual(['play cnn']);
  });
});

describe('the phone remote page: pairing', () => {
  it('a QR link while already paired asks before switching TVs', async () => {
    localStorage.setItem('smc-phone-remote', JSON.stringify(pairing));
    window.history.replaceState(null, '', '/remote?c=BCDFGHJK');
    render(<PhoneRemotePage />);
    expect(screen.getByText('Pair with a different TV?')).toBeTruthy();
    expect(h.calls).toEqual([]);
    fireEvent.click(screen.getByText(/Keep using/));
    expect(screen.getByText('Living Room')).toBeTruthy();
  });

  it('a right code waits for the TV to allow it, then becomes the remote', async () => {
    window.history.replaceState(null, '', '/remote?c=bcdf-ghjk');
    let allowed = false;
    h.replies.fn = (b) => {
      if (b.op === 'join') return { ok: true, pending: true, token: 'e'.repeat(32), label: 'Den TV' };
      if (b.op === 'claim') return allowed ? { ok: true, secret: SECRET, label: 'Den TV' } : { ok: true, pending: true };
      return { ok: true, exists: true };
    };
    render(<PhoneRemotePage />);
    await flush();
    expect(h.calls[0]).toEqual({ op: 'join', code: 'BCDFGHJK' });
    expect(screen.getByText('Almost there')).toBeTruthy();
    allowed = true;
    await act(async () => { vi.advanceTimersByTime(2600); });
    await flush();
    expect(screen.getByText('Den TV')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('smc-phone-remote')!).secret).toBe(SECRET);
  });

  it('says so when the TV turns the phone away', async () => {
    window.history.replaceState(null, '', '/remote?c=BCDFGHJK');
    h.replies.fn = (b) => (b.op === 'join' ? { ok: true, pending: true, token: 'e'.repeat(32), label: 'Den TV' } : { ok: false, reason: 'denied' });
    render(<PhoneRemotePage />);
    await flush();
    await flush();
    expect(screen.getByText(/didn't allow this phone/)).toBeTruthy();
  });
});
