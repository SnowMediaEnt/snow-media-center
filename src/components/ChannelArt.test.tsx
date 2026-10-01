import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ChannelArt from './ChannelArt';
import { channelInitials } from '@/lib/channelInitials';

describe('channelInitials', () => {
  it.each([
    ['A&E', 'AE'],
    ['ESPN', 'ES'],
    ['Golf Channel', 'GC'],
    ['US| ESPN HD', 'ES'],
    ['UK: BBC One', 'BO'],
    ['Sky Sports Main Event', 'SS'],
    ['', ''],
    ['|||', ''],
  ])('%s -> %s', (name, want) => {
    expect(channelInitials(name)).toBe(want);
  });
});

describe('ChannelArt', () => {
  it('shows the initials on a dark card when the channel has no logo', () => {
    render(<ChannelArt name="Golf Channel" />);
    expect(screen.getByTestId('channel-initials').textContent).toBe('GC');
    expect(screen.getByTestId('channel-art').className).toContain('bg-black/40');
    expect(screen.getByTestId('channel-art').className).not.toContain('bg-white/90');
  });

  it('keeps the initials until the logo has loaded', () => {
    const { container } = render(<ChannelArt name="ESPN" src="http://x/espn.png" />);
    expect(screen.getByTestId('channel-initials')).toBeTruthy();
    const img = container.querySelector('img') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 120 });
    fireEvent.load(img);
    expect(screen.queryByTestId('channel-initials')).toBeNull();
    expect(container.querySelector('img')).toBeTruthy();
  });

  it('falls back to the initials when the logo fails to load', () => {
    const { container } = render(<ChannelArt name="A&E" src="http://x/ae.png" />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('channel-initials').textContent).toBe('AE');
  });

  it('treats a zero-size image as no logo', () => {
    const { container } = render(<ChannelArt name="ESPN" src="http://x/blank.png" />);
    const img = container.querySelector('img') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 0 });
    fireEvent.load(img);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('channel-initials').textContent).toBe('ES');
  });
});
