// Multi-Screen (multiview) section. Native-only. Up to 4 tiles rendered by the
// SnowPlayer native surface BEHIND the transparent WebView; the grid paints
// chrome only (gaps, borders, labels).
import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { App as CapApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, Plus, Tv, X, ChevronRight } from 'lucide-react';
import {
  buildNativeLiveUrl,
  getLiveCategories,
  getLiveStreams,
  getShortEpg,
  loadFavoritesData,
  pickNowNext,
  XTREAM_REFRESH_EVENT,
  type EpgNowNext,
  type XtreamCategory,
  type XtreamCreds,
  type XtreamLiveStream,
} from '@/lib/xtream';
import { hasNativePlayer } from '@/capacitor/SnowPlayer';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import {
  useMultiScreenPlayers,
  MS_SLOT_IDS,
  type MultiScreenId,
} from '@/hooks/useMultiScreenPlayers';
import { trackEvent } from '@/lib/analytics';
import ChannelRow from './ChannelRow';

type Layout = '2h' | '2v' | '4';

interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp: () => void;
}

interface TileState {
  channel: XtreamLiveStream | null;
  nowNext?: EpgNowNext;
}

const ROW_HEIGHT = 84;

const LAYOUT_TILE_COUNT: Record<Layout, number> = { '2h': 2, '2v': 2, '4': 4 };

// Once dismissed the 4-grid buffering hint stays hidden for the session.
let hintDismissedForSession = false;

const tilesForLayout = (layout: Layout): Array<{ id: MultiScreenId; rect: { left: string; top: string; width: string; height: string } }> => {
  if (layout === '2h') {
    return [
      { id: 'ms1', rect: { left: '0%', top: '0%', width: '50%', height: '100%' } },
      { id: 'ms2', rect: { left: '50%', top: '0%', width: '50%', height: '100%' } },
    ];
  }
  if (layout === '2v') {
    return [
      { id: 'ms1', rect: { left: '0%', top: '0%', width: '100%', height: '50%' } },
      { id: 'ms2', rect: { left: '0%', top: '50%', width: '100%', height: '50%' } },
    ];
  }
  return [
    { id: 'ms1', rect: { left: '0%', top: '0%', width: '50%', height: '50%' } },
    { id: 'ms2', rect: { left: '50%', top: '0%', width: '50%', height: '50%' } },
    { id: 'ms3', rect: { left: '0%', top: '50%', width: '50%', height: '50%' } },
    { id: 'ms4', rect: { left: '50%', top: '50%', width: '50%', height: '50%' } },
  ];
};

const layoutNeighbor = (layout: Layout, idx: number, dir: 'up' | 'down' | 'left' | 'right'): number | null => {
  if (layout === '2h') {
    if (dir === 'left' && idx === 1) return 0;
    if (dir === 'right' && idx === 0) return 1;
    return null;
  }
  if (layout === '2v') {
    if (dir === 'up' && idx === 1) return 0;
    if (dir === 'down' && idx === 0) return 1;
    return null;
  }
  // 4 grid: 0 1 / 2 3
  const row = idx < 2 ? 0 : 1;
  const col = idx % 2;
  let r = row, c = col;
  if (dir === 'up') r = Math.max(0, row - 1);
  else if (dir === 'down') r = Math.min(1, row + 1);
  else if (dir === 'left') c = Math.max(0, col - 1);
  else if (dir === 'right') c = Math.min(1, col + 1);
  const n = r * 2 + c;
  return n === idx ? null : n;
};

