// Live TV's lines (useLiveLines) while it is open: the outside service hides
// on its own the moment the DreamStreams / Vibez line's end date passes (a
// timer, no event), and comes back when a renewed record is saved. Storage
// and the account record are mocked; no panel is asked.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ account: null as null | Record<string, unknown> }));
vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadSavedAccounts: async () => [],
  loadPlayerAccount: async () => h.account,
  authenticateRouted: async () => { throw new Error('no panel in tests'); },
}));

import { useLiveLines } from './useLiveLines';
import type { XtreamCreds } from '@/lib/xtream';

const DS: XtreamCreds = { host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw', output: 'm3u8', serverLabel: 'Dreamstreams' };
const SOURCE = [{ id: 'x:faraway.example|viewer', kind: 'xtream', name: 'Faraway TV', host: 'http://faraway.example:8000', username: 'viewer', password: 'pw2', owner: 'dstreams.xyz|jsmith', addedAt: 1 }];
const labels = (lines: XtreamCreds[]) => lines.map((l) => l.serverLabel);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('snow-livetv-outside-sources-v1', JSON.stringify(SOURCE));
  // Ends in about two seconds (end dates are whole seconds).
  h.account = { host: DS.host, username: DS.username, status: 'Active', expDate: Math.floor(Date.now() / 1000) + 2, lastCheckedAt: Date.now() };
});

describe('useLiveLines', () => {
  it('hides the outside service when the line\'s end date passes while Live TV is open, and shows it again after a renewal', { timeout: 10000 }, async () => {
    const { result } = renderHook(() => useLiveLines(DS));
    await waitFor(() => expect(labels(result.current)).toEqual(['Dreamstreams', 'Faraway TV']));
    const before = result.current;
    // A refresh that changes nothing keeps the same list (nothing reloads for it).
    act(() => { window.dispatchEvent(new CustomEvent('playerAccountRefresh')); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(result.current).toBe(before);
    // The end date passes: no event, the timer.
    await waitFor(() => expect(labels(result.current)).toEqual(['Dreamstreams']), { timeout: 5000 });
    // Renewed: the record is saved again.
    h.account = { ...h.account, expDate: Math.floor(Date.now() / 1000) + 30 * 86400, lastCheckedAt: Date.now() };
    act(() => { window.dispatchEvent(new CustomEvent('playerAccountRefresh')); });
    await waitFor(() => expect(labels(result.current)).toEqual(['Dreamstreams', 'Faraway TV']));
  });
});
