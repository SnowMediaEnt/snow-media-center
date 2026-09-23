import { beforeEach, describe, expect, it } from 'vitest';
import { dueReminders, hasReminder, markFired, toggleReminder } from './gameReminders';

beforeEach(() => localStorage.clear());

describe('gameReminders', () => {
  it('toggles, comes due at kickoff, and fires once', () => {
    const start = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(toggleReminder({ id: 'nfl:1', title: 'CHI @ GB', leagueLabel: 'NFL', start, networks: ['FOX'] })).toBe(true);
    expect(hasReminder('nfl:1')).toBe(true);
    expect(dueReminders()).toHaveLength(0);
    const atKickoff = Date.parse(start);
    expect(dueReminders(atKickoff).map((r) => r.id)).toEqual(['nfl:1']);
    markFired('nfl:1');
    expect(dueReminders(atKickoff)).toHaveLength(0);
    expect(toggleReminder({ id: 'nfl:1', title: 'CHI @ GB', leagueLabel: 'NFL', start, networks: [] })).toBe(false);
    expect(hasReminder('nfl:1')).toBe(false);
  });

  it('lets a reminder go half an hour after kickoff', () => {
    const start = new Date(Date.now() - 40 * 60_000).toISOString();
    toggleReminder({ id: 'nba:2', title: 'LAL @ BOS', leagueLabel: 'NBA', start, networks: [] });
    expect(dueReminders()).toHaveLength(0);
  });
});
