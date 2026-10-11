// Multi-Screen (multiview) section. Native-only. Up to 4 tiles rendered by the
// SnowPlayer native surface BEHIND the transparent WebView; the grid paints
// chrome only (gaps, borders, labels).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { App as CapApp } from '@capacitor/app';
import { useTranslation } from 'react-i18next';
import type { PluginListenerHandle } from '@capacitor/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, Plus, Tv, X, ChevronRight } from 'lucide-react';
import {
  buildNativeLiveUrl,
  getLiveCategories,
  getLiveStreams,
  getShortEpg,
  pickNowNext,
  XTREAM_REFRESH_EVENT,
  type EpgNowNext,
  type XtreamCategory,
  type XtreamCreds,
  type XtreamLiveStream,
} from '@/lib/xtream';
import { hasNativePlayer } from '@/capacitor/SnowPlayer';
import { useTouchUI } from '@/lib/phoneMode';
import { overlayOpenAbove } from '@/lib/overlayBack';
import { loadFavoritesForLine } from '@/lib/favoritesSync';
import { kidsAllowsChannel, kidsLevel } from '@/lib/kidsFilter';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import {
  useMultiScreenPlayers,
  MS_SLOT_IDS,
  type MultiScreenId,
} from '@/hooks/useMultiScreenPlayers';
import { trackEvent } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';
import { LAYOUT_ORDER, LAYOUT_TILE_COUNT, MAIN_TILE, layoutNeighbor, okSwapsIntoMain, soundTile, threeArrangement, threeHintPlace, tilesForLayout, type GridBox, type Layout } from './multiScreenLayout';

// Demo latch (?demo=1) — false on native, so dead code in the APK.
const DEMO = isDemo();


interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp: () => void;
  /** The How-to stage (developer build only): draw the layout picker without
   *  the native player. Keys stay off, so nothing native is ever called. */
  previewOnly?: boolean;
  /** On a TV, while a screen plays and the tiles have the remote: the
   *  Player's header and side menu step aside (LiveTV), so the screens get
   *  the whole screen. False on the layout chooser, with nothing playing,
   *  with the remote on the side menu or the header, and on touch screens
   *  (no ◀ / ▲ to bring them back there). */
  onImmersiveChange?: (on: boolean) => void;
}

interface TileState {
  channel: XtreamLiveStream | null;
  nowNext?: EpgNowNext;
}

// Channel picker rows. Sized to be read from the couch: the picker used to
// be a 40% side panel split in two, which left ~200px for channel names.
const ROW_HEIGHT = 76;
const CAT_ROW_HEIGHT = 60;
/** OK held this long = the screen's options (as in Live TV's lists). */
const HOLD_MS = 600;

// Once dismissed the 4-grid buffering hint stays hidden for the session.
let hintDismissedForSession = false;
/** How long the 4-screen buffering hint stays up before it goes by itself. */
const HINT_SHOWN_MS = 10_000;

