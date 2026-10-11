// The channel list over the picture, drawn (from Tronix 23a3aa4; its dealer:
// "the category column should be compressed on first left arrow, appear if
// user left arrows again"). The list alone with the categories folded to a
// strip while the highlight is in the list; the categories beside it while
// it is in them. Its backdrop lets the picture through (owner, 2026-10-11:
// "no not solid black, the ability to see through it more"), and so does
// Recently watched over the picture; over the list that panel stays solid.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { XtreamLiveStream } from '@/lib/xtream';
import type { RecentChannel } from '@/lib/recentChannels';
import i18n from '@/i18n';
import { channelRowLabels } from './channelRowLabels';
import FullscreenChannelOverlay, { OVERLAY_CATS_W, OVERLAY_CHANNELS_W, OVERLAY_STRIP_W } from './FullscreenChannelOverlay';
import RecentChannelsPanel from './RecentChannelsPanel';

const channels = [301, 302].map((id, i) => ({ stream_id: id, name: `Channel ${i + 1}`, num: i + 1, stream_icon: '', category_id: '1' })) as XtreamLiveStream[];
const categories = [{ id: 'l|1', label: 'News' }, { id: 'l|2', label: 'Sports' }];

const draw = (pane: 'categories' | 'channels', extra: Record<string, unknown> = {}) => render(
  <FullscreenChannelOverlay
    pane={pane} categories={categories} categoryIdx={0} grouped={false} channels={channels} channelIdx={0}
    channelsTitle="News" loading={false} isPlaying={(st) => st.stream_id === 301} isFavorite={() => false}
    reportOf={() => null} nowTitle={() => undefined} labels={channelRowLabels(i18n.t)}
    {...extra}
  />,
);
const overlay = () => document.querySelector<HTMLElement>('[data-channel-overlay]')!;
const cats = () => document.querySelectorAll('[data-overlay-cat]').length;
const strip = () => document.querySelector<HTMLElement>('[data-overlay-cats-strip]');
const classes = (el: HTMLElement) => el.className.split(' ');

describe('the channel list over the picture', () => {
  it('the list alone: the categories folded to a strip, the overlay narrower, "◀ categories" in the hint', () => {
    draw('channels');
    expect(cats()).toBe(0);
    expect(strip()).not.toBeNull();
    expect(strip()!.textContent).toContain('Categories');
    expect(overlay().getAttribute('data-overlay-cats')).toBe('folded');
    expect(overlay().style.width).toBe(`${OVERLAY_STRIP_W + OVERLAY_CHANNELS_W}px`);
    expect(overlay().querySelector('[data-overlay-channel="301"][data-focused="true"]')).not.toBeNull();
    expect(overlay().textContent).toContain('◀ categories');
  });

  it('its categories open beside it (as wide as before), the highlight in them', () => {
    draw('categories', { catsBack: true });
    expect(cats()).toBe(2);
    expect(strip()).toBeNull();
    expect(overlay().getAttribute('data-overlay-cats')).toBe('open');
    expect(overlay().style.width).toBe(`${OVERLAY_CATS_W + OVERLAY_CHANNELS_W}px`);
    expect(OVERLAY_CATS_W + OVERLAY_CHANNELS_W).toBe(660);
    expect(document.querySelector('[data-overlay-cat="0"][data-focused="true"]')).not.toBeNull();
    // Back puts the list back; ◀ closes.
    expect(overlay().textContent).toContain('Back channels · ◀ close');
  });

  it('opened on the categories (no list to go back to): Back closes, as the hint says', () => {
    draw('categories');
    expect(cats()).toBe(2);
    expect(overlay().textContent).toContain('◀ or Back close');
  });

  it('black at 60% (was 90%), the picture showing through; a shadow keeps the text readable', () => {
    draw('channels');
    expect(classes(overlay())).toContain('bg-black/60');
    expect(overlay().className).not.toContain('bg-black/90');
    expect(classes(overlay())).not.toContain('bg-black');
    expect(overlay().style.textShadow).not.toBe('');
  });
});

describe('Recently watched', () => {
  const items: RecentChannel[] = [];
  const panel = () => document.querySelector<HTMLElement>('[data-recent-panel]')!;

  it('over the picture: black at 60%, as the channel list', () => {
    render(<RecentChannelsPanel items={items} focus={0} onRemove={false} playingId={null} over="picture" />);
    expect(classes(panel())).toContain('bg-black/60');
    expect(panel().className).not.toContain('bg-black/90');
    expect(panel().style.textShadow).not.toBe('');
  });

  it('over the list: solid, as before (the rows behind would show through)', () => {
    render(<RecentChannelsPanel items={items} focus={0} onRemove={false} playingId={null} over="list" />);
    expect(panel().className).toContain('bg-[#0b1220]');
    expect(panel().className).not.toContain('bg-black/');
    expect(panel().style.textShadow).toBe('');
  });
});
