// The Search row of the channel list over the picture, drawn: the list's
// first row, so it scrolls away with the window like any row and is back on
// top when the highlight is; while the keyboard is up, the field and the
// first 4 results only (Amazon's keyboard covers the bottom half), smaller,
// no heading, the hint right under them. Invented names only.
import { createRef } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { XtreamLiveStream } from '@/lib/xtream';
import i18n from '@/i18n';
import { channelRowLabels } from './channelRowLabels';
import FullscreenChannelOverlay, { OVERLAY_CHANNEL_ROWS, OVERLAY_TYPING_RESULTS, type OverlaySearchRow } from './FullscreenChannelOverlay';

const channels = Array.from({ length: 30 }, (_, i) => ({ stream_id: 300 + i, name: `Lakeside ${i + 1}`, num: i + 1, stream_icon: '', category_id: '1' })) as XtreamLiveStream[];
const row = (extra: Partial<OverlaySearchRow> = {}): OverlaySearchRow => ({
  focused: false, typing: false, open: false, query: '', backLeaves: false,
  inputRef: createRef<HTMLInputElement>(), onChange: () => {}, onFocus: () => {}, onBlur: () => {},
  ...extra,
});
const draw = (channelIdx: number, search: OverlaySearchRow, list = channels) => render(
  <FullscreenChannelOverlay
    pane="channels" categories={[{ id: 'l|1', label: 'Lakes' }]} categoryIdx={0} grouped={false} channels={list} channelIdx={channelIdx}
    channelsTitle={search.open ? 'Search' : 'Lakes'} loading={false} isPlaying={(st) => st.stream_id === 300} isFavorite={(st) => st.stream_id === 301}
    reportOf={() => null} nowTitle={(st) => (st.stream_id === 301 ? 'Evening Report' : undefined)} labels={channelRowLabels(i18n.t)} search={search}
  />,
);
const searchRow = () => document.querySelector<HTMLElement>('[data-overlay-search]');
const rows = () => [...document.querySelectorAll('[data-overlay-channel]')].map((r) => r.getAttribute('data-overlay-channel'));
const hint = () => document.querySelector('[data-overlay-hint]')?.textContent ?? '';
const overlayText = () => document.querySelector('[data-channel-overlay]')?.textContent ?? '';

describe('the Search row over the picture', () => {
  it('is the first of the list\'s places: on top with the first channels, scrolled away with the window further down', () => {
    const r = draw(0, row());
    expect(searchRow()).not.toBeNull();
    expect(rows().length).toBe(OVERLAY_CHANNEL_ROWS - 1);
    expect(overlayText()).toContain('1 / 30');
    r.unmount();
    draw(20, row());
    expect(searchRow()).toBeNull();
    expect(rows().length).toBe(OVERLAY_CHANNEL_ROWS);
    expect(rows()).toContain('320');
    expect(overlayText()).toContain('▲');
  });

  it('highlighted, the window is back on top; the heading counts the list, no row is lit', () => {
    draw(20, row({ focused: true }));
    expect(searchRow()?.getAttribute('data-focused')).toBe('true');
    expect(document.querySelector('[data-overlay-channel][data-focused="true"]')).toBeNull();
    expect(rows()[0]).toBe('300');
    expect(overlayText()).toContain('30');
    expect(overlayText()).not.toContain('21 / 30');
    expect(hint()).toBe('OK search · ▼ channels · ◀ categories · Back close');
  });

  it('typing: the field and the first 4 results, smaller, no heading, the hint under them', () => {
    draw(0, row({ focused: true, typing: true, open: true, query: 'lake', backLeaves: true }));
    expect(document.querySelector('[data-channel-overlay]')?.getAttribute('data-overlay-typing')).toBe('true');
    expect(rows()).toEqual(['300', '301', '302', '303']);
    expect(rows().length).toBe(OVERLAY_TYPING_RESULTS);
    expect(searchRow()!.style.height).toBe('44px');
    expect(document.querySelector<HTMLElement>('[data-overlay-channel]')!.style.height).toBe('40px');
    expect(overlayText()).not.toContain('Search');
    expect(overlayText()).not.toContain('▼');
    expect(hint()).toBe('Type a channel name · Back to pick from the results');
    // The playing one marked, the favourite starred, what is on now.
    expect(document.querySelector('[data-overlay-channel="300"] [aria-label="Playing"]')).not.toBeNull();
    expect(document.querySelector('[data-overlay-channel="301"] [aria-label="Favorite"]')).not.toBeNull();
    expect(document.querySelector('[data-overlay-channel="301"]')?.textContent).toContain('Evening Report');
    // The field takes text only now.
    expect(document.querySelector<HTMLInputElement>('[data-overlay-search-input]')!.readOnly).toBe(false);
  });

  it('the hints say what Back does: leave a search opened here, or close the list', () => {
    const r = draw(0, row({ focused: true, open: true, query: 'lake', backLeaves: true }));
    expect(hint()).toBe('OK type · ▼ results · Back channels');
    r.rerender(
      <FullscreenChannelOverlay
        pane="channels" categories={[]} categoryIdx={0} grouped={false} channels={channels} channelIdx={2}
        channelsTitle="Search" loading={false} isPlaying={() => false} isFavorite={() => false}
        reportOf={() => null} nowTitle={() => undefined} labels={channelRowLabels(i18n.t)} search={row({ open: true, query: 'lake', backLeaves: true })}
      />,
    );
    expect(hint()).toBe('▲▼ channel · OK watch · Hold OK options · ◀ categories · Back channels');
    r.unmount();
    draw(0, row({ focused: true, open: true, query: 'lake', backLeaves: false }));
    expect(hint()).toBe('OK type · ▼ results · Back close');
  });

  it('a search with nothing found, or nothing typed yet, says so under the field', () => {
    const r = draw(0, row({ focused: true, typing: true, open: true, query: 'zzz' }), []);
    expect(overlayText()).toContain('No channels match your search.');
    r.unmount();
    draw(0, row({ focused: true, open: true }), []);
    expect(overlayText()).toContain('Type above to search all channels.');
    expect(document.querySelector<HTMLInputElement>('[data-overlay-search-input]')!.placeholder).toBe('Type to search…');
  });
});
