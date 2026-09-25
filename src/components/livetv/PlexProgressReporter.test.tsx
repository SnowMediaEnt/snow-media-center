import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saves: Array<{ key: string; at: number; final: boolean }> = [];
let lastDur = 0;
let lastSaved: Record<string, unknown> | null = null;
/** What the Continue Watching check in Plex Settings would read. */
let diag: Record<string, unknown> = {};
let diagWrites = 0;
vi.mock('@/lib/plexProgress', () => ({
  saveProgress: vi.fn((p: { ratingKey: string; at: number; dur: number }, final = false) => { saves.push({ key: p.ratingKey, at: p.at, final }); lastDur = p.dur; lastSaved = { ...p }; }),
  noteProgressDiag: vi.fn((patch: Record<string, unknown>) => { diag = { ...diag, ...patch }; diagWrites += 1; }),
}));

let position = 100;
const getPosition = async () => ({ position, duration: 1800, playing: true });
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const info = (key: string) => ({ ratingKey: key, kind: 'movie' as const, title: 'T', markers: [] });

beforeEach(() => { vi.useFakeTimers(); saves.length = 0; position = 100; lastSaved = null; diag = {}; diagWrites = 0; });
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
    // Took over the player while it was up (Up Next): not read in that
    // moment, when the playhead is still the last title's.
    expect(saves.some((x) => x.key === '12')).toBe(false);
    position = 20;
    await flush(5_000);
    expect(saves[saves.length - 1]).toEqual({ key: '12', at: 20, final: false });
    r.rerender(ui(null));
    await flush();
    expect(saves[saves.length - 1]).toEqual({ key: '12', at: 20, final: true });
  });

  it('saves nothing until it knows what is playing', async () => {
    const { default: Reporter } = await import('./PlexProgressReporter');
    render(<Reporter active ratingKey="11" info={null} getPosition={getPosition} />);
    await flush(30_000);
    expect(saves).toEqual([]);
  });

  it('uses the server\'s running time while the player does not know it yet', async () => {
    const { default: Reporter } = await import('./PlexProgressReporter');
    const noDuration = async () => ({ position: 700, duration: 0, playing: true });
    render(<Reporter active ratingKey="11" info={{ ...info('11'), duration: 5400 }} getPosition={noDuration} />);
    await flush();
    expect(saves).toEqual([{ key: '11', at: 700, final: false }]);
    expect(lastDur).toBe(5400);
  });

  it('trusts the server\'s running time over a converted stream\'s, which only reaches just past the playhead', async () => {
    const { default: Reporter } = await import('./PlexProgressReporter');
    // 25 minutes into a 1 h 52 min film; the transcode's playlist so far ends 20 s ahead.
    const growing = async () => ({ position: 1500, duration: 1520, playing: true });
    render(<Reporter active ratingKey="11" info={{ ...info('11'), duration: 6720 }} getPosition={growing} />);
    await flush();
    expect(saves).toEqual([{ key: '11', at: 1500, final: false }]);
    expect(lastDur).toBe(6720);
  });

  it('leaves out what it does not know, so a save never wipes the library or show saved before', async () => {
    const { default: Reporter } = await import('./PlexProgressReporter');
    // What Play knew of an episode opened from a rail: no show key, no library.
    const partial = { ratingKey: '11', kind: 'episode' as const, title: 'The Long Night', showTitle: 'Frontier', seasonIndex: 2, index: 3, markers: [] };
    render(<Reporter active ratingKey="11" info={partial} getPosition={getPosition} />);
    await flush();
    expect(lastSaved).toEqual({ ratingKey: '11', kind: 'episode', title: 'The Long Night', at: 100, dur: 1800, showTitle: 'Frontier', season: 2, index: 3 });
    // saveProgress merges into the saved entry: a key present as undefined wipes it.
    expect(Object.keys(lastSaved ?? {})).not.toContain('librarySectionID');
    expect(Object.keys(lastSaved ?? {})).not.toContain('showKey');
  });

  it('notes each beat for the Continue Watching check: what the player said, and why nothing was saved', async () => {
    const { default: Reporter } = await import('./PlexProgressReporter');
    let pos = { position: 1510, duration: 6720, playing: true };
    const read = async () => ({ ...pos });
    render(<Reporter active ratingKey="11" info={info('11')} getPosition={read} />);
    await flush();
    expect(diag).toMatchObject({ beatPos: 1510, beatDur: 6720 });
    expect(diag.beatSkip).toBeUndefined();
    expect(typeof diag.beatAt).toBe('number');
    // One write per beat.
    expect(diagWrites).toBe(1);
    pos = { position: 0, duration: 6720, playing: false };
    await flush(15_000);
    expect(diag).toMatchObject({ beatPos: 0, beatSkip: 'no-position' });
    pos = { position: 300, duration: 0, playing: true };
    await flush(15_000);
    expect(diag).toMatchObject({ beatPos: 300, beatDur: 0, beatSkip: 'no-duration' });
    expect(diagWrites).toBe(3);
  });

  it('notes a title that is known while the player is not playing it', async () => {
    const { default: Reporter } = await import('./PlexProgressReporter');
    render(<Reporter active={false} ratingKey="11" info={info('11')} getPosition={getPosition} />);
    await flush();
    expect(diag).toMatchObject({ beatSkip: 'inactive' });
    expect(saves).toEqual([]);
  });

  it('notes when the player closes, and whether the title was known and playing until then', async () => {
    const { default: Reporter } = await import('./PlexProgressReporter');
    const ui = (key: string | null, i: ReturnType<typeof info> | null) => <Reporter active={!!key} ratingKey={key} info={i} getPosition={getPosition} />;
    const r = render(ui('11', info('11')));
    await flush();
    // Closing clears the title and the player in one go; what counts is how
    // it was before.
    r.rerender(ui(null, null));
    await flush();
    expect(diag).toMatchObject({ closedKnown: true, closedActive: true });
    expect(typeof diag.closedAt).toBe('number');
    // A title that was never named.
    r.rerender(ui('12', null));
    await flush();
    r.rerender(ui(null, null));
    await flush();
    expect(diag).toMatchObject({ closedKnown: false, closedActive: true });
  });
});
