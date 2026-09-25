import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { setKidsLevel } from '@/lib/kidsFilter';
import { INTENT_KEYS } from '@/lib/appActions';

// A box signed in to a line (unless a test takes it away). The sections
// themselves are stand-ins: this is about which ones the Player shell lets a
// profile reach.
const box = vi.hoisted(() => ({
  line: true,
  account: null as null | { username: string; serverLabel: string },
  days: null as number | null,
}));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadCreds: async () => (box.line ? { host: 'http://h.test', username: 'u', password: 'p', serverLabel: 'Dreamstreams' } : null),
  bumpXtreamRefresh: vi.fn(),
  clearLiveCatalogue: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/hooks/usePlayerServerAlert', () => ({ usePlayerServerAlert: () => ({ alert: null, dismiss: vi.fn(), appLabel: null }) }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: box.account, days: box.days }) }));
vi.mock('@/hooks/useVersion', () => ({ useVersion: () => ({ version: '1.7.8' }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), trackAlertShown: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), hasSessionFlag: () => false }));
vi.mock('@/lib/plex', () => ({ clearPlexToken: vi.fn() }));
vi.mock('@/lib/playerAutoSignIn', () => ({ autoSignInPlayer: async () => null, clearPlayerSignedOut: vi.fn(), markPlayerSignedOut: vi.fn() }));
vi.mock('@/lib/playerAccountSync', () => ({ syncPlayerAccountToCloud: vi.fn() }));
vi.mock('@/lib/playerSigninCapture', () => ({ capturePlayerSignin: vi.fn() }));
vi.mock('@/lib/accountClaim', () => ({ isClaimDismissed: () => true, isClaimDone: () => true, markClaimDismissed: vi.fn() }));
vi.mock('@/utils/idle', () => ({ runAfter: () => () => undefined, runWhenIdle: () => () => undefined }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: vi.fn() }) } }));
// Live TV hands the remote back to the sidebar on Left, as the real one does.
vi.mock('./livetv/LiveSection', async () => {
  const { useEffect } = await import('react');
  const LiveSectionStub = ({ isActive, onExitLeft }: { isActive: boolean; onExitLeft: () => void }) => {
    useEffect(() => {
      if (!isActive) return;
      const h = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') onExitLeft(); };
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    }, [isActive, onExitLeft]);
    return <div>live-section</div>;
  };
  return { default: LiveSectionStub };
});
vi.mock('./livetv/BackupsSection', () => ({ default: () => <div>backups-section</div> }));
// Plex signed out on a box with no line: its "Sign into Live TV" (OK here).
vi.mock('./livetv/PlexSection', async () => {
  const { useEffect } = await import('react');
  const PlexSectionStub = ({ onNeedLiveTV }: { onNeedLiveTV?: () => void }) => {
    useEffect(() => {
      const h = (e: KeyboardEvent) => { if (e.key === 'Enter') onNeedLiveTV?.(); };
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    }, [onNeedLiveTV]);
    return <div>plex-section</div>;
  };
  return { default: PlexSectionStub };
});
vi.mock('./livetv/SettingsHub', () => ({ default: () => <div>settings-hub</div> }));
vi.mock('./livetv/PlayerServerAlertDialog', () => ({ default: () => null }));
vi.mock('./livetv/ExpirationNoticeDialog', () => ({ default: () => <div>expiry-notice</div> }));
// The sign-in form, whose Get started sells a line.
vi.mock('./livetv/CredentialsForm', () => ({ default: () => <div>credentials-form</div> }));

import LiveTV from './LiveTV';

// The remote's OK arrives as Enter, keyCode 13.
const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : undefined }); });
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const openLiveTv = async () => {
  render(<LiveTV onBack={vi.fn()} />);
  await settle();
  key('Enter'); // mode chooser: Live TV
  await settle();
};
const sidebar = () => Array.from(document.querySelectorAll('[data-player-chrome] > [data-focused]')).map((n) => n.getAttribute('title') || n.textContent);

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  box.line = true; box.account = null; box.days = null;
});
afterEach(() => { setKidsLevel(null); });

describe('the Player on a Kids profile', () => {
  it.each(['little', 'kids', 'teen'] as const)('%s: no Backups on the mode chooser or in the sidebar', async (level) => {
    setKidsLevel(level);
    render(<LiveTV onBack={vi.fn()} />);
    await settle();
    expect(screen.queryByText('Backups')).toBeNull();
    // Right as far as it goes, then OK: Plex, never Backups.
    key('ArrowRight'); key('ArrowRight'); key('ArrowRight');
    key('Enter');
    await settle();
    expect(screen.queryByText('backups-section')).toBeNull();
  });

  it('the sidebar has no Backups', async () => {
    setKidsLevel('teen');
    await openLiveTv();
    expect(sidebar()).toEqual(['Live TV', 'Guide', 'Game Day', 'VOD', 'Multi-Screen']);
  });

  it('the header has no Player Settings to reach (sign-out, the line password, billing)', async () => {
    setKidsLevel('kids');
    await openLiveTv();
    expect(screen.queryByRole('button', { name: /Settings/ })).toBeNull();
    // Left into the sections, Up to the header, Right as far as it goes, OK.
    key('ArrowLeft');
    key('ArrowUp');
    key('ArrowRight'); key('ArrowRight'); key('ArrowRight');
    key('Enter');
    await settle();
    expect(screen.queryByText('settings-hub')).toBeNull();
  });

  it('ignores the assistant asking for Backups or Player Settings', async () => {
    setKidsLevel('kids');
    sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'backups', settings: 'hub' }));
    render(<LiveTV onBack={vi.fn()} />);
    await settle();
    await settle();
    expect(screen.queryByText('backups-section')).toBeNull();
    expect(screen.queryByText('settings-hub')).toBeNull();
    expect(screen.getByText('live-section')).toBeTruthy();
  });
});

