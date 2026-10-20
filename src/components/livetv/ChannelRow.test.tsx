import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ChannelRow from './ChannelRow';
import { formatTime } from '@/i18n/format';

const ch = { stream_id: 1, name: 'US| ESPN', num: 5, stream_icon: '', category_id: '1' } as never;

describe('ChannelRow', () => {
  it.each(['classic', 'compact', 'tile', 'slim'] as const)('shows the down triangle in the %s layout', (variant) => {
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
    expect(short.className).toContain(variant === 'classic' ? 'text-sm' : 'text-xs');
  });
});
