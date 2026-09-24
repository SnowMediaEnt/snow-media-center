import { act, render, screen } from '@testing-library/react';
import { useCallback, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { channel: vi.fn(), removeChannel: vi.fn(), functions: { invoke: vi.fn() } } }));
// Off-device: the phone's keys arrive as synthetic keydowns, like a box's DOM Back.
vi.mock('@/capacitor/AppManager', () => ({ AppManager: { injectKey: vi.fn(async () => { throw new Error('web'); }) } }));
vi.mock('@/lib/analytics', () => ({ getDeviceId: () => 'device-12345678', trackEvent: vi.fn() }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));

import { useGameBack } from '@/components/games/shared/gameBack';
import { REMOTE_HOME_EVENT } from '@/lib/phoneRemote';
import { useRemoteHome } from './useRemoteHome';

/** A casino table with the real wager-safe Back guard. */
const Table = ({ busy, onBack }: { busy: boolean; onBack: () => void }) => {
  const [note, setNote] = useState('');
  useGameBack({ isBusy: () => busy, onBlocked: () => setNote('Finish this hand first'), onExit: onBack });
  return <div>{note}</div>;
};

/** Index's navigation, in small: a stack, Back pops, navigate pushes. */
const App = ({ start, busy = false }: { start: string[]; busy?: boolean }) => {
  const [stack, setStack] = useState(start);
  const view = stack[stack.length - 1];
  const navigateTo = useCallback((v: string) => setStack((s) => (s[s.length - 1] === v ? s : [...s, v])), []);
  const goBack = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const navRef = useRef(navigateTo);
  useRemoteHome(view, navRef.current);
  return (
    <>
      <div data-testid="view">{view}</div>
      {view.startsWith('game-') && <Table busy={busy} onBack={goBack} />}
    </>
  );
};

const phoneHome = () => act(async () => {
  window.dispatchEvent(new CustomEvent(REMOTE_HOME_EVENT));
  await new Promise((r) => setTimeout(r, 0));
});
const view = () => screen.getByTestId('view').textContent;

afterEach(() => { document.body.innerHTML = ''; });

describe("the phone remote's Home", () => {
  it('goes home from an ordinary screen', async () => {
    render(<App start={['home', 'settings']} />);
    await phoneHome();
    expect(view()).toBe('home');
  });

  it('does nothing while a dialog owns input', async () => {
    render(<App start={['home', 'settings']} />);
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'alertdialog');
    dlg.setAttribute('data-state', 'open');
    document.body.appendChild(dlg);
    await phoneHome();
    expect(view()).toBe('settings');
    dlg.remove();
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    await phoneHome();
    expect(view()).toBe('settings');
  });

  it('never pulls a table away mid-hand: the game says to finish the hand', async () => {
    render(<App start={['home', 'games', 'game-blackjack']} busy />);
    await phoneHome();
    expect(view()).toBe('game-blackjack');
    expect(screen.getByText('Finish this hand first')).toBeTruthy();
  });

  it('between hands, lets the game go through its guard and carries on home', async () => {
    render(<App start={['home', 'games', 'game-blackjack']} />);
    await phoneHome();
    expect(view()).toBe('home');
  });
});