describe('Live TV on a Kids profile with no line on the box', () => {
  it('asks for a grown-up instead of showing the sign-in form, and Back leaves', async () => {
    setKidsLevel('kids');
    box.line = false;
    const onBack = vi.fn();
    render(<LiveTV onBack={onBack} />);
    await settle();
    key('Enter'); // mode chooser: Live TV
    await settle();
    await settle();
    expect(screen.getByText('Ask a grown-up to sign in to Live TV')).toBeTruthy();
    expect(screen.queryByText('credentials-form')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/Get started|Sign in to Player|Buy|Subscribe/i)).toBeNull();
    // Back: out of the Player (Home), once.
    key('Escape');
    await settle();
    expect(onBack).toHaveBeenCalledTimes(1);
    // OK on its one button leaves the same way.
    key('Enter');
    await settle();
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('Plex sending the viewer to sign in to Live TV lands on the same screen', async () => {
    setKidsLevel('little');
    box.line = false;
    render(<LiveTV onBack={vi.fn()} />);
    await settle();
    key('ArrowRight'); // mode chooser: Plex
    key('Enter');
    await settle();
    await settle();
    expect(screen.getByText('plex-section')).toBeTruthy();
    key('Enter'); // Plex: "Sign into Live TV"
    await settle();
    await settle();
    expect(screen.getByText('Ask a grown-up to sign in to Live TV')).toBeTruthy();
    expect(screen.queryByText('credentials-form')).toBeNull();
  });

  it('a grown-up profile still gets the sign-in form', async () => {
    box.line = false;
    render(<LiveTV onBack={vi.fn()} />);
    await settle();
    key('Enter');
    await settle();
    await settle();
    expect(screen.getByText('credentials-form')).toBeTruthy();
    expect(screen.queryByText('Ask a grown-up to sign in to Live TV')).toBeNull();
  });
});

describe('the expiry notice (it offers a Renew QR)', () => {
  it('is not raised on a Kids profile', async () => {
    setKidsLevel('teen');
    box.account = { username: 'u', serverLabel: 'Dreamstreams' };
    box.days = 3;
    await openLiveTv();
    await settle();
    expect(screen.queryByText('expiry-notice')).toBeNull();
    // Nor held back for this profile's next visit: the grown-up gets today's.
    expect(Object.keys(localStorage).filter((k) => k.startsWith('snow-player-exp-notice'))).toEqual([]);
  });

  it('is raised on a grown-up profile', async () => {
    box.account = { username: 'u', serverLabel: 'Dreamstreams' };
    box.days = 3;
    await openLiveTv();
    await settle();
    expect(screen.getByText('expiry-notice')).toBeTruthy();
  });
});

describe('the Player on a grown-up profile', () => {
  it('opens Plex for a title tapped on the content bar, but not for a link Plex never picked up', async () => {
    const link = (at: number) => JSON.stringify({ ratingKey: 'd1', title: 'Dune', kind: 'movie', at });
    sessionStorage.setItem('smc-plex-deeplink', link(Date.now() - 10 * 60 * 1000));
    const stale = render(<LiveTV onBack={vi.fn()} />);
    await settle();
    expect(screen.queryByText('plex-section')).toBeNull();
    expect(screen.getByText('Live channels & guide')).toBeTruthy();
    stale.unmount();
    sessionStorage.setItem('smc-plex-deeplink', link(Date.now()));
    render(<LiveTV onBack={vi.fn()} />);
    await settle();
    await settle();
    expect(screen.getByText('plex-section')).toBeTruthy();
  });

  it('keeps Backups and the header Settings', async () => {
    await openLiveTv();
    expect(sidebar()).toContain('Backups');
    key('ArrowLeft');
    key('ArrowUp');
    key('ArrowRight'); key('ArrowRight');
    key('Enter');
    await settle();
    await settle();
    expect(screen.getByText('settings-hub')).toBeTruthy();
  });
});

describe('Live TV and Plex opened from their own Home cards', () => {
  it('Back from Live TV goes home, not to the Player chooser', async () => {
    sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'live', home: true }));
    const onBack = vi.fn();
    render(<LiveTV onBack={onBack} />);
    await settle(); await settle();
    expect(screen.getByText('live-section')).toBeTruthy();
    key('ArrowLeft'); // Live TV hands the remote to the sidebar
    await settle();
    key('Escape');
    await settle();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Live channels & guide')).toBeNull();
  });

  it('opened any other way, Back from Live TV goes Home (the chooser, which no longer offers Backups, is not a stop on the way out)', async () => {
    const onBack = vi.fn();
    await (async () => { render(<LiveTV onBack={onBack} />); await settle(); })();
    expect(screen.queryByText('Backups')).toBeNull();
    key('Enter'); // chooser: Live TV
    await settle();
    key('ArrowLeft');
    await settle();
    key('Escape');
    await settle();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('Home cards with no line saved on the box yet', () => {
  it('Live TV goes straight to signing in, not to the Player chooser', async () => {
    box.line = false;
    sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'live', home: true }));
    render(<LiveTV onBack={vi.fn()} />);
    await settle(); await settle();
    expect(screen.queryByText('Live channels & guide')).toBeNull();
    expect(screen.queryByText(/Signing you in|credentials-form/)).toBeTruthy();
  });

  it('Plex goes straight to Plex', async () => {
    box.line = false;
    sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'movies', home: true }));
    render(<LiveTV onBack={vi.fn()} />);
    await settle(); await settle();
    expect(screen.queryByText('Live channels & guide')).toBeNull();
    expect(screen.getByText('plex-section')).toBeTruthy();
  });
});
