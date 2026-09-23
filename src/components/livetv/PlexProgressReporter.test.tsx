import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saves: Array<{ key: string; at: number; final: boolean }> = [];
vi.mock('@/lib/plexProgress', () => ({
  saveProgress: vi.fn((p: { ratingKey: string; at: number }, final = false) => { saves.push({ key: p.ratingKey, at: p.at, final }); }),
}));

let position = 100;
const getPosition = async () => ({ position, duration: 1800, playing: true });
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const info = (key: string) => ({ ratingKey: key, kind: 'movie' as const, title: 'T', markers: [] });

beforeEach(() => { vi.useFakeTimers(); saves.length = 0; position = 100; });
afterEach(() => { vi.useRealTimers(); });

describe('PlexProgressReporter', () => {
  it('saves every fifteen seconds and a final save when the title changes or the player closes', async () => {
    const { default: Reporter } = await import('./PlexProgressReporter');
    const ui = (key: string | null) => <Reporter active ratingKey={key} info={key ? info(key) : null} getPosition={getPosition} />;
    const r = render(ui('11'));
    await flush();
    expect(saves).toEqual([{ key: '11', at: 100, final: false }]);
    position = 115;
    await flush(15_000);
    expect(saves[1]).toEqual({ key: '11', at: 115, final: false });
    r.rerender(ui('12'));
    await flush();
    expect(saves).toContainEqual({ key: '11', at: 115, final: true });
    r.rerender(ui(null));
    await flush();
    expect(saves[saves.length - 1]).toEqual({ key: '12', at: 115, final: true });
  });

  it('saves nothing until it knows what is playing', async () => {
    const { default: Reporter } = await import('./PlexProgressReporter');
    render(<Reporter active ratingKey="11" info={null} getPosition={getPosition} />);
    await flush(30_000);
    expect(saves).toEqual([]);
  });
});
