import { describe, expect, it, vi } from 'vitest';
import { createSkipQueue, MEDIA_SKIP_SEC } from './skipQueue';
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
