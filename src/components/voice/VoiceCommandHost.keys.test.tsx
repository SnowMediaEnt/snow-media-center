import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VoiceState } from '@/components/VoiceInput';
// Imported first, as Home does: the overlay's key listener is added before
// any screen's own.
import Host from './VoiceCommandHost';
import { openVoice } from '@/lib/voiceUi';
import { REMOTE_VOICE_EVENT } from '@/lib/phoneRemote';

let said = 'open settings';
let mic: { state?: (s: VoiceState) => void; error?: (t: string, d?: string) => void } = {};
vi.mock('@/components/VoiceInput', () => ({
  default: ({ onTranscription, onVoiceStateChange, onVoiceError }: {
    onTranscription: (t: string, c: unknown) => void;
    onVoiceStateChange?: (s: VoiceState) => void;
    onVoiceError?: (t: string, d?: string) => void;
  }) => {
    mic = { state: onVoiceStateChange, error: onVoiceError };
    return <button type="button" onClick={() => onTranscription(said, { setVoiceState() {}, restoreFocus() {}, cleanupAudio() {} })}>Voice</button>;
  },
}));
const invoke = vi.fn();
let session: { user: { id: string } } | null = null;
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: async () => ({}),
  },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));

const OK = { key: 'Enter', keyCode: 13 };
const press = (init: KeyboardEventInit & { keyCode?: number }, target: EventTarget = window) => {
  const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  const up = new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(down); });
  act(() => { target.dispatchEvent(up); });
  return down;
};
const overlay = () => document.querySelector('[aria-label="Voice"]');
const speak = async (text: string) => {
  said = text;
  await act(async () => { openVoice(); });
  await act(async () => { screen.getByText('Voice').click(); await Promise.resolve(); });
};

// Stands in for the Player: a capture listener on window, added when it
// opened (after the overlay's), that takes the keys it knows.
const player = { down: [] as string[], up: [] as string[] };
const playerDown = (e: KeyboardEvent) => { player.down.push(e.key); e.stopImmediatePropagation(); };
const playerUp = (e: KeyboardEvent) => { player.up.push(e.key); };

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  player.down = []; player.up = [];
  window.addEventListener('keydown', playerDown, true);
  window.addEventListener('keyup', playerUp, true);
  invoke.mockReset();
  invoke.mockResolvedValue({ data: { response: 'An answer.' }, error: null });
  session = null;
  vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({}) })));
});
afterEach(async () => {
  window.removeEventListener('keydown', playerDown, true);
  window.removeEventListener('keyup', playerUp, true);
  document.querySelectorAll('[data-test-popup]').forEach((n) => n.remove());
  (await import('@/lib/kidsFilter')).setKidsLevel(null);
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('VoiceCommandHost and the remote', () => {
  it('owns the remote over the Player while it is up', async () => {
    const navigate = vi.fn();
    render(<Host navigate={navigate} />);
    await act(async () => { openVoice(); });
    expect(overlay()).toBeTruthy();

    press({ key: 'ArrowDown', keyCode: 40 });
    press(OK);
    // Neither the arrow nor OK (down or up) reached the Player; OK on Close closed.
    expect(player.down).toEqual([]);
    expect(player.up).toEqual([]);
    expect(overlay()).toBeNull();

    // Closed: the keys are the Player's again.
    press(OK);
    expect(player.down).toEqual(['Enter']);
  });

  it('Back closes only the overlay', async () => {
    render(<Host navigate={vi.fn()} />);
    await act(async () => { openVoice(); });
    press({ key: 'Escape', keyCode: 27 });
    expect(overlay()).toBeNull();
    expect(player.down).toEqual([]);
  });

  it('takes the letter T for a letter, never for the Search key', async () => {
    render(<Host navigate={vi.fn()} />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const t = press({ key: 't', keyCode: 84 }, input);
    expect(t.defaultPrevented).toBe(false);
    expect(overlay()).toBeNull();
    // Nor '*', which some browsers send as 170 (BrowserSearch's code).
    expect(press({ key: '*', keyCode: 170 }, input).defaultPrevented).toBe(false);
    expect(overlay()).toBeNull();
    input.remove();

    const search = press({ key: 'BrowserSearch', keyCode: 170 });
    expect(search.defaultPrevented).toBe(true);
    expect(overlay()).toBeTruthy();
  });

  it('leaves the Search key alone while "Who\'s watching?" is up', () => {
    render(<Host navigate={vi.fn()} blocked />);
    const search = press({ key: 'BrowserSearch' });
    expect(search.defaultPrevented).toBe(false);
    expect(overlay()).toBeNull();
  });

  it('does not open over another popup, and yields to one that opens over it', async () => {
    render(<Host navigate={vi.fn()} />);
    const popup = document.createElement('div');
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('data-test-popup', '');
    document.body.appendChild(popup);
    await act(async () => { openVoice(); });
    expect(overlay()).toBeNull();

    popup.remove();
    await act(async () => { openVoice(); });
    expect(overlay()).toBeTruthy();
    document.body.appendChild(popup);
    press(OK);
    expect(player.down).toEqual(['Enter']);
    expect(overlay()).toBeTruthy();
  });

  it('says why the mic stopped instead of "Listening…" for good', async () => {
    render(<Host navigate={vi.fn()} />);
    await act(async () => { openVoice(); });
    expect(screen.getByText('Listening…')).toBeTruthy();
    act(() => { mic.error?.('Sign in to use voice', 'Voice input is a signed-in feature.'); mic.state?.('error'); });
    expect(screen.queryByText('Listening…')).toBeNull();
    expect(screen.getByText(/Sign in to use voice/)).toBeTruthy();
    // OK on the mic listens again.
    act(() => { mic.state?.('requesting_permission'); });
    expect(screen.getByText('Listening…')).toBeTruthy();
  });

  it('drops a slow answer to a command it has since closed', async () => {
    const navigate = vi.fn();
    let answer: (v: unknown) => void = () => {};
    invoke.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    render(<Host navigate={navigate} />);
    await speak('what is on tonight');
    press({ key: 'Escape', keyCode: 27 });
    await act(async () => { vi.advanceTimersByTime(400); });
    await act(async () => { openVoice(); });
    await act(async () => { answer({ data: { functionCall: { name: 'open_screen', arguments: { screen: 'settings' } } }, error: null }); await Promise.resolve(); });
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText('Listening…')).toBeTruthy();
  });

  it('falls back to Free when Premium was switched off after it was chosen', async () => {
    session = { user: { id: 'u1' } };
    localStorage.setItem('smc-ai-tier:chat', 'premium');
    const disabled = { context: new Response(JSON.stringify({ error: 'premium_disabled', message: 'Premium AI is not available right now.' })) };
    invoke.mockResolvedValueOnce({ data: null, error: disabled });
    render(<Host navigate={vi.fn()} />);
    await speak('what is on tonight');
    expect(await screen.findByText('An answer.')).toBeTruthy();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][1].body.tier).toBe('premium');
    expect(invoke.mock.calls[1][1].body.tier).toBeUndefined();
    expect(localStorage.getItem('smc-ai-tier:chat')).toBe('free');
  });

  it('never asks for Premium for a Kids profile', async () => {
    session = { user: { id: 'u1' } };
    localStorage.setItem('smc-ai-tier:chat', 'premium');
    (await import('@/lib/kidsFilter')).setKidsLevel('kids');
    render(<Host navigate={vi.fn()} />);
    await speak('what is a dinosaur');
    await screen.findByText('An answer.');
    expect(invoke.mock.calls[0][1].body.tier).toBeUndefined();
  });
});

