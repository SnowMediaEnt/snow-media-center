// One Back used to close both a device message and the kickoff reminder under
// it: the message's listener closed it and marked the press, and the
// reminder's own backButton listener ignored that mark.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const cap = vi.hoisted(() => ({ back: [] as Array<() => void> }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (ev: string, cb: () => void) => {
      if (ev === 'backButton') cap.back.push(cb);
      return { remove() { cap.back = cap.back.filter((f) => f !== cb); } };
    },
  },
}));
const REMINDER = { id: 'g1', title: 'Harbor Hawks @ Valley Rams', leagueLabel: 'Pro', networks: [], channel: null };
const due = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock('@/lib/gameReminders', () => ({ dueReminders: () => due.list, markFired: () => { due.list = []; } }));
vi.mock('@/lib/kidsFilter', () => ({ kidsLevel: () => null }));
vi.mock('@/lib/appActions', () => ({ openGameDayGame: vi.fn(), playLiveChannel: vi.fn() }));

import GameReminderHost from './GameReminderHost';

type W = Window & { __overlayHandledBackAt?: number };
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const hardwareBack = () => act(() => { for (const f of [...cap.back]) f(); });
const reminderUp = () => !!screen.queryByText(REMINDER.title);

beforeEach(() => { cap.back = []; due.list = [REMINDER]; (window as W).__overlayHandledBackAt = 0; });
afterEach(() => { cleanup(); document.body.innerHTML = ''; });

describe('the kickoff reminder and Back', () => {
  it('a device message drawn over it takes the Back; the reminder stays', async () => {
    render(<GameReminderHost navigate={vi.fn()} />);
    await flush();
    expect(reminderUp()).toBe(true);
    const msg = document.createElement('div');
    msg.setAttribute('data-device-message', 'admin');
    document.body.appendChild(msg);
    hardwareBack();
    expect(reminderUp()).toBe(true);
  });

  it('a press another popup just answered (and closed on) is not the reminder\'s', async () => {
    render(<GameReminderHost navigate={vi.fn()} />);
    await flush();
    (window as W).__overlayHandledBackAt = Date.now();
    hardwareBack();
    expect(reminderUp()).toBe(true);
  });

  it('a Back of its own closes it', async () => {
    render(<GameReminderHost navigate={vi.fn()} />);
    await flush();
    hardwareBack();
    expect(reminderUp()).toBe(false);
  });
});
