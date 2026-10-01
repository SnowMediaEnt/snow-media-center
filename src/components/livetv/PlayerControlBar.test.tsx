/**
 * The live bar's buttons (TRACKER 25): the name of the highlighted button, and
 * only that one, is shown under it. Every button has the line, so the row
 * doesn't jump; the others hide it (invisible).
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PlayerControlBar from './PlayerControlBar';
import { liveBarOrder, type BarControlId } from './liveBar';

const bar = (over: Partial<Parameters<typeof PlayerControlBar>[0]> = {}) => (
  <PlayerControlBar
    visible
    order={liveBarOrder({ record: true })}
    focus="play"
    isPaused={false}
    controller={null}
    tracksTick={0}
    channelName="News One"
    subMenuOpen={false}
    audioMenuOpen={false}
    subMenuFocus={-1}
    audioMenuFocus={0}
    volMenuOpen={false}
    volume={0.6}
    {...over}
  />
);

const names = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-bar-control]')).map((col) => {
  const span = col.querySelector('[data-bar-name]')!;
  return { id: col.getAttribute('data-bar-control'), text: span.textContent, hidden: span.className.includes('invisible') };
});
const shown = (c: HTMLElement) => names(c).filter((n) => !n.hidden);

describe('the name under the highlighted button', () => {
  it('shows one name, the focused button\'s, and hides the rest', () => {
    const { container } = render(bar({ focus: 'fwd' }));
    expect(shown(container)).toEqual([{ id: 'fwd', text: 'Forward 10s', hidden: false }]);
    // Every button keeps its line (hidden), so the row never jumps.
    expect(names(container)).toHaveLength(12);
    expect(container.querySelectorAll('[data-bar-name]')).toHaveLength(12);
  });

  it('moves with the highlight', () => {
    const { container, rerender } = render(bar({ focus: 'golive' }));
    expect(shown(container).map((n) => n.text)).toEqual(['Go live']);
    rerender(bar({ focus: 'stats' }));
    expect(shown(container).map((n) => n.text)).toEqual(['Stats']);
  });

  it('follows the button\'s state: Pause / Play, Stop recording, the volume level', () => {
    const { container, rerender } = render(bar({ focus: 'play', isPaused: false }));
    expect(shown(container)[0].text).toBe('Pause');
    rerender(bar({ focus: 'play', isPaused: true }));
    expect(shown(container)[0].text).toBe('Play');
    rerender(bar({ focus: 'rec', recording: false }));
    expect(shown(container)[0].text).toBe('Record');
    rerender(bar({ focus: 'rec', recording: true }));
    expect(shown(container)[0].text).toBe('Stop recording');
    rerender(bar({ focus: 'report' }));
    expect(shown(container)[0].text).toBe('Report channel');
    rerender(bar({ focus: 'vol', volume: 0.6 }));
    expect(shown(container)[0].text).toMatch(/^Volume \d+%$/);
  });

  it('a name never widens its column, and takes one small line', () => {
    const { container } = render(bar({ focus: 'prev' }));
    const col = container.querySelector('[data-bar-control="prev"]')!;
    const span = col.querySelector('[data-bar-name]')!;
    expect(col.className).toMatch(/\bw-12\b/);
    expect(span.className).toMatch(/whitespace-nowrap/);
    expect(span.className).toMatch(/\bh-4\b/);
    expect(span.className).toMatch(/leading-4/);
    expect(span.className).toMatch(/\bmt-1\b/);
    expect(span.className).toMatch(/text-sm|text-xs/);
    expect(container.querySelector('[data-bar-control="play"]')!.className).toMatch(/\bw-16\b/);
  });

  it('is aria-hidden: the buttons carry their own labels for screen readers', () => {
    const { container } = render(bar({ focus: 'next' }));
    for (const s of Array.from(container.querySelectorAll('[data-bar-name]'))) expect(s.getAttribute('aria-hidden')).toBe('true');
    const ids: BarControlId[] = ['prev', 'rew', 'play', 'fwd', 'golive', 'next', 'rec', 'report', 'cc', 'audio', 'vol', 'stats'];
    expect(Array.from(container.querySelectorAll('[data-bar-control]')).map((c) => c.getAttribute('data-bar-control'))).toEqual(ids);
  });

  it('has a Report button next to Record, before cc / audio / vol / stats, with a flag icon and its name', () => {
    const { container } = render(bar({ focus: 'report' }));
    const ids = Array.from(container.querySelectorAll('[data-bar-control]')).map((c) => c.getAttribute('data-bar-control'));
    expect(ids.slice(ids.indexOf('rec'), ids.indexOf('rec') + 3)).toEqual(['rec', 'report', 'cc']);
    const btn = container.querySelector('[data-bar-control="report"] button')!;
    expect(btn.getAttribute('aria-label')).toBe('Report channel');
    expect(btn.getAttribute('data-focused')).toBe('true');
    expect(btn.querySelector('svg')).toBeTruthy();
  });

  it('is on the plain bar too, Stats last', () => {
    const { container } = render(bar({ order: liveBarOrder({ record: false }), focus: 'stats' }));
    const ids = Array.from(container.querySelectorAll('[data-bar-control]')).map((c) => c.getAttribute('data-bar-control'));
    expect(ids[ids.length - 1]).toBe('stats');
    expect(shown(container)[0].text).toBe('Stats');
  });
});

describe('rewind coming on after the channel starts', () => {
  const ids = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-bar-control]')).map((n) => n.getAttribute('data-bar-control'));
  const focused = (c: HTMLElement) => c.querySelector('button[data-focused="true"]')?.closest('[data-bar-control]')?.getAttribute('data-bar-control');
  const goLive = (c: HTMLElement) => c.querySelector('[data-bar-control="golive"] button')!;

  it('keeps every button in its slot, Go live greyed out until then, and the highlight where it was', () => {
    // A few seconds in: no rewind yet, the viewer is on Record.
    const { container, rerender } = render(bar({ focus: 'rec', rewind: null }));
    const before = ids(container);
    expect(before).toEqual(['prev', 'rew', 'play', 'fwd', 'golive', 'next', 'rec', 'report', 'cc', 'audio', 'vol', 'stats']);
    expect(goLive(container).className).toMatch(/text-white\/30/);
    expect(focused(container)).toBe('rec');
    // Rewind comes on: the same row, Go live lights up, Record is still the one highlighted.
    rerender(bar({ focus: 'rec', rewind: { availableSec: 30, behindSec: 0, archiveDays: 0 } }));
    expect(ids(container)).toEqual(before);
    expect(goLive(container).className).not.toMatch(/text-white\/30/);
    expect(focused(container)).toBe('rec');
    expect(container.querySelectorAll('[data-bar-control]')[6].getAttribute('data-bar-control')).toBe('rec');
  });
});
