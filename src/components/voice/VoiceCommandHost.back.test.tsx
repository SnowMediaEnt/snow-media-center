import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Imported first, as Home does: the overlay's key listener comes before the Player's.
import Host from './VoiceCommandHost';
import { openVoice, voiceOwnsBack } from '@/lib/voiceUi';

vi.mock('@/components/VoiceInput', () => ({ default: () => <button type="button">Voice</button> }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, functions: { invoke: vi.fn() }, rpc: async () => ({}) },
}));
// Capacitor's backButton listeners, called in turn as a hardware Back would.
const backs: Array<() => void> = [];
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_: string, fn: () => void) => {
      backs.push(fn);
      return { remove() { const i = backs.indexOf(fn); if (i >= 0) backs.splice(i, 1); } };
    },
  },
}));

// The Player: a capture keydown listener that takes the keys it knows, and a
// backButton listener that turns Back into an Escape keydown (LiveTV.tsx).
const player: string[] = [];
const playerKey = (e: KeyboardEvent) => { player.push(e.key); e.stopImmediatePropagation(); };
const playerBack = () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true })); };
const hardwareBack = () => act(async () => { for (const b of [...backs]) b(); });
const overlay = () => document.querySelector('[aria-label="Voice"]');

beforeEach(() => { player.length = 0; backs.length = 0; window.addEventListener('keydown', playerKey, true); });
afterEach(() => { window.removeEventListener('keydown', playerKey, true); });

describe('hardware Back while the overlay is up over the Player', () => {
  it.each([
    ['the overlay was listening first', false],
    ['the Player was listening first', true],
  ])('closes only the overlay (%s)', async (_, playerFirst) => {
    render(<Host navigate={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    if (playerFirst) backs.unshift(playerBack); else backs.push(playerBack);
    await act(async () => { openVoice(); });
    expect(overlay()).toBeTruthy();

    await hardwareBack();
    expect(overlay()).toBeNull();
    expect(player).toEqual([]);

    // The next press is the Player's again.
    await new Promise((r) => setTimeout(r, 400));
    await hardwareBack();
    expect(player).toEqual(['Escape']);
  });

  it.each([
    ['before', true],
    ['after', false],
  ])('a screen that acts on Back itself (the Guide) leaves it to the overlay, listening %s it', async (_, guideFirst) => {
    const guide: string[] = [];
    // GuideSection's backButton listener: asks voiceOwnsBack() first.
    const guideBack = () => { if (!voiceOwnsBack()) guide.push('back'); };
    render(<Host navigate={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    backs.unshift(playerBack);
    // First of all (the overlay is still up), or last (this press closed it).
    if (guideFirst) backs.unshift(guideBack); else backs.push(guideBack);
    await act(async () => { openVoice(); });

    await hardwareBack();
    expect(overlay()).toBeNull();
    expect(guide).toEqual([]);
    expect(player).toEqual([]);

    await new Promise((r) => setTimeout(r, 400));
    await hardwareBack();
    expect(guide).toEqual(['back']);
  });

  it('holding the Search key does not restart listening on every repeat', async () => {
    render(<Host navigate={vi.fn()} />);
    const search = (repeat: boolean) => act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'BrowserSearch', keyCode: 170, repeat, bubbles: true, cancelable: true }));
    });
    search(false);
    const mic = document.querySelector('[data-voice-mic] button');
    search(true); search(true);
    // Same mic (a restart mounts a new one).
    expect(document.querySelector('[data-voice-mic] button')).toBe(mic);
    expect(player).toEqual([]);
  });
});
