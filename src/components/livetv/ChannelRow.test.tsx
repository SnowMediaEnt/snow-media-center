import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ChannelRow from './ChannelRow';
import { formatTime } from '@/i18n/format';
import { NORMAL_ROW_H, SLIM_ROW_H } from '@/lib/liveRows';

const ch = { stream_id: 1, name: 'US| ESPN', num: 5, stream_icon: '', category_id: '1' } as never;

describe('ChannelRow', () => {
  it.each(['classic', 'compact', 'tile', 'slim', 'upright'] as const)('shows the down triangle in the %s layout', (variant) => {
    render(<ChannelRow channel={ch} index={0} isFocused={false} isPlaying={false} isFavorite={false} isDown onSelect={() => {}} onActivate={() => {}} variant={variant} />);
    expect(screen.getAllByLabelText('Reported down right now').length).toBeGreaterThan(0);
  });
});

describe('ChannelRow, slim (one line per channel)', () => {
  const now = Date.now();
  const nowNext = { now: { title: 'Evening Report', start: now - 20 * 60_000, end: now + 40 * 60_000 } } as never;
  const slim = (extra: Record<string, unknown> = {}) => render(
    <ChannelRow channel={ch} index={0} isFocused={false} isPlaying={false} isFavorite={false} onSelect={() => {}} onActivate={() => {}} variant="slim" nowNext={nowNext} {...extra} />,
  );

  it('shows the number, the name, what is on and when it ends, on one row', () => {
    const { container } = slim();
    const row = container.querySelector('[data-row-slim]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.style.height).toBe('34px');
    expect(row.textContent).toContain('5');
    expect(container.querySelector('[data-slim-name]')?.textContent).toBe('US| ESPN');
    expect(container.querySelector('[data-slim-now]')?.textContent).toBe('Evening Report');
    expect(container.querySelector('[data-slim-time]')?.textContent).toBe(`–${formatTime(now + 40 * 60_000)}`);
    // The progress along its foot, a third of the way.
    const bar = container.querySelector('[aria-hidden="true"] > div') as HTMLElement;
    expect(parseFloat(bar.style.width)).toBeGreaterThan(30);
    expect(parseFloat(bar.style.width)).toBeLessThan(37);
  });

  it('keeps the markers: down, favorite, playing, the service', () => {
    slim({ isDown: true, isFavorite: true, isPlaying: true, serviceTag: 'VIBEZ' });
    expect(screen.getAllByLabelText('Reported down right now').length).toBeGreaterThan(0);
    // Down: the note takes what's-on's place.
    expect(document.querySelector('[data-slim-now]')?.textContent).toBe('Reported down right now');
    expect(document.querySelector('[data-slim-live]')?.textContent).toBe('LIVE');
    expect(document.querySelector('.fill-brand-gold')).not.toBeNull();
    expect(document.querySelector('[data-service-tag]')?.textContent).toBe('VIBEZ');
  });

  it('draws the highlight ring on the focused row, and no time without a programme', () => {
    const { container } = render(<ChannelRow channel={ch} index={0} isFocused isPlaying={false} isFavorite={false} onSelect={() => {}} onActivate={() => {}} variant="slim" />);
    const row = container.querySelector('[data-row-slim]') as HTMLElement;
    expect(row.getAttribute('data-focused')).toBe('true');
    expect(row.className).toContain('tv-ring');
    expect(container.querySelector('[data-slim-time]')).toBeNull();
  });
});

describe('ChannelRow, the room each part gets', () => {
  const at = Date.now();
  const nn = { now: { title: 'Evening Report', start: at - 60_000, end: at + 60_000 } } as never;
  const row = (variant: 'slim' | 'compact' | 'classic', num: number, withNow = true) => render(
    <ChannelRow channel={{ ...(ch as object), num } as never} index={0} isFocused={false} isPlaying={false} isFavorite={false} onSelect={() => {}} onActivate={() => {}} variant={variant} nowNext={withNow ? nn : undefined} />,
  ).container;

  it('caps a slim name when what is on follows, so that gets some room', () => {
    expect(row('slim', 5).querySelector('[data-slim-name]')?.className).toContain('max-w-[55%]');
    expect(row('slim', 5, false).querySelector('[data-slim-name]')?.className).not.toContain('max-w-[55%]');
  });

  it.each(['slim', 'compact', 'classic'] as const)('keeps a long channel number inside its column (%s)', (variant) => {
    const short = row(variant, 7).querySelector('[data-row-num]')!;
    const long = row(variant, 12345).querySelector('[data-row-num]')!;
    const longer = row(variant, 123456).querySelector('[data-row-num]')!;
    for (const el of [short, long, longer]) {
      expect(el.className).toContain('w-8');
      expect(el.className).toContain('overflow-hidden');
      expect(el.className).toContain('tabular-nums');
    }
    expect(long.className).toContain('text-[10px]');
    expect(longer.className).toContain('text-[9px]');
    expect(short.className).toContain(variant === 'slim' ? 'text-xs' : 'text-sm');
  });
});

describe('ChannelRow, Normal rows drawn like the Tronix list, a little thicker (owner, 2026-10-24)', () => {
  const at = Date.now();
  const nn = { now: { title: 'Evening Report', start: at - 20 * 60_000, end: at + 40 * 60_000 } } as never;
  const draw = (variant: 'classic' | 'compact' | 'upright', extra: Record<string, unknown> = {}) => render(
    <ChannelRow channel={ch} index={0} isFocused={false} isPlaying={false} isFavorite={false} onSelect={() => {}} onActivate={() => {}} variant={variant} nowNext={nn} {...extra} />,
  ).container;
  const range = `${formatTime(at - 20 * 60_000)}–${formatTime(at + 40 * 60_000)}`;

  it.each(['classic', 'compact'] as const)('%s: 46px, the number, a round logo, the name with its star, what is on and the progress under the words', (variant) => {
    const c = draw(variant, { isFavorite: true });
    const row = c.querySelector('[data-row-normal]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.hasAttribute(`data-row-${variant}`)).toBe(true);
    expect(row.style.height).toBe(`${NORMAL_ROW_H}px`);
    expect(NORMAL_ROW_H).toBe(46);
    expect(c.querySelector('[data-row-num]')?.textContent).toBe('5');
    expect(c.querySelector('[data-row-logo]')?.className).toContain('rounded-full');
    expect(c.querySelector('[data-row-name]')?.textContent).toBe('US| ESPN');
    // The star right after the name, gold.
    const star = c.querySelector('[data-row-fav]')!;
    expect(star.previousElementSibling?.hasAttribute('data-row-name')).toBe(true);
    expect(star.getAttribute('class')).toContain('text-brand-gold');
    expect(c.querySelector('[data-row-now]')?.textContent).toBe('Evening Report');
    // The progress line spans the words' width, a third of the way, in gold.
    const bar = c.querySelector('[data-row-progress]') as HTMLElement;
    expect(bar.parentElement?.hasAttribute('data-row-text')).toBe(true);
    expect(bar.className).toContain('left-0');
    expect(bar.className).toContain('right-0');
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.className).toContain('bg-brand-gold');
    expect(parseFloat(fill.style.width)).toBeGreaterThan(30);
    expect(parseFloat(fill.style.width)).toBeLessThan(37);
    // A white ring when focused (index.css .tv-ring-row), not the gold one.
    expect(row.className).toContain('tv-ring-row');
  });

  it('Classic has the times at the name line\'s end; Compact says when it ends after what is on', () => {
    const classic = draw('classic');
    const t = classic.querySelector('[data-row-time]')!;
    expect(t.textContent).toBe(range);
    expect(t.parentElement?.contains(classic.querySelector('[data-row-name]'))).toBe(true);
    const compact = draw('compact');
    const e = compact.querySelector('[data-row-time]')!;
    expect(e.textContent).toBe(`–${formatTime(at + 40 * 60_000)}`);
    expect(e.parentElement?.contains(compact.querySelector('[data-row-now]'))).toBe(true);
  });

  it('a logo-less channel gets a coloured initials circle; a logo goes over it once it has loaded', () => {
    const c = draw('classic');
    expect(c.querySelector('[data-row-initials]')?.textContent).toBe('ES');
    expect((c.querySelector('[data-row-logo]') as HTMLElement).style.backgroundColor).toMatch(/^rgb/);
    const withLogo = render(<ChannelRow channel={{ ...(ch as object), stream_icon: 'http://x.test/logo.png' } as never} index={0} isFocused={false} isPlaying={false} isFavorite={false} onSelect={() => {}} onActivate={() => {}} variant="compact" />).container;
    expect(withLogo.querySelector('[data-row-logo] img')).not.toBeNull();
    // Until it loads, the initials stay.
    expect(withLogo.querySelector('[data-row-initials]')).not.toBeNull();
  });

  it('keeps the markers: down / off the air, the service, playing (ON AIR / LIVE)', () => {
    const classic = draw('classic', { isPlaying: true, serviceTag: 'VIBEZ' });
    expect(classic.querySelector('[data-row-live]')?.textContent).toBe('ON AIR');
    expect(classic.querySelector('[data-service-tag]')?.textContent).toBe('VIBEZ');
    expect(draw('compact', { isPlaying: true }).querySelector('[data-row-live]')?.textContent).toBe('LIVE');
    const off = draw('classic', { report: 'offair' });
    expect(off.querySelector('[data-report="offair"]')).not.toBeNull();
    // Down: the note takes what's-on's place, and no times or progress.
    expect(off.querySelector('[data-row-now]')?.textContent).toContain('Off the air');
    expect(off.querySelector('[data-row-time]')).toBeNull();
    expect(off.querySelector('[data-row-progress]')).toBeNull();
    expect(draw('compact', { isDown: true }).querySelector('[data-row-now]')?.textContent).toBe('Reported down right now');
  });

  it('says when a channel has no listing', () => {
    expect(screenText(draw('classic', { nowNext: undefined }))).toContain('No information');
    expect(screenText(draw('compact', { nowNext: undefined }))).toContain('No information');
  });

  it('Slim stays thinner', () => {
    expect(SLIM_ROW_H).toBeLessThan(NORMAL_ROW_H);
  });

  it('a phone held upright keeps its finger-sized 56px row', () => {
    const c = draw('upright');
    expect(c.querySelector('[data-row-normal]')).toBeNull();
    expect(c.querySelector('.h-14')).not.toBeNull();
  });

  it('no flex gap in the normal rows (Chromium 66 ignores it)', () => {
    for (const v of ['classic', 'compact'] as const) {
      const html = draw(v, { isPlaying: true, isFavorite: true, serviceTag: 'VIBEZ' }).innerHTML;
      expect(html).not.toMatch(/class="[^"]*\bgap-/);
    }
  });
});

const screenText = (c: HTMLElement) => c.textContent ?? '';
