import { describe, expect, it, vi } from 'vitest';
import { createSeekSkipper, createSkipQueue, MEDIA_SKIP_SEC } from './skipQueue';
import { MEDIA_KEY_EVENT, onMediaKey, type MediaKey } from './mediaKeys';

// Rewind / Fast-forward on the remote: 10 s a press; held, the repeats are
// added up while the player is busy, so none is lost and no two run at once.
describe('createSkipQueue', () => {
  it('one press is one 10 s step', async () => {
    const run = vi.fn(async () => {});
    const q = createSkipQueue(run);
    q.push(-MEDIA_SKIP_SEC);
    await Promise.resolve();
    expect(MEDIA_SKIP_SEC).toBe(10);
    expect(run).toHaveBeenCalledWith(-10);
  });

  it('a held key: steps that arrive while one runs are sent together, never two at once', async () => {
    let release: () => void = () => {};
    let running = 0;
    let most = 0;
    const run = vi.fn(() => new Promise<void>((r) => {
      running++; most = Math.max(most, running);
      release = () => { running--; r(); };
    }));
    const q = createSkipQueue(run);
    q.push(10);
    q.push(10); q.push(10); q.push(10);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1]).toEqual([30]);
    release();
    await Promise.resolve();
    expect(most).toBe(1);
  });

  it('clear drops steps not yet sent (a channel change)', async () => {
    let release: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const q = createSkipQueue(run);
    q.push(-10); q.push(-10);
    q.clear();
    release();
    await Promise.resolve(); await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('createSeekSkipper', () => {
  const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

  it('three quick ◀ are 30 s back, though the player still reports the old spot', async () => {
    let t = 1000;
    const getPosition = vi.fn(async () => ({ position: 600, duration: 3600 }));
    const seeks: number[] = [];
    const landed = vi.fn();
    const q = createSeekSkipper(getPosition, async (s) => { seeks.push(s); }, landed, () => t);
    q.push(-10);
    await flush();
    t += 400; q.push(-10);
    await flush();
    t += 400; q.push(-10);
    await flush();
    expect(seeks).toEqual([590, 580, 570]);
    expect(getPosition).toHaveBeenCalledTimes(1);
    expect(landed).toHaveBeenLastCalledWith(570, 3600, -10);
  });

  it('reads the player again once it has settled, and stays inside the film', async () => {
    let t = 0;
    let pos = 5;
    const seeks: number[] = [];
    const q = createSeekSkipper(async () => ({ position: pos, duration: 100 }), async (s) => { seeks.push(s); }, undefined, () => t);
    q.push(-10);
    await flush();
    t += 5000; pos = 95;
    q.push(30);
    await flush();
    expect(seeks).toEqual([0, 99]);
  });

  it('presses that come while a jump is running are added up into one', async () => {
    let release: () => void = () => {};
    const seeks: number[] = [];
    const q = createSeekSkipper(async () => ({ position: 300, duration: 0 }), (s) => { seeks.push(s); return new Promise<void>((r) => { release = r; }); });
    q.push(-10);
    await flush();
    q.push(-10); q.push(-10);
    release();
    await flush();
    release();
    await flush();
    expect(seeks).toEqual([290, 270]);
  });
});

describe('onMediaKey', () => {
  it('CH+ / CH- arrive as their own keys (channel change), Rewind / Fast-forward as rw / ff', () => {
    const got: MediaKey[] = [];
    const off = onMediaKey((k) => got.push(k));
    for (const d of ['chup', 'chdown', 'rw', 'ff']) window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: d }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ChannelUp' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'MediaRewind' }));
    off();
    expect(got).toEqual(['chup', 'chdown', 'rw', 'ff', 'chup', 'rw']);
  });
});