const MultiScreenSection = memo(({ creds, isActive, onExitLeft, onExitUp: _onExitUp }: Props) => {
  const native = hasNativePlayer();
  const { account, refresh: refreshAccount } = usePlayerAccount();

  // Re-render on playerAccountRefresh
  useEffect(() => {
    const h = () => { void refreshAccount(); };
    window.addEventListener('playerAccountRefresh', h);
    return () => window.removeEventListener('playerAccountRefresh', h);
  }, [refreshAccount]);

  const [layout, setLayout] = useState<Layout | null>(null);
  const [pickerIdx, setPickerIdx] = useState(0); // layout picker focus
  const [focusedTile, setFocusedTile] = useState(0);
  const [fullscreenSlot, setFullscreenSlot] = useState<MultiScreenId | null>(null);
  const [tileMenuOpen, setTileMenuOpen] = useState(false);
  const [tileMenuIdx, setTileMenuIdx] = useState(0);
  const [pickerOpenForTile, setPickerOpenForTile] = useState<number | null>(null);
  const [pickerPane, setPickerPane] = useState<'cat' | 'ch'>('cat');
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [channelIdx, setChannelIdx] = useState(0);
  const [showHint, setShowHint] = useState(false);

  const [tiles, setTiles] = useState<TileState[]>(() => [
    { channel: null }, { channel: null }, { channel: null }, { channel: null },
  ]);

  const {
    slots, loadSlot, closeSlot, applyRect, focusAudio, stopAll,
  } = useMultiScreenPlayers();

  // Picker data
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const channelsCacheRef = useRef<Map<string, XtreamLiveStream[]>>(new Map());
  const [channels, setChannels] = useState<XtreamLiveStream[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);

  // Refs for stale-closure-free capture handler
  const layoutRef = useRef(layout);
  const focusedTileRef = useRef(focusedTile);
  const fullscreenSlotRef = useRef(fullscreenSlot);
  const tileMenuOpenRef = useRef(tileMenuOpen);
  const tileMenuIdxRef = useRef(tileMenuIdx);
  const pickerOpenForTileRef = useRef(pickerOpenForTile);
  const pickerPaneRef = useRef(pickerPane);
  const categoryIdxRef = useRef(categoryIdx);
  const channelIdxRef = useRef(channelIdx);
  const pickerIdxRef = useRef(pickerIdx);
  const categoriesRef = useRef(categories);
  const channelsRef = useRef(channels);
  const tilesRef = useRef(tiles);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => { focusedTileRef.current = focusedTile; }, [focusedTile]);
  useEffect(() => { fullscreenSlotRef.current = fullscreenSlot; }, [fullscreenSlot]);
  useEffect(() => { tileMenuOpenRef.current = tileMenuOpen; }, [tileMenuOpen]);
  useEffect(() => { tileMenuIdxRef.current = tileMenuIdx; }, [tileMenuIdx]);
  useEffect(() => { pickerOpenForTileRef.current = pickerOpenForTile; }, [pickerOpenForTile]);
  useEffect(() => { pickerPaneRef.current = pickerPane; }, [pickerPane]);
  useEffect(() => { categoryIdxRef.current = categoryIdx; }, [categoryIdx]);
  useEffect(() => { channelIdxRef.current = channelIdx; }, [channelIdx]);
  useEffect(() => { pickerIdxRef.current = pickerIdx; }, [pickerIdx]);
  useEffect(() => { categoriesRef.current = categories; }, [categories]);
  useEffect(() => { channelsRef.current = channels; }, [channels]);
  useEffect(() => { tilesRef.current = tiles; }, [tiles]);

  // Grid tile refs
  const gridRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<Array<HTMLDivElement | null>>([null, null, null, null]);

  // Load categories once, with Favorites bucket first.
  useEffect(() => {
    if (!layout) return;
    let cancelled = false;
    (async () => {
      try {
        const cats = await getLiveCategories(creds);
        if (cancelled) return;
        const withFav = [
          { id: '__favs__', name: 'Favorites' },
          ...cats.map(c => ({ id: c.category_id, name: c.category_name })),
        ];
        setCategories(withFav);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [layout, creds]);

  // Clear channel cache on refresh event
  useEffect(() => {
    const onRefresh = () => {
      channelsCacheRef.current.clear();
      // Refresh current channel list if picker is open
      const cat = categoriesRef.current[categoryIdxRef.current];
      if (cat && pickerOpenForTileRef.current !== null) {
        void loadChannelsFor(cat.id);
      }
    };
    window.addEventListener(XTREAM_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(XTREAM_REFRESH_EVENT, onRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadChannelsFor = useCallback(async (catId: string) => {
    if (catId === '__favs__') {
      const favs = Array.from(loadFavoritesData().values()).map(f => ({
        stream_id: f.stream_id,
        name: f.name,
        num: f.num,
        stream_icon: f.stream_icon,
        category_id: f.category_id,
        epg_channel_id: f.epg_channel_id,
      })) as XtreamLiveStream[];
      setChannels(favs);
      channelsCacheRef.current.set(catId, favs);
      return;
    }
    const cached = channelsCacheRef.current.get(catId);
    if (cached) { setChannels(cached); return; }
    setLoadingChannels(true);
    try {
      const list = await getLiveStreams(creds, catId);
      channelsCacheRef.current.set(catId, list);
      setChannels(list);
    } catch {
      setChannels([]);
    } finally {
      setLoadingChannels(false);
    }
  }, [creds]);

  // When channel pane opens or category changes, load channels.
  useEffect(() => {
    if (pickerOpenForTile === null) return;
    const cat = categories[categoryIdx];
    if (!cat) return;
    void loadChannelsFor(cat.id);
    setChannelIdx(0);
  }, [categoryIdx, pickerOpenForTile, categories, loadChannelsFor]);

  // Measure tiles → applyRect for each occupied slot.
  const measureAndApply = useCallback(() => {
    if (!layout) return;
    if (fullscreenSlotRef.current) {
      // Fullscreen: single slot to native fullscreen (w/h<=0)
      void applyRect(fullscreenSlotRef.current, { x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const grid = gridRef.current;
    if (!grid) return;
    const spec = tilesForLayout(layout);
    for (let i = 0; i < spec.length; i++) {
      const el = tileRefs.current[i];
      const sid = spec[i].id;
      const s = slots[sid];
      if (!el || !s.url) continue;
      const r = el.getBoundingClientRect();
      void applyRect(sid, { x: r.left, y: r.top, width: r.width, height: r.height });
    }
  }, [layout, slots, applyRect]);

  useEffect(() => {
    if (!layout) return;
    // Rect after layout/paint
    const raf = requestAnimationFrame(() => measureAndApply());
    return () => cancelAnimationFrame(raf);
  }, [layout, fullscreenSlot, measureAndApply, tiles]);

  useEffect(() => {
    const onResize = () => measureAndApply();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [measureAndApply]);

  // Fetch EPG for tile after channel set
  const fetchEpgForTile = useCallback(async (tileIdx: number, streamId: number) => {
    try {
      const res = await getShortEpg(creds, streamId, 4);
      const nn = pickNowNext(res.epg_listings || []);
      setTiles(prev => {
        const copy = prev.slice();
        if (copy[tileIdx]?.channel?.stream_id === streamId) {
          copy[tileIdx] = { ...copy[tileIdx], nowNext: nn };
        }
        return copy;
      });
    } catch { /* ignore */ }
  }, [creds]);

  // Focus audio when focused tile changes
  useEffect(() => {
    if (!layout) return;
    const spec = tilesForLayout(layout);
    const sid = spec[focusedTile]?.id;
    if (!sid) return;
    const s = slots[sid];
    void focusAudio(s?.url ? sid : null);
  }, [focusedTile, layout, slots, focusAudio]);

  // 4-grid hint bar: any slot buffering > 6s
  useEffect(() => {
    if (layout !== '4' || hintDismissedForSession) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      const bad = MS_SLOT_IDS.some(sid => {
        const s = slots[sid];
        return s.url && s.buffering && s.bufferingSince && (now - s.bufferingSince) > 6000;
      });
      if (bad && !showHint) setShowHint(true);
    }, 1000);
    return () => window.clearInterval(id);
  }, [layout, slots, showHint]);

  // Teardown on isActive=false / unmount
  useEffect(() => {
    if (isActive) return;
    void stopAll();
    setLayout(null);
    setFullscreenSlot(null);
    setTileMenuOpen(false);
    setPickerOpenForTile(null);
    setTiles([{ channel: null }, { channel: null }, { channel: null }, { channel: null }]);
  }, [isActive, stopAll]);

  // ── Handlers ───────────────────────────────────────────────────────────
  const chooseLayout = useCallback((l: Layout) => {
    setLayout(l);
    setFocusedTile(0);
  }, []);

  const openTileForChannel = useCallback(async (tileIdx: number, ch: XtreamLiveStream) => {
    if (!layout) return;
    const spec = tilesForLayout(layout);
    const sid = spec[tileIdx]?.id;
    if (!sid) return;
    // Update tile state first so measure sees it as occupied
    setTiles(prev => {
      const copy = prev.slice();
      copy[tileIdx] = { channel: ch, nowNext: undefined };
      return copy;
    });
    // Measure THIS tile now and applyRect BEFORE loadSlot
    requestAnimationFrame(async () => {
      const el = tileRefs.current[tileIdx];
      if (el) {
        const r = el.getBoundingClientRect();
        await applyRect(sid, { x: r.left, y: r.top, width: r.width, height: r.height });
      }
      const url = buildNativeLiveUrl(creds, ch.stream_id);
      await loadSlot(sid, url);
      await focusAudio(sid);
      void fetchEpgForTile(tileIdx, ch.stream_id);
      const occupiedCount = tilesRef.current.filter(t => t.channel).length;
      try { trackEvent('multi_screen_play', 'player', { layout, tiles: occupiedCount }); } catch { /* ignore */ }
    });
  }, [layout, applyRect, loadSlot, focusAudio, creds, fetchEpgForTile]);

  const closeTile = useCallback(async (tileIdx: number) => {
    if (!layout) return;
    const spec = tilesForLayout(layout);
    const sid = spec[tileIdx]?.id;
    if (!sid) return;
    await closeSlot(sid);
    setTiles(prev => {
      const copy = prev.slice();
      copy[tileIdx] = { channel: null };
      return copy;
    });
    // Refocus audio to first remaining
    const firstRemaining = spec.findIndex((sp, i) => i !== tileIdx && tilesRef.current[i]?.channel);
    if (firstRemaining >= 0) await focusAudio(spec[firstRemaining].id); else await focusAudio(null);
  }, [layout, closeSlot, focusAudio]);

  const openTileMenu = useCallback(() => {
    setTileMenuIdx(0);
    setTileMenuOpen(true);
  }, []);

  const openPickerForTile = useCallback((tileIdx: number) => {
    setPickerOpenForTile(tileIdx);
    setPickerPane('cat');
    setCategoryIdx(0);
    setChannelIdx(0);
  }, []);

  const enterFullscreen = useCallback(async (tileIdx: number) => {
    if (!layout) return;
    const spec = tilesForLayout(layout);
    const sid = spec[tileIdx]?.id;
    if (!sid) return;
    setFullscreenSlot(sid);
    await applyRect(sid, { x: 0, y: 0, width: 0, height: 0 });
    await focusAudio(sid);
  }, [layout, applyRect, focusAudio]);

  const exitFullscreen = useCallback(() => {
    setFullscreenSlot(null);
    // Re-measure all occupied
    requestAnimationFrame(() => measureAndApply());
  }, [measureAndApply]);

  // Categories virtualizer
  const catScrollRef = useRef<HTMLDivElement | null>(null);
  const chScrollRef = useRef<HTMLDivElement | null>(null);
  const catVirtualizer = useVirtualizer({
    count: categories.length,
    getScrollElement: () => catScrollRef.current,
    estimateSize: () => 48,
    overscan: 4,
    getItemKey: (i) => categories[i]?.id ?? i,
  });
  const chVirtualizer = useVirtualizer({
    count: channels.length,
    getScrollElement: () => chScrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 2,
    getItemKey: (i) => channels[i]?.stream_id ?? i,
  });

  // Manual scrollTop tracking (never scrollIntoView)
  useEffect(() => {
    if (pickerOpenForTile === null || pickerPane !== 'ch') return;
    const node = chScrollRef.current; if (!node) return;
    if (channelIdx === 0) { node.scrollTop = 0; return; }
    const top = channelIdx * ROW_HEIGHT;
    const bot = top + ROW_HEIGHT;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (bot > node.scrollTop + node.clientHeight) node.scrollTop = bot - node.clientHeight;
  }, [channelIdx, pickerOpenForTile, pickerPane]);

  useEffect(() => {
    if (pickerOpenForTile === null || pickerPane !== 'cat') return;
    try { catVirtualizer.scrollToIndex(categoryIdx, { align: 'auto' }); } catch { /* ignore */ }
  }, [categoryIdx, pickerOpenForTile, pickerPane, catVirtualizer]);

  // ── Keyboard handler ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isActive || !native) return;
    const consume = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    };
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;

      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;

      // Layout picker screen
      if (!layoutRef.current) {
        if (isBack) { consume(e); onExitLeft(); return; }
        if (e.key === 'ArrowLeft') { consume(e); setPickerIdx(i => Math.max(0, i - 1)); return; }
        if (e.key === 'ArrowRight') { consume(e); setPickerIdx(i => Math.min(2, i + 1)); return; }
        if (e.key === 'Enter' || e.key === ' ') {
          consume(e);
          const opts: Layout[] = ['2h', '2v', '4'];
          chooseLayout(opts[pickerIdxRef.current]);
        }
        return;
      }

      // Tile menu open
      if (tileMenuOpenRef.current) {
        if (isBack) { consume(e); setTileMenuOpen(false); return; }
        if (e.key === 'ArrowUp') { consume(e); setTileMenuIdx(i => Math.max(0, i - 1)); return; }
        if (e.key === 'ArrowDown') { consume(e); setTileMenuIdx(i => Math.min(2, i + 1)); return; }
        if (e.key === 'Enter' || e.key === ' ') {
          consume(e);
          const idx = tileMenuIdxRef.current;
          const tIdx = focusedTileRef.current;
          setTileMenuOpen(false);
          if (idx === 0) openPickerForTile(tIdx);
          else if (idx === 1) void enterFullscreen(tIdx);
          else if (idx === 2) void closeTile(tIdx);
        }
        return;
      }

      // Picker open
      if (pickerOpenForTileRef.current !== null) {
        if (isBack) {
          consume(e);
          if (pickerPaneRef.current === 'ch') setPickerPane('cat');
          else setPickerOpenForTile(null);
          return;
        }
        if (pickerPaneRef.current === 'cat') {
          if (e.key === 'ArrowUp') { consume(e); setCategoryIdx(i => Math.max(0, i - 1)); return; }
          if (e.key === 'ArrowDown') { consume(e); setCategoryIdx(i => Math.min(categoriesRef.current.length - 1, i + 1)); return; }
          if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
            consume(e); setPickerPane('ch');
          }
          return;
        }
        // channels pane
        if (e.key === 'ArrowLeft') { consume(e); setPickerPane('cat'); return; }
        if (e.key === 'ArrowUp') { consume(e); setChannelIdx(i => Math.max(0, i - 1)); return; }
        if (e.key === 'ArrowDown') { consume(e); setChannelIdx(i => Math.min(channelsRef.current.length - 1, i + 1)); return; }
        if (e.key === 'Enter' || e.key === ' ') {
          consume(e);
          const ch = channelsRef.current[channelIdxRef.current];
          const tIdx = pickerOpenForTileRef.current;
          if (ch && tIdx !== null) {
            setPickerOpenForTile(null);
            void openTileForChannel(tIdx, ch);
          }
        }
        return;
      }

      // Fullscreen tile
      if (fullscreenSlotRef.current) {
        if (isBack) { consume(e); exitFullscreen(); return; }
        return;
      }

      // Grid navigation
      if (isBack) {
        consume(e);
        void stopAll();
        setTiles([{ channel: null }, { channel: null }, { channel: null }, { channel: null }]);
        setLayout(null);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const dir = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowLeft' ? 'left' : 'right';
        const n = layoutNeighbor(layoutRef.current, focusedTileRef.current, dir);
        if (n !== null) { consume(e); setFocusedTile(n); }
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        consume(e);
        const tIdx = focusedTileRef.current;
        const t = tilesRef.current[tIdx];
        if (t?.channel) openTileMenu();
        else openPickerForTile(tIdx);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, native, chooseLayout, enterFullscreen, openPickerForTile, closeTile, exitFullscreen, stopAll, openTileForChannel]);

  // Hardware back
  useEffect(() => {
    if (!isActive || !native) return;
    let handle: PluginListenerHandle | undefined;
    let cancelled = false;
    (async () => {
      try {
        const h = await CapApp.addListener('backButton', () => {
          (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
          try {
            document.body.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
            }));
          } catch { /* ignore */ }
        });
        if (cancelled) h.remove(); else handle = h;
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; try { handle?.remove(); } catch { /* ignore */ } };
  }, [isActive, native]);

  // ── Render ─────────────────────────────────────────────────────────────
  if (!native) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center p-6 rounded-2xl bg-black/60 border border-white/10">
          <Tv className="w-10 h-10 mx-auto text-brand-gold mb-3" />
          <h2 className="text-xl font-quicksand font-bold text-white mb-2">Multi-Screen needs the Fire TV / Android app</h2>
          <p className="text-sm text-brand-ice/70 font-nunito">
            Multi-Screen runs four native video players at once, which the web preview can't do. Open the installed app on your Fire TV or Android device.
          </p>
        </div>
      </div>
    );
  }

  // Layout picker
  if (!layout) {
    const cards: Array<{ id: Layout; label: string; sub: string; need: number }> = [
      { id: '2h', label: '2 Screens', sub: 'Side by Side', need: 2 },
      { id: '2v', label: '2 Screens', sub: 'Stacked', need: 2 },
      { id: '4',  label: '4 Screens', sub: 'Grid', need: 4 },
    ];
    const maxCon = account?.maxConnections ?? null;
    const active = account?.activeCons ?? 0;
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-8">
        <h2 className="text-2xl font-quicksand font-bold text-white">Choose a Multi-Screen layout</h2>
        <div className="flex gap-4">
          {cards.map((c, i) => {
            const overplan = maxCon !== null && c.need > maxCon;
            const focused = pickerIdx === i;
            return (
              <div
                key={c.id}
                data-focused={focused ? 'true' : 'false'}
                onClick={() => { setPickerIdx(i); chooseLayout(c.id); }}
                className={`w-56 h-40 rounded-2xl p-5 border cursor-pointer flex flex-col justify-between transition-transform duration-150 ${
                  focused
                    ? 'bg-brand-gold/20 border-brand-gold scale-105 shadow-[0_0_22px_2px_rgba(245,200,80,0.4)]'
                    : 'bg-black/60 border-white/15'
                }`}
              >
                <div>
                  <div className="text-xs uppercase tracking-wider text-brand-ice/60 font-nunito">{c.sub}</div>
                  <div className="text-2xl font-quicksand font-bold text-white mt-1">{c.label}</div>
                </div>
                {overplan && (
                  <div className="text-[11px] text-amber-300 font-nunito leading-snug">
                    Your plan allows {maxCon} stream{maxCon === 1 ? '' : 's'} — extra screens may not play.
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {maxCon !== null && (
          <div className="text-sm text-brand-ice/70 font-nunito">
            Your plan: {active} active / {maxCon} connections allowed
          </div>
        )}
      </div>
    );
  }

  // Grid mode
  const spec = tilesForLayout(layout);
  return (
    <div className="flex-1 relative overflow-hidden bg-black">
      {/* Transparent grid; native video renders BEHIND */}
      <div ref={gridRef} className="absolute inset-0">
        {spec.map((sp, i) => {
          const tile = tiles[i];
          const s = slots[sp.id];
          const isFocused = focusedTile === i;
          const occupied = !!tile?.channel;
          const chromeHidden = fullscreenSlot === sp.id;
          return (
            <div
              key={sp.id}
              ref={(el) => { tileRefs.current[i] = el; }}
              style={{
                position: 'absolute',
                left: sp.rect.left,
                top: sp.rect.top,
                width: sp.rect.width,
                height: sp.rect.height,
                padding: 2,
              }}
            >
              <div
                data-focused={isFocused && !chromeHidden ? 'true' : 'false'}
                className={`ms-tile w-full h-full rounded-md relative ${
                  occupied ? '' : 'bg-black'
                } ${
                  chromeHidden ? '' : (isFocused
                    ? 'ring-[3px] ring-brand-gold'
                    : 'ring-1 ring-white/20')
                }`}
              >
                {!chromeHidden && !occupied && (
                  <div className="w-full h-full flex flex-col items-center justify-center text-brand-ice/70">
                    <Plus className="w-10 h-10 mb-1" />
                    <span className="text-sm font-nunito">Add channel</span>
                  </div>
                )}
                {!chromeHidden && occupied && (
                  <>
                    {/* channel pill */}
                    <div className="absolute left-2 bottom-2 max-w-[70%] px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm">
                      <div className="text-xs text-white font-quicksand font-semibold truncate">{tile.channel!.name}</div>
                      {tile.nowNext?.now && (
                        <div className="text-[10px] text-brand-ice/70 font-nunito truncate">{tile.nowNext.now.title}</div>
                      )}
                    </div>
                    {s.buffering && !s.error && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
                      </div>
                    )}
                    {s.error && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 p-3 text-center">
                        <div className="text-sm text-white font-quicksand font-semibold mb-1">{s.error}</div>
                        <div className="text-xs text-brand-ice/60 font-nunito">OK to retry</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tile menu */}
      {tileMenuOpen && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto bg-brand-navy border border-white/15 rounded-2xl p-3 w-64 shadow-2xl">
            {['Fullscreen', 'Change channel', 'Close screen'].map((label, i) => (
              <div
                key={label}
                data-focused={tileMenuIdx === i ? 'true' : 'false'}
                className={`px-4 py-3 rounded-lg cursor-pointer font-quicksand font-semibold ${
                  tileMenuIdx === i ? 'bg-brand-gold/25 text-white ring-2 ring-brand-gold' : 'text-brand-ice hover:bg-white/5'
                }`}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Channel picker (solid bg overlay, right side ~40%) */}
      {pickerOpenForTile !== null && (
        <div className="absolute top-0 right-0 bottom-0 z-40 w-[40%] min-w-[420px] bg-brand-navy/95 border-l border-white/10 flex flex-col">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <div className="text-white font-quicksand font-bold">Add channel to screen {pickerOpenForTile + 1}</div>
            <button
              onClick={() => setPickerOpenForTile(null)}
              className="p-1 text-brand-ice/70 hover:text-white"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 flex">
            {/* Categories */}
            <div
              ref={catScrollRef}
              className={`w-1/2 overflow-y-auto border-r border-white/10 ${pickerPane === 'cat' ? 'bg-white/5' : ''}`}
            >
              <div style={{ height: catVirtualizer.getTotalSize(), position: 'relative' }}>
                {catVirtualizer.getVirtualItems().map(v => {
                  const c = categories[v.index];
                  if (!c) return null;
                  const focused = pickerPane === 'cat' && categoryIdx === v.index;
                  const selected = categoryIdx === v.index;
                  return (
                    <div
                      key={c.id}
                      style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)`, height: 48 }}
                      className="px-3 py-2"
                    >
                      <div
                        data-focused={focused ? 'true' : 'false'}
                        onClick={() => { setCategoryIdx(v.index); setPickerPane('ch'); }}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm font-quicksand ${
                          focused ? 'bg-brand-gold/25 ring-2 ring-brand-gold text-white'
                            : selected ? 'bg-white/10 text-white' : 'text-brand-ice hover:bg-white/5'
                        }`}
                      >
                        <span className="truncate">{c.name}</span>
                        <ChevronRight className="w-4 h-4 flex-shrink-0 opacity-60" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Channels */}
            <div
              ref={chScrollRef}
              className={`w-1/2 overflow-y-auto ${pickerPane === 'ch' ? 'bg-white/5' : ''}`}
            >
              {loadingChannels ? (
                <div className="flex items-center justify-center p-8">
                  <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
                </div>
              ) : channels.length === 0 ? (
                <div className="p-6 text-sm text-brand-ice/60 font-nunito">No channels.</div>
              ) : (
                <div style={{ height: chVirtualizer.getTotalSize(), position: 'relative' }}>
                  {chVirtualizer.getVirtualItems().map(v => {
                    const ch = channels[v.index];
                    if (!ch) return null;
                    const focused = pickerPane === 'ch' && channelIdx === v.index;
                    return (
                      <div
                        key={ch.stream_id}
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)`, height: ROW_HEIGHT }}
                        className="px-2"
                      >
                        <ChannelRow
                          channel={ch}
                          index={v.index}
                          isFocused={focused}
                          isPlaying={false}
                          isFavorite={false}
                          onSelect={(i) => setChannelIdx(i)}
                          onActivate={(i) => {
                            const c = channels[i];
                            const tIdx = pickerOpenForTile;
                            if (c && tIdx !== null) {
                              setPickerOpenForTile(null);
                              void openTileForChannel(tIdx, c);
                            }
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4-grid buffering hint */}
      {showHint && layout === '4' && (
        <div className="absolute left-0 right-0 bottom-0 z-20 bg-black/85 border-t border-white/10 px-4 py-3 flex items-center gap-3">
          <div className="flex-1 text-sm text-white font-nunito">
            Buffering? Your plan may not have enough connections (4 screens need 4) or your device may not be strong enough — try fewer screens.
          </div>
          <button
            onClick={() => { hintDismissedForSession = true; setShowHint(false); }}
            className="px-3 py-1.5 rounded-md bg-brand-gold/25 border border-brand-gold text-white text-sm font-quicksand font-semibold"
          >
            OK
          </button>
        </div>
      )}
    </div>
  );
});

MultiScreenSection.displayName = 'MultiScreenSection';
export default MultiScreenSection;
