/**
 * Settings › Channels › Hide categories: a held OK (the one that opened the
 * page, repeating) must not press "Show all" and clear the line's hidden
 * categories. One press does.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/xtream', async (orig) => ({
  ...(await orig<typeof import('@/lib/xtream')>()),
  loadCreds: async () => ({ host: 'http://dstreams.xyz:8080', username: 'jsmith', password: 'pw', output: 'm3u8', serverLabel: 'Dreamstreams' }),
  loadSavedAccounts: async () => [],
  loadPlayerAccount: async () => null,
  getLiveCategories: async () => [{ category_id: '1', category_name: 'News' }, { category_id: '2', category_name: 'Sports' }],
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

import HideCategoriesScreen from './HideCategoriesScreen';
import { lineKey, loadHiddenCategories, saveHiddenCategories } from '@/lib/liveLines';

const KEY = lineKey({ host: 'http://dstreams.xyz:8080', username: 'jsmith' });
const press = (init: KeyboardEventInit) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
});
const wait = () => act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });

beforeEach(() => { localStorage.clear(); });

describe('Hide categories: a held OK', () => {
  it('repeats are not presses; one press of "Show all" clears the hidden ones', async () => {
    saveHiddenCategories(KEY, new Set(['2']));
    render(<HideCategoriesScreen embedded active onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Sports')).toBeTruthy());
    await wait();
    // The highlight starts on the line's "Show all" row.
    press({ key: 'Enter', repeat: true });
    press({ key: 'Enter', repeat: true });
    expect([...loadHiddenCategories(KEY)]).toEqual(['2']);
    press({ key: 'Enter' });
    expect([...loadHiddenCategories(KEY)]).toEqual([]);
  });
});
