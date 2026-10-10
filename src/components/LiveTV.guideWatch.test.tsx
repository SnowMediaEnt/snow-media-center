import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// The Guide's channels play in Live TV's own player (GuideSection's onWatch);
// the Player shell keeps the Guide's place and hands it back (resumeAt) only
// by Back from that picture (Live TV's onBackToCaller). The sections are
// stand-ins: this is about the shell's part.
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadCreds: async () => ({ host: 'http://h.test', username: 'u', password: 'p', serverLabel: 'Dreamstreams' }),
  bumpXtreamRefresh: vi.fn(),
  clearLiveCatalogue: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/hooks/usePlayerServerAlert', () => ({ usePlayerServerAlert: () => ({ alert: null, dismiss: vi.fn(), appLabel: null }) }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: null, days: null }) }));
vi.mock('@/hooks/useVersion', () => ({ useVersion: () => ({ version: '1.8.4' }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), trackAlertShown: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), hasSessionFlag: () => false }));
vi.mock('@/lib/plex', () => ({ clearPlexToken: vi.fn() }));
vi.mock('@/lib/playerAutoSignIn', () => ({ autoSignInPlayer: async () => null, clearPlayerSignedOut: vi.fn(), markPlayerSignedOut: vi.fn() }));
vi.mock('@/lib/playerAccountSync', () => ({ syncPlayerAccountToCloud: vi.fn() }));
vi.mock('@/lib/playerSigninCapture', () => ({ capturePlayerSignin: vi.fn() }));
vi.mock('@/lib/accountClaim', () => ({ isClaimDismissed: () => true, isClaimDone: () => true, markClaimDismissed: vi.fn() }));
vi.mock('@/utils/idle', () => ({ runAfter: () => () => undefined, runWhenIdle: () => () => undefined }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: vi.fn() }) } }));
// Live TV: Back (Escape) from the picture asks the shell for the caller first.
vi.mock('./livetv/LiveSection', async () => {
  const { useEffect } = await import('react');
  const LiveSectionStub = ({ isActive, onExitLeft, onBackToCaller }: { isActive: boolean; onExitLeft: () => void; onBackToCaller?: () => boolean }) => {
    useEffect(() => {
      if (!isActive) return;
      const h = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { e.stopPropagation(); if (!onBackToCaller?.()) onExitLeft(); }
        if (e.key === 'ArrowLeft') onExitLeft();
      };
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    }, [isActive, onExitLeft, onBackToCaller]);
    return <div>live-section</div>;
  };
  return { default: LiveSectionStub };
});
// The Guide: OK watches a channel (onWatch with its place); it shows the place it was handed.
vi.mock('./livetv/GuideSection', async () => {
  const { useEffect, useState } = await import('react');
  type Place = { line: string; cat: string; channel: number; window: number };
  const GuideStub = ({ isActive, onExitLeft, onWatch, resumeAt, onResumeTaken }: {
    isActive: boolean; onExitLeft: () => void; onWatch?: (p: Place) => void; resumeAt?: Place | null; onResumeTaken?: () => void;
  }) => {
    const [resume] = useState(() => resumeAt ?? null);
    useEffect(() => { if (resumeAt) onResumeTaken?.(); }, [resumeAt, onResumeTaken]);
    useEffect(() => {
      if (!isActive) return;
      const h = (e: KeyboardEvent) => {
        if (e.key === 'Enter') onWatch?.({ line: 'h.test|u', cat: '2', channel: 402, window: 0 });
        if (e.key === 'ArrowLeft') onExitLeft();
      };
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    }, [isActive, onExitLeft, onWatch]);
    return <div>guide-section {resume ? `at ${resume.cat}/${resume.channel}` : 'at its start'}</div>;
  };
  return { default: GuideStub };
});
vi.mock('./livetv/BackupsSection', () => ({ default: () => <div>backups-section</div> }));
vi.mock('./livetv/PlexSection', () => ({ default: () => <div>plex-section</div> }));
vi.mock('./livetv/SettingsHub', () => ({ default: () => <div>settings-hub</div> }));
vi.mock('./livetv/PlayerServerAlertDialog', () => ({ default: () => null }));
vi.mock('./livetv/ExpirationNoticeDialog', () => ({ default: () => null }));
vi.mock('./livetv/CredentialsForm', () => ({ default: () => <div>credentials-form</div> }));

import LiveTV from './LiveTV';

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : k === 'Escape' ? 27 : undefined }); });
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
/** The Player in Live TV, then the side menu's Guide. */
const openGuide = async () => {
  render(<LiveTV onBack={vi.fn()} />);
  await settle();
  key('Enter'); // mode chooser: Live TV
  await settle();
  key('ArrowLeft'); // the side menu
  key('ArrowDown'); // Guide
  key('Enter');
  await settle(); await settle();
  expect(await screen.findByText(/guide-section/)).toBeTruthy();
};

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { sessionStorage.clear(); });

describe("The Guide's channels play in Live TV's own player", () => {
  it('OK in the Guide: Live TV; Back from it: the Guide again, at the place it handed over', async () => {
    await openGuide();
    expect(screen.getByText('guide-section at its start')).toBeTruthy();
    key('Enter');
    await settle();
    expect(screen.getByText('live-section')).toBeTruthy();
    key('Escape');
    await settle(); await settle();
    expect(await screen.findByText('guide-section at 2/402')).toBeTruthy();
  });

  it('the place is handed back once: the Guide from the side menu later opens at its start', async () => {
    await openGuide();
    key('Enter');
    await settle();
    key('Escape');
    await settle(); await settle();
    expect(await screen.findByText('guide-section at 2/402')).toBeTruthy();
    // To Live TV by the side menu, and back to the Guide the same way.
    key('ArrowLeft');
    key('ArrowUp');
    key('Enter');
    await settle();
    expect(screen.getByText('live-section')).toBeTruthy();
    key('ArrowLeft');
    key('ArrowDown');
    key('Enter');
    await settle(); await settle();
    expect(await screen.findByText('guide-section at its start')).toBeTruthy();
  });

  it('Live TV reached another way first (the side menu): Back is its own', async () => {
    await openGuide();
    key('Enter'); // the Guide hands a channel over
    await settle();
    key('ArrowLeft'); // Live TV → side menu
    key('ArrowDown');
    key('Enter'); // the Guide
    await settle(); await settle();
    key('ArrowLeft');
    key('ArrowUp');
    key('Enter'); // Live TV, by the menu
    await settle();
    key('Escape'); // Live TV's own Back: no Guide
    await settle();
    expect(screen.queryByText(/guide-section/)).toBeNull();
  });
});
