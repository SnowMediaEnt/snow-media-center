import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { setKidsLevel } from '@/lib/kidsFilter';
import { INTENT_KEYS } from '@/lib/appActions';

// Live TV › Recordings in the far-left menu, between Game Day and VOD (owner,
// 2026-10-24: it was a button above the categories). The sections are
// stand-ins: this is about the menu entry, its screen and Back.
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
vi.mock('./livetv/OriginalsSection', () => ({ default: () => <div>originals-section</div> }));
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
// A box that records, with something recorded (unless a test empties it).
const rec = vi.hoisted(() => ({ items: 1, schedules: 0, jobs: 0 }));
vi.mock('@/capacitor/SnowPlayer', async (orig) => ({
  ...(await orig<typeof import('@/capacitor/SnowPlayer')>()),
  hasNativePlayer: () => true,
}));
vi.mock('@/capacitor/SnowRecorder', async (orig) => ({
  ...(await orig<typeof import('@/capacitor/SnowRecorder')>()),
  hasRecorder: () => true,
  SnowRecorder: {
    list: async () => ({ recordings: Array.from({ length: rec.items }, (_, i) => ({ id: `r${i}` })), volumes: [] }),
    listSchedules: async () => ({ schedules: Array.from({ length: rec.schedules }, (_, i) => ({ id: `s${i}` })) }),
    active: async () => ({ jobs: Array.from({ length: rec.jobs }, (_, i) => ({ id: `j${i}` })) }),
  },
}));
// The screen: Back closes it (its onClose), ▲ at the top goes to the header.
vi.mock('./livetv/RecordingsScreen', async () => {
  const { useEffect } = await import('react');
  const RecordingsStub = ({ active, onClose }: { active?: boolean; onClose: () => void }) => {
    useEffect(() => {
      if (!active) return;
      const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    }, [active, onClose]);
    return <div>recordings-screen</div>;
  };
  return { default: RecordingsStub };
});

import LiveTV from './LiveTV';

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : undefined }); });
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const openLiveTv = async () => {
  render(<LiveTV onBack={vi.fn()} />);
  await settle();
  key('Enter'); // mode chooser: Live TV
  await settle();
  await settle();
};
const sidebar = () => Array.from(document.querySelectorAll('[data-player-chrome] > [data-focused]')).map((n) => n.getAttribute('title') || n.textContent);
const focused = () => document.querySelector('[data-player-chrome] > [data-focused="true"]')?.getAttribute('data-player-section');

beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  box.line = true; box.account = null; box.days = null;
  rec.items = 1; rec.schedules = 0; rec.jobs = 0;
});
afterEach(() => { setKidsLevel(null); });

describe('Live TV › Recordings in the far-left menu', () => {
  it('sits between Game Day and VOD once something is recorded', async () => {
    await openLiveTv();
    expect(sidebar()).toEqual(['Live TV', 'Guide', 'Game Day', 'Recordings', 'VOD', 'Multi-Screen', 'Snow Originals', 'Backups']);
  });

  it('a schedule alone is enough', async () => {
    rec.items = 0; rec.schedules = 1;
    await openLiveTv();
    expect(sidebar()).toContain('Recordings');
  });

  it('is not there with nothing recorded or scheduled', async () => {
    rec.items = 0;
    await openLiveTv();
    expect(sidebar()).not.toContain('Recordings');
  });

  it.each(['little', 'kids', 'teen'] as const)('%s profile: not there', async (level) => {
    setKidsLevel(level);
    await openLiveTv();
    expect(sidebar()).not.toContain('Recordings');
  });

  it('OK opens the Recordings screen; Back comes back to the menu on Recordings', async () => {
    await openLiveTv();
    key('ArrowLeft'); // to the menu, on Live TV
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    expect(focused()).toBe('recordings');
    key('Enter');
    await settle(); await settle();
    expect(screen.getByText('recordings-screen')).toBeTruthy();
    expect(screen.queryByText('live-section')).toBeNull();
    key('Escape');
    await settle();
    expect(focused()).toBe('recordings');
    // The menu is open (labels drawn), the screen still behind it.
    expect(sidebar()).toContain('Recordings');
    expect(screen.getByText('recordings-screen')).toBeTruthy();
  });

  it('a red dot while something records', async () => {
    rec.jobs = 1;
    await openLiveTv();
    expect(document.querySelector('[data-player-section="recordings"] [data-recording-now]')).not.toBeNull();
  });

  it('the assistant can open Snow Originals too', async () => {
    sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'originals' }));
    render(<LiveTV onBack={vi.fn()} />);
    await settle(); await settle(); await settle();
    expect(screen.getByText('originals-section')).toBeTruthy();
  });

  it('the assistant can open it', async () => {
    sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'recordings' }));
    render(<LiveTV onBack={vi.fn()} />);
    await settle(); await settle(); await settle();
    expect(screen.getByText('recordings-screen')).toBeTruthy();
  });
});