describe('VoiceCommandHost and the phone remote', () => {
  const fromPhone = (heard: string) => act(async () => {
    window.dispatchEvent(new CustomEvent(REMOTE_VOICE_EVENT, { detail: heard }));
    await Promise.resolve();
  });

  it('runs one command at a time, and not faster than one every few seconds', async () => {
    const navigate = vi.fn();
    render(<Host navigate={navigate} />);
    await fromPhone('open settings');
    await fromPhone('open support');
    expect(navigate.mock.calls).toEqual([['settings']]);
    await act(async () => { vi.advanceTimersByTime(3100); });
    await fromPhone('open support');
    expect(navigate.mock.calls).toEqual([['settings'], ['support']]);
  });

  it('waits for a command still running, but not for good', async () => {
    invoke.mockImplementationOnce(() => new Promise(() => {}));
    const navigate = vi.fn();
    render(<Host navigate={navigate} />);
    await fromPhone('what is on tonight');
    await act(async () => { vi.advanceTimersByTime(3100); });
    await fromPhone('open support');
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(30000); });
    await fromPhone('open support');
    expect(navigate.mock.calls).toEqual([['support']]);
  });

  it('never spends Premium gems or makes a background on its own', async () => {
    session = { user: { id: 'u1' } };
    localStorage.setItem('smc-ai-tier:chat', 'premium');
    invoke.mockResolvedValueOnce({ data: { functionCall: { name: 'generate_wallpaper', arguments: { prompt: 'a beach at sunset' } } }, error: null });
    const navigate = vi.fn();
    render(<Host navigate={navigate} />);
    await fromPhone('make me a background of a beach at sunset');
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(invoke.mock.calls[0][1].body.tier).toBeUndefined();
    expect(sessionStorage.getItem('smc-wallpaper-prompt')).toBeNull();
    expect(sessionStorage.getItem('smc-wallpaper-draft')).toBe('a beach at sunset');
    expect(navigate).toHaveBeenCalledWith('settings');
  });
});
