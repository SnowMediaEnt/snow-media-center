import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { setKidsLevel } from '@/lib/kidsFilter';
import { __setPhoneModeForTests } from '@/lib/phoneMode';
import { INTENT_KEYS } from '@/lib/appActions';

// Multi-Screen on a TV (owner, 2026-10-11: "removing the top and side border
// and making the screens larger", from Tronix 89c42b3): while a screen plays
// and the tiles have the remote, the Player's header and side menu step
// aside. ◀ off the tiles' left edge brings the side menu back (the remote on
// it), ▲ off their top the header; back on the tiles they step aside again.
// With nothing playing, or the layout chooser up, they stay. The section is
// a stand-in: this is about the shell's part (MultiScreenSection.wholeScreen
// tests the section's).
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadCreds: async () => ({ host: 'http://h.test', username: 'u', password: 'p', serverLabel: 'Dreamstreams' }),
  bumpXtreamRefresh: vi.fn(),
  clearLiveCatalogue: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('@/hooks/usePlayerServerAlert', () => ({ usePlayerServerAlert: () => ({ alert: null, dismiss: vi.fn(), appLabel: null }) }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: null, days: null }) }));
vi.mock('@/hooks/useVersion', () => ({ useVersion: () => ({ version: '1.8.7' }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), trackAlertShown: vi.fn(), startTimer: vi.fn(), stopTimer: vi.fn(), hasSessionFlag: () => false }));
vi.mock('@/lib/plex', () => ({ clearPlexToken: vi.fn() }));
vi.mock('@/lib/playerAutoSignIn', () => ({ autoSignInPlayer: async () => null, clearPlayerSignedOut: vi.fn(), markPlayerSignedOut: vi.fn() }));
vi.mock('@/lib/playerAccountSync', () => ({ syncPlayerAccountToCloud: vi.fn() }));
vi.mock('@/lib/playerSigninCapture', () => ({ capturePlayerSignin: vi.fn() }));
vi.mock('@/lib/accountClaim', () => ({ isClaimDismissed: () => true, isClaimDone: () => true, markClaimDismissed: vi.fn() }));
vi.mock('@/utils/idle', () => ({ runAfter: () => () => undefined, runWhenIdle: () => () => undefined }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: vi.fn() }) } }));
vi.mock('./livetv/LiveSection', () => ({ default: () => <div>live-section</div> }));
vi.mock('./livetv/GuideSection', () => ({ default: () => <div>guide-section</div> }));
vi.mock('./livetv/BackupsSection', () => ({ default: () => <div>backups-section</div> }));
vi.mock('./livetv/PlexSection', () => ({ default: () => <div>plex-section</div> }));
vi.mock('./livetv/SettingsHub', () => ({ default: (p: Record<string, unknown>) => { (window as unknown as { __hubProps?: unknown }).__hubProps = p; return <div>settings-hub</div>; } }));
vi.mock('./livetv/PlayerServerAlertDialog', () => ({ default: () => null }));
vi.mock('./livetv/ExpirationNoticeDialog', () => ({ default: () => null }));
vi.mock('./livetv/CredentialsForm', () => ({ default: () => <div>credentials-form</div> }));
vi.mock('./livetv/PlayerModeChooser', () => ({ default: () => <div>player-chooser</div> }));
// Multi-Screen: playing or not (window.__msPlaying); ◀ / ▲ at its edges hand
// the remote to the side menu and the header, as the real one does there.
vi.mock('./livetv/MultiScreenSection', async () => {
  const { useEffect } = await import('react');
  const MultiStub = ({ isActive, onExitLeft, onExitUp, onImmersiveChange, onMessageLine }: { isActive: boolean; onExitLeft: () => void; onExitUp: () => void; onImmersiveChange?: (on: boolean) => void; onMessageLine?: () => void }) => {
    const playing = !!(window as unknown as { __msPlaying?: boolean }).__msPlaying;
    // The line-limit warning's "Message the other TVs on this line".
    (window as unknown as { __msMessage?: () => void }).__msMessage = onMessageLine;
    useEffect(() => { onImmersiveChange?.(isActive && playing); }, [isActive, playing, onImmersiveChange]);
    useEffect(() => () => onImmersiveChange?.(false), [onImmersiveChange]);
    useEffect(() => {
      if (!isActive) return;
      const k = (e: KeyboardEvent) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); onExitLeft(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); onExitUp(); }
        // The real one stops every stream on Back from its grid.
        if (e.key === 'Escape') { const w = window as unknown as { __msBacks?: number }; w.__msBacks = (w.__msBacks ?? 0) + 1; }
      };
      window.addEventListener('keydown', k, true);
      return () => window.removeEventListener('keydown', k, true);
    }, [isActive, onExitLeft, onExitUp]);
    return <div data-ms-stub="" data-active={isActive ? 'true' : 'false'} />;
  };
  return { default: MultiStub };
});

