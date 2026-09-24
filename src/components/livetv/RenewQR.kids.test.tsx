// The two Live TV screens that offer a Renew QR outside Player Settings: the
// expired-line block (Plex, Backups) and the expiry notice.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { setKidsLevel } from '@/lib/kidsFilter';

vi.mock('@/hooks/usePlayerAccount', () => ({
  usePlayerAccount: () => ({ account: { username: 'u', serverLabel: 'Dreamstreams' }, days: -2 }),
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,' } }));

import PlexBlockedScreen from './PlexBlockedScreen';
import ExpirationNoticeDialog from './ExpirationNoticeDialog';

// The remote's OK arrives as Enter, keyCode 13.
const ok = () => act(() => { fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 }); });

afterEach(() => { setKidsLevel(null); });

describe('an expired line on a Kids profile', () => {
  it('Plex is paused with no Renew now: ask a grown-up, and OK goes back', () => {
    setKidsLevel('kids');
    const onBack = vi.fn();
    render(<PlexBlockedScreen serverLabel="Dreamstreams" onBack={onBack} />);
    expect(screen.getByText(/Ask a grown-up/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Renew/ })).toBeNull();
    expect(screen.queryByText(/subscription|Renew/)).toBeNull();
    ok();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText('Renewal QR code')).toBeNull();
  });

  it('the expiry notice has no Renew now either', () => {
    setKidsLevel('little');
    const onDismiss = vi.fn();
    render(<ExpirationNoticeDialog open serverLabel="Dreamstreams" days={-2} username="u" onDismiss={onDismiss} />);
    expect(screen.queryByRole('button', { name: /Renew/ })).toBeNull();
    ok();
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText('Renewal QR code')).toBeNull();
  });
});

describe('an expired line on a grown-up profile', () => {
  it('keeps Renew now, and OK on it shows the QR', async () => {
    render(<PlexBlockedScreen serverLabel="Dreamstreams" onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Renew now/ })).toBeTruthy();
    ok();
    expect(await screen.findByAltText('Renewal QR code')).toBeTruthy();
  });

  it('the expiry notice keeps Renew now', () => {
    render(<ExpirationNoticeDialog open serverLabel="Dreamstreams" days={-2} username="u" onDismiss={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Renew now/ })).toBeTruthy();
  });
});