const MultiScreenSection = memo(({ creds, isActive, onExitLeft, onExitUp, previewOnly = false, onImmersiveChange }: Props) => {
  const { t } = useTranslation();
  const native = hasNativePlayer();
  const touch = useTouchUI();
  // usePlayerAccount already re-reads on playerAccountRefresh; a second
  // listener here made every refresh run twice.
  const { account } = usePlayerAccount();

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
  const showHintRef = useRef(showHint);
  showHintRef.current = showHint;
  // The buffering hint's OK was a button the remote could not reach (owner,
  // 2026-10-11: "I am unable to get down and press the button to make it go
  // away"): it now goes by itself after HINT_SHOWN_MS, and Back closes it
  // first (one step) before Back does anything else. A tap still works.
  const dismissHint = useCallback(() => { hintDismissedForSession = true; setShowHint(false); }, []);
  useEffect(() => {
    if (!showHint) return;
    const id = window.setTimeout(dismissHint, HINT_SHOWN_MS);
    return () => window.clearTimeout(id);
  }, [showHint, dismissHint]);

  // Hold OK on a small screen of the 3-screen layout: its options.
  const holdTimerRef = useRef<number | null>(null);
  const holdFiredRef = useRef(false);

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
  const slotsRef = useRef(slots);
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
  useEffect(() => { slotsRef.current = slots; }, [slots]);

  // Grid tile refs
  const gridRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<Array<HTMLDivElement | null>>([null, null, null, null]);

  // Every layout keeps its screens 16:9 and as large as the grid allows, so
  // the places depend on the grid's size (multiScreenLayout): followed as it
  // changes (the header and side menu stepping aside or coming back, the
  // side menu opening wider, a window resized).
  const [gridBox, setGridBox] = useState<GridBox | undefined>(undefined);
  const gridBoxRef = useRef(gridBox);
  gridBoxRef.current = gridBox;
  useLayoutEffect(() => {
    if (!layout) return;
    const el = gridRef.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setGridBox((prev) => (prev && Math.round(prev.width) === Math.round(r.width) && Math.round(prev.height) === Math.round(r.height)
        ? prev : { width: r.width, height: r.height }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout]);

  // Load categories once, with Favorites bucket first.
  useEffect(() => {
    if (!layout) return;
    let cancelled = false;
    (async () => {
      try {
        const cats = await getLiveCategories(creds);
        if (cancelled) return;
        const withFav = [
          { id: '__favs__', name: 'Favorites' }, // shown as t('live.categories.favorites')
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

  const latestCatRef = useRef<string | null>(null);
  const loadChannelsFor = useCallback(async (catId: string) => {
    latestCatRef.current = catId;
    if (catId === '__favs__') {
      // This line's (and this profile's) list, wherever it lives — not the
      // local store, which is the last line Live TV opened. A Kids profile
      // keeps only channels in the categories it may open (listed above).
      const allowed = kidsLevel() ? new Set(categoriesRef.current.map((c) => String(c.id))) : null;
      const favs = Array.from(loadFavoritesForLine(creds).values()).filter((f) => !allowed || kidsAllowsChannel(f, allowed)).map(f => ({
        stream_id: f.stream_id,
        name: f.name,
        num: f.num,
        stream_icon: f.stream_icon,
        category_id: f.category_id,
        epg_channel_id: f.epg_channel_id,
      })) as XtreamLiveStream[];
      setChannels(favs);
      channelsCacheRef.current.set(catId, favs);
      setLoadingChannels(false);
      return;
    }
    const cached = channelsCacheRef.current.get(catId);
    if (cached) { setChannels(cached); setLoadingChannels(false); return; }
    setLoadingChannels(true);
    try {
      const list = await getLiveStreams(creds, catId);
      channelsCacheRef.current.set(catId, list);
      // A slower, older category must not replace the one now highlighted.
      if (latestCatRef.current === catId) setChannels(list);
    } catch {
      if (latestCatRef.current === catId) setChannels([]);
    } finally {
      if (latestCatRef.current === catId) setLoadingChannels(false);
    }
  }, [creds]);

  // When channel pane opens or category changes, load channels.
  // Once focus settles on a category — holding ▼ in the picker used to
  // download the list of every category passed. Kept lists show at once.
  useEffect(() => {
    if (pickerOpenForTile === null) { latestCatRef.current = null; setLoadingChannels(false); return; }
    const cat = categories[categoryIdx];
    if (!cat) return;
    setChannelIdx(0);
    if (cat.id === '__favs__' || channelsCacheRef.current.has(cat.id)) { void loadChannelsFor(cat.id); return; }
    latestCatRef.current = cat.id;
    setLoadingChannels(true);
    const t = window.setTimeout(() => { void loadChannelsFor(cat.id); }, 250);
    return () => window.clearTimeout(t);
  }, [categoryIdx, pickerOpenForTile, categories, loadChannelsFor]);

  // One screen full screen: the other players keep playing (muted) but are
  // moved just off the screen's left edge, same size. The native side adds
  // each new player under the ones made before it, so a screen filled later
  // and made full screen was drawn UNDER the screens loaded before it
  // (Tronix 89c42b3 review). Moving a player's frame never reloads it; the
  // grid's own measure puts them back.
  const parkOthers = useCallback((fsSid: MultiScreenId) => {
    const l = layoutRef.current;
    if (!l) return;
    const spec = tilesForLayout(l);
    for (let i = 0; i < LAYOUT_TILE_COUNT[l]; i++) {
      const sid = spec[i].id;
      const el = tileRefs.current[i];
      if (sid === fsSid || !el || !slotsRef.current[sid]?.url) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      void applyRect(sid, { x: -Math.ceil(r.width) - 16, y: r.top, width: r.width, height: r.height });
    }
  }, [applyRect]);

  // Measure tiles → applyRect for each occupied slot.
  const measureAndApply = useCallback(() => {
    if (!layout) return;
    if (fullscreenSlotRef.current) {
      // Fullscreen: single slot to native fullscreen (w/h<=0), the others
      // parked off screen (parkOthers).
      parkOthers(fullscreenSlotRef.current);
      void applyRect(fullscreenSlotRef.current, { x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const grid = gridRef.current;
    if (!grid) return;
    const spec = tilesForLayout(layout);
    for (let i = 0; i < spec.length; i++) {
      const el = tileRefs.current[i];
      const sid = spec[i].id;
      const s = slotsRef.current[sid];
      if (!el || !s.url) continue;
      const r = el.getBoundingClientRect();
      void applyRect(sid, { x: r.left, y: r.top, width: r.width, height: r.height });
    }
  }, [layout, applyRect, parkOthers]);

  // Re-measure when a tile gains or loses a stream — not on every buffering
  // flip, which used to re-measure every tile and re-bind the listeners —
  // and when the grid changes size (the tiles have moved with it).
  const occupiedKey = MS_SLOT_IDS.map((id) => (slots[id].url ? '1' : '0')).join('');
  useEffect(() => {
    if (!layout) return;
    // Rect after layout/paint
    const raf = requestAnimationFrame(() => measureAndApply());
    return () => cancelAnimationFrame(raf);
  }, [layout, fullscreenSlot, measureAndApply, tiles, occupiedKey, gridBox]);

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

  // Focus audio when the focused tile changes. Keyed on the focused slot's
  // url, NOT the whole `slots` object: every buffering flip on any tile used
  // to re-run this and fan out eight serialized bridge calls across the grid.
  // loadSlot / closeTile already call focusAudio explicitly.
  // The tile with the sound: the highlighted one, except in the 3-screen
  // layout where the big screen keeps it (multiScreenLayout soundTile).
  const focusedSid = layout ? tilesForLayout(layout)[soundTile(layout, focusedTile)]?.id : undefined;
  const focusedHasUrl = !!(focusedSid && slots[focusedSid]?.url);
  useEffect(() => {
    if (!focusedSid) return;
    void focusAudio(focusedHasUrl ? focusedSid : null);
  }, [focusedSid, focusedHasUrl, focusAudio]);

  // 4-grid hint bar: any slot buffering > 6s
  useEffect(() => {
    if (layout !== '4' || hintDismissedForSession || showHint) return;
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

  // ── Handlers ───────────────────────────────────────────────────────────
  const chooseLayout = useCallback((l: Layout) => {
    setLayout(l);
    setFocusedTile(0);
  }, []);

  const openTileForChannel = useCallback(async (tileIdx: number, ch: XtreamLiveStream) => {
    if (!layout) return;
    // Demo: never construct a stream URL. Unreachable today (demo is web-only
    // and this section requires the native player), but keep the explicit
    // latch so buildNativeLiveUrl can never fire with demo creds.
    if (DEMO) return;
    const spec = tilesForLayout(layout);
    const sid = spec[tileIdx]?.id;
    if (!sid) return;
    // Update tile state first so measure sees it as occupied
    setTiles(prev => {
      const copy = prev.slice();
      copy[tileIdx] = { channel: ch, nowNext: undefined };
      return copy;
    });
    // Measure THIS tile now and applyRect BEFORE loadSlot. DOUBLE rAF so the
    // setTiles/picker-close layout flush lands first — never measure a 0×0 box.
    requestAnimationFrame(() => requestAnimationFrame(async () => {
      const el = tileRefs.current[tileIdx];
      if (el) {
        const r = el.getBoundingClientRect();
        await applyRect(sid, { x: r.left, y: r.top, width: r.width, height: r.height });
      }
      const url = buildNativeLiveUrl(creds, ch.stream_id);
      await loadSlot(sid, url);
      // Audio follows the highlighter: only grab audio if the loaded tile is
      // still under it; otherwise re-assert the currently focused tile.
      const soundIdx = soundTile(layoutRef.current!, focusedTileRef.current);
      if (soundIdx === tileIdx) {
        await focusAudio(sid);
      } else {
        const fsid = tilesForLayout(layoutRef.current!)[soundIdx]?.id;
        await focusAudio(fsid && slotsRef.current[fsid]?.url ? fsid : null);
      }
      void fetchEpgForTile(tileIdx, ch.stream_id);
      const occupiedCount = tilesRef.current.filter(t => t.channel).length;
      if (!DEMO) { try { trackEvent('multi_screen_play', 'player', { layout, tiles: occupiedCount }); } catch { /* ignore */ } }
    }));
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
    // Refocus audio: the big screen in the 3-screen layout, else the first remaining
    const soundIdx = soundTile(layout, focusedTileRef.current);
    if (layout === '3' && soundIdx !== tileIdx && tilesRef.current[soundIdx]?.channel) { await focusAudio(spec[soundIdx].id); return; }
    const firstRemaining = spec.findIndex((sp, i) => i !== tileIdx && tilesRef.current[i]?.channel);
    if (firstRemaining >= 0) await focusAudio(spec[firstRemaining].id); else await focusAudio(null);
  }, [layout, closeSlot, focusAudio]);

  // 3-screen layout: OK on a small screen puts its channel in the big one
  // (with the sound) and the big one's channel in that small one. Both slots
  // just load the other's stream: no re-layout, and the picture is back in a
  // second or two.
  const swapIntoMain = useCallback(async (tileIdx: number) => {
    if (!layout || DEMO) return;
    const spec = tilesForLayout(layout);
    const mainSid = spec[MAIN_TILE]?.id;
    const smallSid = spec[tileIdx]?.id;
    const small = tilesRef.current[tileIdx];
    const main = tilesRef.current[MAIN_TILE];
    if (!mainSid || !smallSid || !small?.channel) return;
    setTiles(prev => {
      const copy = prev.slice();
      copy[MAIN_TILE] = { channel: small.channel, nowNext: small.nowNext };
      copy[tileIdx] = main?.channel ? { channel: main.channel, nowNext: main.nowNext } : { channel: null };
      return copy;
    });
    setFocusedTile(MAIN_TILE);
    await loadSlot(mainSid, buildNativeLiveUrl(creds, small.channel.stream_id));
    await focusAudio(mainSid);
    if (main?.channel) await loadSlot(smallSid, buildNativeLiveUrl(creds, main.channel.stream_id));
    else await closeSlot(smallSid);
    if (!DEMO) { try { trackEvent('multi_screen_swap', 'player', { layout }); } catch { /* ignore */ } }
  }, [layout, loadSlot, closeSlot, focusAudio, creds]);

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
    fullscreenSlotRef.current = sid;
    // The other tiles keep playing on purpose (the viewer goes back to them
    // to switch), parked off screen so none is drawn over this one.
    parkOthers(sid);
    await applyRect(sid, { x: 0, y: 0, width: 0, height: 0 });
    await focusAudio(sid);
  }, [layout, applyRect, focusAudio, parkOthers]);

  const exitFullscreen = useCallback(() => {
    setFullscreenSlot(null);
    fullscreenSlotRef.current = null;
    // Re-measure all occupied, then re-assert audio on the focused tile.
    requestAnimationFrame(() => {
      measureAndApply();
      const fsid = layoutRef.current
        ? tilesForLayout(layoutRef.current)[soundTile(layoutRef.current, focusedTileRef.current)]?.id
        : undefined;
      void focusAudio(fsid && slotsRef.current[fsid]?.url ? fsid : null);
    });
  }, [measureAndApply, focusAudio]);

  // The remote leaving the section for the side menu or the header (◀ at the
  // tiles' left edge, ▲ at their top): the tiles go on playing (Tronix's
  // build 41 QA review: stopping them there and loading every stream again
  // on the way back was up to four reloads for one ◀ too many; here it also
  // threw the layout away). Only its pop-ups close, and one screen full
  // screen goes back into the grid. The header and side menu come back and
  // the grid shrinks: the screens are measured again once it has, so the
  // pictures stay inside their frames. Everything stops when the section
  // goes (another section, Settings, the Player closing: the players'
  // unmount) or on Back from the tiles (the layout choice, below).
  useEffect(() => {
    if (!isActive) {
      setTileMenuOpen(false);
      setPickerOpenForTile(null);
      if (fullscreenSlotRef.current) { exitFullscreen(); return; }
    }
    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => measureAndApply()); });
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    // Only when the remote comes or goes (exitFullscreen measures itself).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // On a TV, while a screen plays and the tiles have the remote, the
  // Player's header and side menu step aside (owner, 2026-10-11: "removing
  // the top and side border and making the screens larger"). ◀ off the left
  // edge and ▲ off the top still hand the remote to them (isActive goes
  // false: they come back, and the grid is measured again as it shrinks);
  // back on the tiles they step aside again.
  const immersive = native && !touch && isActive && !!layout && tiles.some((tile) => !!tile.channel);
  useEffect(() => { onImmersiveChange?.(immersive); }, [immersive, onImmersiveChange]);
  useEffect(() => () => onImmersiveChange?.(false), [onImmersiveChange]);

  /** "3 screens": a small screen whose stream failed. OK there tries it
   *  again (a dead stream is not swapped up to take the sound). */
  const smallFailed = useCallback((idx: number) => {
    const l = layoutRef.current;
    if (!l || !okSwapsIntoMain(l, idx)) return false;
    const sid = tilesForLayout(l)[idx]?.id;
    return !!sid && !!slotsRef.current[sid]?.error;
  }, []);

  // Categories virtualizer
  const catScrollRef = useRef<HTMLDivElement | null>(null);
  const chScrollRef = useRef<HTMLDivElement | null>(null);
  const catVirtualizer = useVirtualizer({
    count: categories.length,
    getScrollElement: () => catScrollRef.current,
    estimateSize: () => CAT_ROW_HEIGHT,
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
    // + 8: the list's own py-2 padding sits above the first row.
    const top = channelIdx * ROW_HEIGHT + 8;
    const bot = top + ROW_HEIGHT;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (bot + 8 > node.scrollTop + node.clientHeight) node.scrollTop = bot + 8 - node.clientHeight;
  }, [channelIdx, pickerOpenForTile, pickerPane]);

  useEffect(() => {
    if (pickerOpenForTile === null || pickerPane !== 'cat') return;
    // Same math as the channels (the virtualizer's own scrollToIndex does
    // not know about the list's 8 px top padding).
    const node = catScrollRef.current; if (!node) return;
    if (categoryIdx === 0) { node.scrollTop = 0; return; }
    const top = categoryIdx * CAT_ROW_HEIGHT + 8;
    const bot = top + CAT_ROW_HEIGHT;
    if (top < node.scrollTop) node.scrollTop = top;
    else if (bot + 8 > node.scrollTop + node.clientHeight) node.scrollTop = bot + 8 - node.clientHeight;
  }, [categoryIdx, pickerOpenForTile, pickerPane]);

  // ── Keyboard handler ─────────────────────────────────────────────────────
  const lastBackAtRef = useRef(0);
  useEffect(() => {
    if (!isActive || !native) return;
    const consume = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    };
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (typing) return;
      // A held OK is one press: its repeats open nothing more. Held on the big
      // screen it used to walk the menu → Change channel → the picker → the
      // first channel, and replace the stream (Tronix 89c42b3 review). The
      // small screens' hold is timed (HOLD_MS), not counted in repeats.
      if ((e.key === 'Enter' || e.key === ' ') && e.repeat) { consume(e); return; }

      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      // One press of the remote's Back can arrive twice (the key itself and
      // the hardware back listener's synthetic Escape). Leaving fullscreen
      // on the first and then leaving the grid on the second dropped the
      // viewer on the layout chooser. A second Back this soon is the same press.
      if (isBack) {
        const now = Date.now();
        if (now - lastBackAtRef.current < 350) { consume(e); return; }
        lastBackAtRef.current = now;
        if (showHintRef.current) { consume(e); dismissHint(); return; }
      }

      // Layout picker screen. Left off the first option and Up hand the
      // remote back to the shell (sidebar / header), like every other
      // section; without that the three layouts were a dead end.
      if (!layoutRef.current) {
        if (isBack) { consume(e); onExitLeft(); return; }
        if (e.key === 'ArrowUp') { consume(e); onExitUp(); return; }
        if (e.key === 'ArrowLeft') {
          consume(e);
          if (pickerIdxRef.current === 0) onExitLeft();
          else setPickerIdx(i => Math.max(0, i - 1));
          return;
        }
        if (e.key === 'ArrowRight') { consume(e); setPickerIdx(i => Math.min(LAYOUT_ORDER.length - 1, i + 1)); return; }
        if (e.key === 'Enter' || e.key === ' ') {
          consume(e);
          chooseLayout(LAYOUT_ORDER[pickerIdxRef.current]);
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
        const n = layoutNeighbor(layoutRef.current, focusedTileRef.current, dir, threeArrangement(gridBoxRef.current));
        if (n !== null) {
          consume(e);
          // Audio follows via the focusedSid effect.
          setFocusedTile(n);
          return;
        }
        // No tile that way: Left at the tiles' edge and Up at their top hand
        // the remote to the side menu and the header, as the layout cards
        // above and every other section do. On a TV that also brings them
        // back (they step aside while screens play); the tiles go on playing
        // meanwhile (see "The remote leaving the section").
        if (e.key === 'ArrowLeft') { consume(e); onExitLeft(); return; }
        if (e.key === 'ArrowUp') { consume(e); onExitUp(); return; }
        return;
      }
      // The remote's Menu (≡): the highlighted screen's options, on any
      // layout (the only way to a small screen's menu in the 3-screen one).
      if (e.key === 'ContextMenu' || e.keyCode === 82) {
        consume(e);
        if (tilesRef.current[focusedTileRef.current]?.channel) openTileMenu();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        consume(e);
        const tIdx = focusedTileRef.current;
        const t = tilesRef.current[tIdx];
        if (t?.channel && okSwapsIntoMain(layoutRef.current, tIdx)) {
          // A small screen of the 3-screen layout: OK swaps it into the big
          // one when let go; held, its options (the remote's Menu key never
          // reaches the page on a Fire TV). Repeats don't restart the hold.
          if (e.repeat || holdTimerRef.current || holdFiredRef.current) return;
          holdTimerRef.current = window.setTimeout(() => {
            holdTimerRef.current = null;
            // A pop-up came up over the screens meanwhile: it has the remote.
            if (overlayOpenAbove(gridRef.current?.parentElement)) return;
            holdFiredRef.current = true;
            openTileMenu();
          }, HOLD_MS);
          return;
        }
        if (t?.channel) openTileMenu();
        else openPickerForTile(tIdx);
      }
    };
    const upHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (holdTimerRef.current) {
        window.clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
        // A pop-up over the screens (or a listener before this one) took the
        // key: no swap behind it, the hold just ends.
        if (e.defaultPrevented || overlayOpenAbove(gridRef.current?.parentElement)) { holdFiredRef.current = false; return; }
        const tIdx = focusedTileRef.current;
        const tile = tilesRef.current[tIdx];
        if (layoutRef.current && okSwapsIntoMain(layoutRef.current, tIdx) && tile?.channel) {
          // A small screen whose stream failed: OK tries it again, as its
          // "OK to retry" says, rather than swapping a dead stream up into
          // the big screen and the sound with it (Tronix 89c42b3 review).
          // Held, it still opens its options (Change channel, Close).
          if (smallFailed(tIdx)) void openTileForChannel(tIdx, tile.channel);
          else void swapIntoMain(tIdx);
        }
      }
      holdFiredRef.current = false;
    };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('keyup', upHandler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('keyup', upHandler, true);
      if (holdTimerRef.current) { window.clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    };
  }, [isActive, native, chooseLayout, enterFullscreen, openPickerForTile, closeTile, exitFullscreen, stopAll, openTileForChannel, focusAudio, onExitLeft, onExitUp, swapIntoMain, smallFailed, openTileMenu]);

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
  if (!native && !previewOnly) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center p-6 rounded-2xl bg-black/60 border border-white/10">
          <Tv className="w-10 h-10 mx-auto text-brand-gold mb-3" />
          <h2 className="text-xl font-quicksand font-bold text-white mb-2">{t('live.multi.needsAppTitle')}</h2>
          <p className="text-sm text-brand-ice/70 font-nunito">
            {t('live.multi.needsAppBody')}
          </p>
        </div>
      </div>
    );
  }

  // Layout picker
  if (!layout) {
    const cards: Array<{ id: Layout; label: string; sub: string; need: number }> = [
      { id: '2h', label: t('live.multi.screens2'), sub: t('live.multi.sideBySide'), need: 2 },
      { id: '2v', label: t('live.multi.screens2'), sub: t('live.multi.stacked'), need: 2 },
      { id: '3',  label: t('live.multi.screens3'), sub: t('live.multi.bigPlusTwo'), need: 3 },
      { id: '4',  label: t('live.multi.screens4'), sub: t('live.multi.grid'), need: 4 },
    ];
    const maxCon = account?.maxConnections ?? null;
    const active = account?.activeCons ?? 0;
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 gap-8">
        <h2 className="text-2xl font-quicksand font-bold text-white">{t('live.multi.pickLayout')}</h2>
        <div className="flex gap-4" data-howto="multi.layouts">
          {cards.map((c, i) => {
            const overplan = maxCon !== null && c.need > maxCon;
            const focused = pickerIdx === i;
            return (
              <div
                key={c.id}
                data-focused={focused ? 'true' : 'false'}
                onClick={() => { setPickerIdx(i); chooseLayout(c.id); }}
                className={`tv-ring w-48 h-40 rounded-2xl py-4 px-5 border cursor-pointer flex flex-col justify-between transition-transform duration-150 ease-out ${
                  focused
                    ? 'bg-brand-gold/20 border-brand-gold scale-105 z-10'
                    : 'bg-black/60 border-white/10'
                }`}
              >
                <div>
                  <div className="text-xs uppercase tracking-wider text-brand-ice/70 font-nunito">{c.sub}</div>
                  <div className="text-2xl font-quicksand font-bold text-white mt-1">{c.label}</div>
                </div>
                {overplan && (
                  <div className="text-xs text-amber-300 font-nunito leading-snug">
                    {t('live.multi.planAllows', { count: maxCon })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {maxCon !== null && (
          <div className="text-sm text-brand-ice/70 font-nunito">
            {t('live.multi.planUsage', { active, max: maxCon })}
          </div>
        )}
      </div>
    );
  }

  // Grid mode
  const spec = tilesForLayout(layout, gridBox);
  // "3 screens": the swap hint, in the free corner beside the small screens,
  // while the highlighted small screen is not showing its own "OK to retry"
  // (one hint at a time).
  const hintPlace = layout === '3' ? threeHintPlace(gridBox) : null;
  const highlightedSid = spec[focusedTile]?.id;
  const focusedSmallFailed = okSwapsIntoMain(layout, focusedTile) && !!tiles[focusedTile]?.channel && !!(highlightedSid && slots[highlightedSid]?.error);
  return (
    // NO background here. The native tiles render BEHIND the WebView, so every
    // DOM ancestor of the grid has to be transparent or they are simply
    // painted over. This root gained bg-black on 2026-07-06 and nothing in
    // index.css's snowplayer-fullscreen block ever cleared it — the block
    // only knows html/body/#root and a few named LiveTV wrappers — so every
    // occupied tile has shown black with the audio playing underneath ever
    // since. Empty tiles paint their own black; the decor view behind the
    // WebView is black; the gaps take care of themselves.
    <div className="flex-1 relative overflow-hidden">
      {/* Transparent grid; native video renders BEHIND */}
      <div ref={gridRef} className="absolute inset-0">
        {spec.map((sp, i) => {
          const tile = tiles[i];
          const s = slots[sp.id];
          // Not while the side menu or the header has the remote (the tiles
          // play on behind it): one highlight on screen.
          const isFocused = isActive && focusedTile === i;
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
                data-ms-tile={i}
                data-focused={isFocused && !chromeHidden ? 'true' : 'false'}
                className={`tv-ring ms-tile w-full h-full rounded-md relative ${
                  occupied ? '' : 'bg-black'
                } ${
                  chromeHidden ? '' : 'border border-white/10'
                } ${
                  // One tile fullscreen: its siblings must stop painting
                  // (empty ones are solid black). visibility, not display,
                  // so tileRefs still measure for the exit re-layout.
                  fullscreenSlot && !chromeHidden ? 'invisible' : ''
                }`}
              >
                {!chromeHidden && !occupied && (
                  <div className="w-full h-full flex flex-col items-center justify-center text-brand-ice/70">
                    <Plus className="w-10 h-10 mb-1" />
                    <span className="text-sm font-nunito">{t('live.multi.addChannel')}</span>
                  </div>
                )}
                {!chromeHidden && occupied && (
                  <>
                    {/* channel pill */}
                    <div className="absolute left-2 bottom-2 max-w-[70%] px-2 py-1 rounded-lg bg-black/75">
                      <div className="text-xs text-white font-quicksand font-semibold truncate">{tile.channel!.name}</div>
                      {tile.nowNext?.now && (
                        <div className="text-xs text-brand-ice/70 font-nunito truncate">{tile.nowNext.now.title}</div>
                      )}
                    </div>
                    {s.buffering && !s.error && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
                      </div>
                    )}
                    {s.error && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 p-3 text-center">
                        <div className="text-sm text-white font-quicksand font-semibold mb-1">{t('live.multi.streamUnavailable')}</div>
                        <div className="text-xs text-brand-ice/60 font-nunito">{t('live.multi.retryHint')}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 3 screens: how to swap, in the free corner beside the small screens */}
      {hintPlace && !fullscreenSlot && !tileMenuOpen && !focusedSmallFailed && (
        <div
          data-ms-swap-hint=""
          style={{ position: 'absolute', left: hintPlace.left, top: hintPlace.top, width: hintPlace.width, height: hintPlace.height }}
          className="flex items-center justify-center p-3 text-center text-xs text-brand-ice/70 font-nunito leading-snug pointer-events-none overflow-hidden"
        >
          {t('live.multi.swapHint')}
        </div>
      )}

      {/* Tile menu */}
      {tileMenuOpen && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto bg-brand-navy border border-white/10 rounded-2xl p-3 w-64 shadow-2xl">
            {[t('live.multi.changeChannel'), t('live.multi.fullscreen'), t('live.multi.closeScreen')].map((label, i) => (
              <div
                key={i}
                data-focused={tileMenuIdx === i ? 'true' : 'false'}
                className={`tv-ring px-4 py-3 rounded-xl cursor-pointer font-quicksand font-semibold ${
                  tileMenuIdx === i ? 'bg-brand-gold/25 text-white scale-[1.02] z-10' : 'text-brand-ice hover:bg-white/5'
                }`}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Channel picker: a large, solid panel over the grid (the tiles are
          native video under the WebView, so it must be opaque). Categories
          take a third, channels two thirds, names at a readable size. */}
      {pickerOpenForTile !== null && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-[2vw] bg-black/60">
          <div className="w-full h-full max-w-[1400px] bg-[#0b1a33] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between flex-shrink-0">
              <div className="min-w-0">
                <div className="text-2xl text-white font-quicksand font-bold">{t('live.multi.addToScreen', { n: pickerOpenForTile + 1 })}</div>
                <div className="text-sm text-brand-ice/70 font-nunito mt-0.5">
                  {pickerPane === 'cat' ? t('live.multi.pickCategoryHint') : t('live.multi.pressOkHint')}
                </div>
              </div>
              <button
                onClick={() => setPickerOpenForTile(null)}
                className="p-3 rounded-xl text-brand-ice/70 hover:text-white flex-shrink-0"
                aria-label={t('common.close')}
              >
                <X className="w-7 h-7" />
              </button>
            </div>
            <div className="flex-1 min-h-0 flex">
              {/* Categories */}
              <div
                ref={catScrollRef}
                className={`w-[34%] flex-shrink-0 overflow-y-auto border-r border-white/10 py-2 ${pickerPane === 'cat' ? 'bg-white/[0.04]' : ''}`}
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
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)`, height: CAT_ROW_HEIGHT }}
                        className="px-3 pb-1.5"
                      >
                        <div
                          data-focused={focused ? 'true' : 'false'}
                          onClick={() => { setCategoryIdx(v.index); setPickerPane('ch'); }}
                          className={`tv-ring h-full flex items-center justify-between px-4 rounded-xl cursor-pointer text-lg font-quicksand font-semibold ${
                            focused ? 'bg-brand-gold/25 text-white scale-[1.02] z-10'
                              : selected ? 'bg-white/10 text-white' : 'text-brand-ice hover:bg-white/5'
                          }`}
                        >
                          <span className="truncate">{c.id === '__favs__' ? t('live.categories.favorites') : c.name}</span>
                          <ChevronRight className="w-5 h-5 flex-shrink-0 opacity-60 ml-2" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Channels */}
              <div
                ref={chScrollRef}
                className={`flex-1 min-w-0 overflow-y-auto py-2 ${pickerPane === 'ch' ? 'bg-white/[0.04]' : ''}`}
              >
                {loadingChannels ? (
                  <div className="flex items-center justify-center p-10">
                    <Loader2 className="w-8 h-8 animate-spin text-brand-gold" />
                  </div>
                ) : channels.length === 0 ? (
                  <div className="p-8 text-lg text-brand-ice/70 font-nunito">{t('live.list.noChannelsInCategory')}</div>
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
                          className="px-3 pb-1.5"
                        >
                          <div
                            data-focused={focused ? 'true' : 'false'}
                            onClick={() => {
                              const tIdx = pickerOpenForTile;
                              if (tIdx !== null) {
                                setPickerOpenForTile(null);
                                void openTileForChannel(tIdx, ch);
                              }
                            }}
                            className={`tv-ring h-full flex items-center px-4 rounded-xl cursor-pointer ${
                              focused ? 'bg-brand-gold/25 scale-[1.01] z-10' : 'hover:bg-white/5'
                            }`}
                          >
                            <span className="w-10 text-right mr-4 text-base tabular-nums text-brand-ice/60 flex-shrink-0">
                              {ch.num ?? v.index + 1}
                            </span>
                            <span className="w-14 h-10 mr-4 flex-shrink-0 rounded-lg bg-white/5 flex items-center justify-center overflow-hidden">
                              {ch.stream_icon ? (
                                <img src={ch.stream_icon} alt="" decoding="async" className="max-w-full max-h-full object-contain" />
                              ) : (
                                <Tv className="w-5 h-5 text-brand-ice/40" />
                              )}
                            </span>
                            <span className={`flex-1 min-w-0 truncate text-xl font-quicksand font-semibold ${focused ? 'text-white' : 'text-brand-ice'}`}>
                              {ch.name}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4-grid buffering hint */}
      {showHint && layout === '4' && (
        <div className="absolute left-0 right-0 bottom-0 z-20 bg-black/85 border-t border-white/10 px-4 py-3 flex items-center gap-3">
          <div className="flex-1 text-sm text-white font-nunito">
            {t('live.multi.bufferingHint')}
          </div>
          <button
            onClick={dismissHint}
            className="px-5 py-3 rounded-xl bg-brand-gold/25 border border-brand-gold text-white text-sm font-quicksand font-semibold"
          >
            {t('common.ok')}
          </button>
        </div>
      )}
    </div>
  );
});

MultiScreenSection.displayName = 'MultiScreenSection';
export default MultiScreenSection;