import LiveTV from './LiveTV';

const settle = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const until = async (fn: () => boolean) => { for (let i = 0; i < 150 && !fn(); i++) await settle(20); return fn(); };
const press = (k: string) => {
  act(() => { fireEvent.keyDown(window, { key: k, keyCode: k === 'Enter' ? 13 : k === 'Escape' ? 27 : undefined }); });
  act(() => { fireEvent.keyUp(window, { key: k }); });
};
const header = () => !!document.querySelector('[data-player-header-btn]');
const rail = () => !!document.querySelector('[data-player-rail]');
const stubActive = () => document.querySelector('[data-ms-stub]')?.getAttribute('data-active') === 'true';
const setPlaying = (on: boolean) => { (window as unknown as { __msPlaying?: boolean }).__msPlaying = on; };
/** The side menu's highlighted row. */
const railRing = () => document.querySelector('[data-player-rail] [data-section-i][data-focused="true"]')?.textContent ?? null;

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); setKidsLevel(null); setPlaying(false); });
afterEach(() => { vi.clearAllMocks(); setPlaying(false); __setPhoneModeForTests({ touch: false, phone: false }); document.documentElement.className = ''; });

const openMulti = async () => {
  sessionStorage.setItem(INTENT_KEYS.player, JSON.stringify({ section: 'multi' }));
  const view = render(<LiveTV onBack={vi.fn()} />);
  await until(() => !!document.querySelector('[data-ms-stub]') && stubActive());
  return view;
};

describe('Multi-Screen on a TV: the header and side menu step aside while screens play', () => {
  it('nothing playing (the layouts, an empty grid): both stay', async () => {
    await openMulti();
    expect(stubActive()).toBe(true);
    expect(header()).toBe(true);
    expect(rail()).toBe(true);
  });

  it('playing: both go; ◀ brings the side menu (and header) back with the remote; ▶ the tiles: gone again; ▲: the header back', async () => {
    setPlaying(true);
    const view = await openMulti();
    await until(() => !header());
    expect(header()).toBe(false);
    expect(rail()).toBe(false);
    // ◀ off the tiles' left edge: the side menu has the remote, Multi-Screen highlighted.
    press('ArrowLeft');
    await settle(20);
    expect(rail()).toBe(true);
    expect(header()).toBe(true);
    expect(railRing()).toContain('Multi-Screen');
    expect(stubActive()).toBe(false);
    // ▶ from the side menu: the tiles again, both step aside.
    press('ArrowRight');
    await until(() => !header());
    expect(stubActive()).toBe(true);
    expect(rail()).toBe(false);
    // ▲ off the top: the header (and the folded side menu) back, the remote on the header.
    press('ArrowUp');
    await settle(20);
    expect(header()).toBe(true);
    expect(rail()).toBe(true);
    expect(stubActive()).toBe(false);
    // ▼ from the header: the tiles again.
    press('ArrowDown');
    await until(() => !header());
    expect(stubActive()).toBe(true);
    view.unmount();
  });

  it('▲ to the header and Back: the remote goes back to the screens, which get no Back of their own (it stopped every stream)', async () => {
    setPlaying(true);
    (window as unknown as { __msBacks?: number }).__msBacks = 0;
    const view = await openMulti();
    await until(() => !header());
    press('ArrowUp');
    await settle(20);
    expect(header()).toBe(true);
    press('Escape');
    await until(() => stubActive());
    await settle(150); // past the 60 ms a section's own Back would follow in
    expect(stubActive()).toBe(true);
    expect((window as unknown as { __msBacks?: number }).__msBacks).toBe(0);
    view.unmount();
  });

  it('a touch screen keeps them (no ◀ / ▲ to bring them back)', async () => {
    __setPhoneModeForTests({ touch: true, phone: false });
    setPlaying(true);
    await openMulti();
    await settle(50);
    // Even told so (the section itself never asks on touch: MultiScreenSection.wholeScreen).
    expect(header()).toBe(true);
    expect(rail()).toBe(true);
  });
});

describe('Multi-Screen: "Message the other TVs on this line"', () => {
  it('opens Settings on My Account › Devices on this line, for the line Live TV is signed into', async () => {
    const view = await openMulti();
    const w = window as unknown as { __msMessage?: () => void; __hubProps?: Record<string, unknown> };
    expect(typeof w.__msMessage).toBe('function');
    act(() => { w.__msMessage!(); });
    await until(() => (document.body.textContent ?? '').includes('settings-hub'));
    expect(w.__hubProps).toMatchObject({ initialView: 'devices', line: { host: 'http://h.test', username: 'u' } });
    view.unmount();
  });

  it('not offered on a Kids profile (Settings is a grown-up\'s)', async () => {
    setKidsLevel('little');
    const view = await openMulti();
    expect((window as unknown as { __msMessage?: () => void }).__msMessage).toBeUndefined();
    view.unmount();
  });
});
