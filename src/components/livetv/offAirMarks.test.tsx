// "Off the air" wherever a channel is listed (offair-status): the channel
// list's rows in every layout (slim rows and the logo wall too), the list
// over the picture and a search typed there, Recently watched, and the
// warning before it plays. Invented names only.
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { XtreamLiveStream } from '@/lib/xtream';
import type { RecentChannel } from '@/lib/recentChannels';
import i18n from '@/i18n';
import ChannelRow from './ChannelRow';
import ChannelWarningDialog from './ChannelWarningDialog';
import FullscreenChannelOverlay, { type OverlaySearchRow } from './FullscreenChannelOverlay';
import RecentChannelsPanel from './RecentChannelsPanel';
import { channelRowLabels } from './channelRowLabels';

const ch = { stream_id: 1, name: 'Lakeside News', num: 5, stream_icon: '', category_id: '1' } as XtreamLiveStream;

describe('a channel row off the air', () => {
  it.each(['classic', 'compact', 'tile', 'slim'] as const)('says "Off the air" in the %s layout, in red', (variant) => {
    render(<ChannelRow channel={ch} index={0} isFocused={false} isPlaying={false} isFavorite={false} report="offair" onSelect={() => {}} onActivate={() => {}} variant={variant} />);
    expect(screen.getAllByLabelText('Off the air').length).toBeGreaterThan(0);
    const mark = document.querySelector('[data-report="offair"]')!;
    // The triangle itself, or the badge holding it on a tile.
    expect(mark.matches('.text-red-400') || !!mark.querySelector('.text-red-400')).toBe(true);
    expect(screen.queryAllByLabelText('Reported down right now')).toEqual([]);
  });

  it('the logo wall (Compact) too', () => {
    render(<ChannelRow channel={ch} index={0} isFocused={false} isPlaying={false} isFavorite={false} report="offair" onSelect={() => {}} onActivate={() => {}} variant="tile" compactTile />);
    expect(document.querySelector('[data-report="offair"]')?.getAttribute('aria-label')).toBe('Off the air');
  });

  it('the tall row and the slim row put it in words', () => {
    const { unmount } = render(<ChannelRow channel={ch} index={0} isFocused={false} isPlaying={false} isFavorite={false} report="offair" onSelect={() => {}} onActivate={() => {}} variant="classic" />);
    expect(document.body.textContent).toContain("Off the air right now — it won't play until it's back");
    unmount();
    render(<ChannelRow channel={ch} index={0} isFocused={false} isPlaying={false} isFavorite={false} report="offair" onSelect={() => {}} onActivate={() => {}} variant="slim" />);
    expect(document.querySelector('[data-slim-now]')?.textContent).toBe('Off the air');
  });
});

describe('the list over the picture', () => {
  const channels = [301, 302].map((id, i) => ({ stream_id: id, name: `Lakeside ${i + 1}`, num: i + 1, stream_icon: '', category_id: '1' })) as XtreamLiveStream[];
  const search = (extra: Partial<OverlaySearchRow> = {}): OverlaySearchRow => ({
    focused: false, typing: false, open: false, query: '', backLeaves: false,
    inputRef: createRef<HTMLInputElement>(), onChange: () => {}, onFocus: () => {}, onBlur: () => {},
    ...extra,
  });
  const draw = (s?: OverlaySearchRow) => render(
    <FullscreenChannelOverlay
      pane="channels" categories={[{ id: 'l|1', label: 'Lakes' }]} categoryIdx={0} grouped={false} channels={channels} channelIdx={1}
      channelsTitle={s?.open ? 'Search' : 'Lakes'} loading={false} isPlaying={() => false} isFavorite={() => false}
      reportOf={(st) => (st.stream_id === 301 ? 'offair' : null)} nowTitle={() => 'Evening Report'} labels={channelRowLabels(i18n.t)} search={s}
    />,
  );
  const rowText = (id: number) => document.querySelector(`[data-overlay-channel="${id}"]`)?.textContent ?? '';

  it('says "Off the air" in place of what is on', () => {
    draw();
    expect(rowText(301)).toContain('Off the air');
    expect(rowText(301)).not.toContain('Evening Report');
    expect(rowText(302)).toContain('Evening Report');
  });

  it('and in a search typed there', () => {
    draw(search({ open: true, query: 'lake' }));
    expect(rowText(301)).toContain('Off the air');
  });
});

describe('Recently watched', () => {
  const line = { host: 'http://h.test', username: 'u', password: 'p' } as never;
  const item = (id: number, name: string): RecentChannel => ({
    key: `k${id}`, id: `h.test|u|${id}`, name, num: id, category: 'Weather', line, watchedAt: 1,
    stream: { stream_id: id, name, category_id: '1' } as XtreamLiveStream,
  });

  it('marks one off the air, in words where its category was', () => {
    const reportOf = vi.fn((c: RecentChannel) => (c.stream.stream_id === 7 ? 'offair' as const : null));
    render(<RecentChannelsPanel items={[item(7, 'Lakeside News'), item(8, 'Hillside Sports')]} focus={1} onRemove={false} playingId={null} over="list" reportOf={reportOf} />);
    const off = document.querySelector('[data-recent-row="h.test|u|7"]')!;
    expect(off.textContent).toContain('Off the air');
    expect(off.textContent).not.toContain('Weather');
    expect(off.querySelector('[data-recent-report="offair"]')?.getAttribute('aria-label')).toBe('Off the air');
    const fine = document.querySelector('[data-recent-row="h.test|u|8"]')!;
    expect(fine.textContent).toContain('Weather');
    expect(fine.querySelector('[data-recent-report]')).toBeNull();
  });
});

describe('the warning before it plays', () => {
  it('says it is off the air, with Watch anyway / Pick another', () => {
    render(<ChannelWarningDialog channelName="Lakeside News" report="offair" onWatch={() => {}} onPickAnother={() => {}} />);
    expect(document.querySelector('[data-channel-warning="offair"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Off the air — Lakeside News');
    expect(document.body.textContent).toContain("This channel isn't on the air right now — it won't play until it's back.");
    expect(document.body.textContent).toContain('Watch anyway');
    expect(document.body.textContent).toContain('Pick another');
  });
});
