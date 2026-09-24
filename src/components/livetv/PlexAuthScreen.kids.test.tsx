// Plex's sign-in screen in the Player on a Kids profile: no Plex sign-in (the
// own-server code), no Sign out of Plex, no way to the Live TV sign-in.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { setKidsLevel } from '@/lib/kidsFilter';
import type { PlexStatus } from '@/hooks/usePlexAuth';
import PlexAuthScreen from './PlexAuthScreen';

// The remote's OK arrives as Enter, keyCode 13.
const key = (k: string, keyCode?: number) => act(() => { fireEvent.keyDown(window, { key: k, keyCode }); });
const ok = () => key('Enter', 13);

const renderAuth = (status: PlexStatus, providerAvailable = false) => {
  const h = {
    onStartLink: vi.fn(), onLinkWithProvider: vi.fn(), onNeedLiveTV: vi.fn(),
    onCancel: vi.fn(), onRetry: vi.fn(), onSignOut: vi.fn(),
  };
  render(<PlexAuthScreen status={status} pinCode={null} error={null} providerAvailable={providerAvailable} {...h} />);
  return h;
};

afterEach(() => { setKidsLevel(null); });

describe('Plex\'s sign-in on a Kids profile', () => {
  it('no line on the box: ask a grown-up, and OK goes back', () => {
    setKidsLevel('kids');
    const h = renderAuth('signed-out');
    expect(screen.getByText('Ask a grown-up to sign in to Live TV')).toBeTruthy();
    expect(screen.queryByText(/own Plex server/)).toBeNull();
    expect(screen.queryByText(/Sign into Live TV/)).toBeNull();
    key('ArrowRight');
    ok();
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.onStartLink).not.toHaveBeenCalled();
    expect(h.onNeedLiveTV).not.toHaveBeenCalled();
  });

  it('a line on the box: only the household\'s Connect with Live TV', () => {
    setKidsLevel('little');
    const h = renderAuth('signed-out', true);
    expect(screen.getByRole('button', { name: /Connect with Live TV/ })).toBeTruthy();
    expect(screen.queryByText(/own Plex server/)).toBeNull();
    key('ArrowRight');
    ok();
    expect(h.onLinkWithProvider).toHaveBeenCalledTimes(1);
    expect(h.onStartLink).not.toHaveBeenCalled();
  });

  it('server unreachable: Retry, and no Sign out of Plex', () => {
    setKidsLevel('teen');
    const h = renderAuth('unreachable');
    expect(screen.queryByRole('button', { name: /Sign out/ })).toBeNull();
    key('ArrowRight');
    ok();
    expect(h.onRetry).toHaveBeenCalledTimes(1);
    expect(h.onSignOut).not.toHaveBeenCalled();
  });

  it('a connection problem: Try again reconnects, never with a new sign-in code', () => {
    setKidsLevel('kids');
    const h = renderAuth('error');
    ok();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(h.onRetry).toHaveBeenCalledTimes(2);
    expect(h.onStartLink).not.toHaveBeenCalled();
  });
});

describe('Plex\'s sign-in on a grown-up profile', () => {
  it('keeps Sign into Live TV and the own-server code', () => {
    const h = renderAuth('signed-out');
    expect(screen.getByRole('button', { name: /Sign into Live TV/ })).toBeTruthy();
    key('ArrowRight');
    ok();
    expect(h.onStartLink).toHaveBeenCalledTimes(1);
  });

  it('keeps Sign out of Plex when the server is unreachable', () => {
    const h = renderAuth('unreachable');
    key('ArrowRight');
    ok();
    expect(h.onSignOut).toHaveBeenCalledTimes(1);
  });
});
