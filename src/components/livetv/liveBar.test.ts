import { describe, expect, it } from 'vitest';
import { liveBarDisabled, liveBarLabel, liveBarOrder, moveBarFocus, type BarControlId } from './liveBar';

const noChoice = { subtitles: 0, audios: 1 };

describe('the live bar buttons', () => {
  it('plain: exactly the bar Snow Media Center always had, Stats last', () => {
    expect(liveBarOrder({ rewind: false, record: false }))
      .toEqual(['prev', 'rew', 'play', 'fwd', 'next', 'report', 'cc', 'audio', 'vol', 'stats']);
  });

  it('rewind on: Go live joins after Forward 10s', () => {
    expect(liveBarOrder({ rewind: true, record: false }))
      .toEqual(['prev', 'rew', 'play', 'fwd', 'golive', 'next', 'report', 'cc', 'audio', 'vol', 'stats']);
  });

  it('rewind and record: the full row is 12 buttons, Report right after Record, Stats last', () => {
    const order = liveBarOrder({ rewind: true, record: true });
    expect(order).toEqual(['prev', 'rew', 'play', 'fwd', 'golive', 'next', 'rec', 'report', 'cc', 'audio', 'vol', 'stats']);
    expect(order).toHaveLength(12);
    expect(order[order.length - 1]).toBe('stats');
  });

  it('record without rewind: Record follows Next channel', () => {
    expect(liveBarOrder({ rewind: false, record: true }))
      .toEqual(['prev', 'rew', 'play', 'fwd', 'next', 'rec', 'report', 'cc', 'audio', 'vol', 'stats']);
  });

  it('no id repeats', () => {
    const order = liveBarOrder({ rewind: true, record: true });
    expect(new Set(order).size).toBe(order.length);
  });
});

describe('which buttons are greyed out', () => {
  it('back / forward need a stream that seeks, unless rewind is on', () => {
    expect(liveBarDisabled('rew', { seekable: false, rewind: false, ...noChoice })).toBe(true);
    expect(liveBarDisabled('fwd', { seekable: false, rewind: false, ...noChoice })).toBe(true);
    expect(liveBarDisabled('rew', { seekable: true, rewind: false, ...noChoice })).toBe(false);
    expect(liveBarDisabled('rew', { seekable: false, rewind: true, ...noChoice })).toBe(false);
    expect(liveBarDisabled('fwd', { seekable: false, rewind: true, ...noChoice })).toBe(false);
  });

  it('subtitles need a track, audio needs a choice, the rest are always on', () => {
    const s = { seekable: false, rewind: true };
    expect(liveBarDisabled('cc', { ...s, subtitles: 0, audios: 3 })).toBe(true);
    expect(liveBarDisabled('cc', { ...s, subtitles: 2, audios: 3 })).toBe(false);
    expect(liveBarDisabled('audio', { ...s, subtitles: 2, audios: 1 })).toBe(true);
    expect(liveBarDisabled('audio', { ...s, subtitles: 2, audios: 2 })).toBe(false);
    for (const id of ['prev', 'play', 'next', 'rec', 'report', 'vol', 'stats', 'golive'] as BarControlId[]) {
      expect(liveBarDisabled(id, { ...s, ...noChoice })).toBe(false);
    }
  });
});

describe('the ◀ ▶ steps', () => {
  const order = liveBarOrder({ rewind: true, record: true });
  const off = (id: BarControlId) => liveBarDisabled(id, { seekable: false, rewind: true, ...noChoice });

  it('steps along the row and stops at both ends', () => {
    expect(moveBarFocus(order, 'play', 1, off)).toBe('fwd');
    expect(moveBarFocus(order, 'play', -1, off)).toBe('rew');
    expect(moveBarFocus(order, 'prev', -1, off)).toBe('prev');
    expect(moveBarFocus(order, 'stats', 1, off)).toBe('stats');
  });

  it('skips greyed-out buttons (no subtitles, one audio track)', () => {
    expect(moveBarFocus(order, 'rec', 1, off)).toBe('report');
    expect(moveBarFocus(order, 'report', 1, off)).toBe('vol');
    expect(moveBarFocus(order, 'vol', -1, off)).toBe('report');
  });

  it('a highlight on a button no longer in the row lands on Play', () => {
    const plain = liveBarOrder({ rewind: false, record: false });
    expect(moveBarFocus(plain, 'golive', 1, off)).toBe('play');
    expect(moveBarFocus(plain, 'rec', -1, off)).toBe('play');
  });
});

describe('button names', () => {
  it('rewind and record', () => {
    const base = { isPaused: false };
    expect(liveBarLabel('golive', base)).toBe('Go live');
    expect(liveBarLabel('rec', base)).toBe('Record');
    expect(liveBarLabel('rec', { ...base, recording: true })).toBe('Stop recording');
    expect(liveBarLabel('report', base)).toBe('Report channel');
    expect(liveBarLabel('rew', base)).toBe('Back 10s');
    expect(liveBarLabel('fwd', base)).toBe('Forward 10s');
  });

  it('the old ones', () => {
    expect(liveBarLabel('play', { isPaused: true })).toBe('Play');
    expect(liveBarLabel('play', { isPaused: false })).toBe('Pause');
    expect(liveBarLabel('prev', { isPaused: false })).toBe('Previous channel');
    expect(liveBarLabel('next', { isPaused: false })).toBe('Next channel');
    expect(liveBarLabel('stats', { isPaused: false, statsOn: true })).toBe('Hide stats');
    expect(liveBarLabel('stats', { isPaused: false })).toBe('Stats');
  });

  it('the volume button carries the level', () => {
    expect(liveBarLabel('vol', { isPaused: false, volumePct: 60 })).toBe('Volume 60%');
    expect(liveBarLabel('vol', { isPaused: false, volumePct: 149.6 })).toBe('Volume 150%');
    expect(liveBarLabel('vol', { isPaused: false })).toBe('Volume');
  });
});
