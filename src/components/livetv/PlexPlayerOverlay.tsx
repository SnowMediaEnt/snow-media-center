// Plex VOD playback overlay. Shown for 5s on any key while fullscreen. Owns
// its own keydown listener (capture=true) when visible; hides on Back. When
// hidden, this component renders nothing — PlexSection's own Back handler
// exits playback. Native-only (uses SnowPlayer position/tracks).
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Rewind, FastForward, Subtitles, AudioLines, Download, Loader2, Gauge, Maximize, LifeBuoy, Volume2, VolumeX } from 'lucide-react';
import type { VideoController, VideoTrackInfo } from './VideoPlayer';
import type { SnowSubtitle } from '@/capacitor/SnowPlayer';
import { searchOpenSubtitles, downloadOpenSubtitle, type OpenSubResult } from '@/lib/opensubtitles';
import { PLEX_QUALITY_PRESETS } from '@/lib/plex';
import { SCREEN_FORMATS, type ScreenFormat } from '@/capacitor/SnowPlayer';
import { useScreenFormat } from '@/hooks/useScreenFormat';
import { useToast } from '@/hooks/use-toast';

// 'scrub' is the progress bar itself — reached with ▲ from any control, ◀ ▶
// move a preview marker (accelerating on repeated presses), OK jumps there.
type Row = 'scrub' | 'seek-10' | 'play' | 'seek+30' | 'audio' | 'subs' | 'quality' | 'format' | 'volume' | 'buffering';
const ROWS: Row[] = ['seek-10', 'play', 'seek+30', 'audio', 'subs', 'quality', 'format', 'volume', 'buffering'];
// Scrub step (seconds) by acceleration level; every 4 quick presses (< 700 ms
// apart) bump one level — 10 s taps, then 30 s, 1 min, 2 min, 5 min holds.
const SCRUB_STEPS = [10, 30, 60, 120, 300];
const SCRUB_REPEAT_MS = 700;

export interface SubtitleSearchContext {
  title: string;
  year?: number;
  grandparentTitle?: string;
  season?: number;
  episode?: number;
}

interface Props {
  active: boolean;                              // component only wires listeners when true
  title: string;
  /** Optional display badge, e.g. "4K" / "1080p" — rendered next to the title. */
  resolutionLabel?: string;
  controller: VideoController | null;
  tracksTick: number;
  getPosition: () => Promise<{ position: number; duration: number; playing: boolean }>;
  seekTo: (sec: number) => Promise<void>;
  onBackWhileHidden: () => void;                // called when Back pressed with overlay hidden (fullscreen exit)
  /** Which path the stream takes ("Direct to server · https", "Plex Relay…"). Shown in Help. */
  routeLabel?: string;
  subtitleContext?: SubtitleSearchContext;
  /** Reload native player with an external subtitle sidecar at the given resume position. */
  onLoadExternalSubtitle?: (sub: SnowSubtitle, resumeSec: number) => void;
  /** Currently active quality preset key (see PLEX_QUALITY_PRESETS). */
  qualityKey: string;
  /** Called when the user picks a new quality preset. */
  onChangeQuality: (presetKey: string, resumeSec: number) => void;
  /** Called when the user opens the Buffering help shortcut. Parent is expected
   *  to tear down playback and route to Support → Buffering Guide. */
  onOpenBufferingGuide?: () => void;
  /** Called when the user picks "More help & support" from the Help menu.
   *  Parent tears down playback and routes to Support WITHOUT auto-opening
   *  the buffering guide. */
  onOpenSupport?: () => void;
  /** Current playback volume 0..1. */
  volume: number;
  /** Called with the new volume 0..1 (live-adjusted from the slider popup). */
  onChangeVolume: (v: number) => void;
  /** Called when the user picks "Fix audio" from the Audio menu. Parent
   *  should reload the stream as an audio-only transcode at the given
   *  resume position. */
  onFixAudio?: (resumeSec: number) => void;
}


const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(ss)}` : `${pad2(m)}:${pad2(ss)}`;
};

const PlexPlayerOverlay = memo(({ active, title, resolutionLabel, controller, tracksTick, getPosition, seekTo, onBackWhileHidden, routeLabel, subtitleContext, onLoadExternalSubtitle, qualityKey, onChangeQuality, onOpenBufferingGuide, onOpenSupport, volume, onChangeVolume, onFixAudio }: Props) => {
  const [visible, setVisible] = useState(false);
  const [row, setRow] = useState<Row>('play');
  const [menu, setMenu] = useState<'none' | 'audio' | 'subs' | 'osdl' | 'quality' | 'format' | 'volume' | 'help'>('none');
  const [menuIdx, setMenuIdx] = useState(0);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(false);
  // Preview position while on the scrub row (null = not scrubbing).
  const [scrubPos, setScrubPos] = useState<number | null>(null);
  const scrubRepeatRef = useRef<{ at: number; count: number }>({ at: 0, count: 0 });
  const { toast } = useToast();

  // OpenSubtitles panel state
  const [osdlLoading, setOsdlLoading] = useState(false);
  const [osdlResults, setOsdlResults] = useState<OpenSubResult[]>([]);
  const [osdlError, setOsdlError] = useState<string | null>(null);
  const [osdlBusyId, setOsdlBusyId] = useState<number | null>(null);
  /** File id we just downloaded — matched against the next external track that appears to auto-select it. */
  const pendingSubRef = useRef<{ trackIdBefore: Set<number> } | null>(null);

  const hideTimerRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const clearHide = () => { if (hideTimerRef.current) { window.clearTimeout(hideTimerRef.current); hideTimerRef.current = null; } };
  const armHide = useCallback(() => {
    clearHide();
    hideTimerRef.current = window.setTimeout(() => { setVisible(false); setMenu('none'); setScrubPos(null); }, 5000);
  }, []);

  const show = useCallback(() => {
    if (!visible) setVisible(true);
    armHide();
  }, [visible, armHide]);

  // Poll position while visible.
  useEffect(() => {
    if (!active || !visible) {
      if (pollTimerRef.current) { window.clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const p = await getPosition();
      if (cancelled) return;
      setPos(p.position); setDur(p.duration); setPaused(!p.playing);
    };
    void tick();
    pollTimerRef.current = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      if (pollTimerRef.current) { window.clearInterval(pollTimerRef.current); pollTimerRef.current = null; }
    };
  }, [active, visible, getPosition]);

  useEffect(() => () => clearHide(), []);

  // Track lists (re-read each render — tracksTick forces refresh).
  void tracksTick;
  const subs: VideoTrackInfo[] = controller?.getSubtitleTracks() ?? [];
  const auds: VideoTrackInfo[] = controller?.getAudioTracks() ?? [];

  // After we ask PlexSection to reload with a sidecar, watch tracks for a new one to appear + auto-select.
  useEffect(() => {
    const pending = pendingSubRef.current;
    if (!pending) return;
    const before = pending.trackIdBefore;
    const fresh = subs.find((s) => !before.has(s.id));
    if (fresh) {
      controller?.setSubtitleTrack(fresh.id);
      pendingSubRef.current = null;
      toast({ title: 'Subtitles loaded' });
    }
  }, [tracksTick, subs, controller, toast]);

  const openSubs = useCallback(() => {
    setMenu('subs');
    // Menu items are [Off, ...subs, Get subtitles…]. Preselect active or Off.
    const activeIdx = subs.findIndex((s) => s.active);
    setMenuIdx(activeIdx >= 0 ? activeIdx + 1 : 0);
  }, [subs]);

  const openOsdl = useCallback(async () => {
    setMenu('osdl');
    setMenuIdx(0);
    setOsdlLoading(true);
    setOsdlError(null);
    setOsdlResults([]);
    const ctx = subtitleContext;
    const query = ctx?.grandparentTitle
      ? `${ctx.grandparentTitle}${ctx.season != null && ctx.episode != null ? ` S${String(ctx.season).padStart(2,'0')}E${String(ctx.episode).padStart(2,'0')}` : ''}`
      : (ctx?.title || title);
    const res = await searchOpenSubtitles({
      query,
      year: ctx?.year,
      season: ctx?.season,
      episode: ctx?.episode,
    });
    setOsdlLoading(false);
    if (!res.ok) {
      const reason = (res as { reason?: string }).reason;
      if (reason === 'not_configured') setOsdlError('Subtitle downloads are almost ready — the OpenSubtitles key still needs to be added.');
      else if (reason === 'quota') setOsdlError('Daily subtitle download limit reached.');
      else setOsdlError('Could not reach OpenSubtitles.');
      return;
    }

    setOsdlResults(res.results);
  }, [subtitleContext, title]);

  const pickOsdl = useCallback(async (r: OpenSubResult) => {
    if (osdlBusyId) return;
    setOsdlBusyId(r.id);
    const dl = await downloadOpenSubtitle(r.id);
    setOsdlBusyId(null);
    if (!dl.ok) {
      const reason = (dl as { reason?: string }).reason;
      if (reason === 'not_configured') toast({ title: 'Subtitle downloads are almost ready — the OpenSubtitles key still needs to be added.' });
      else if (reason === 'quota') toast({ title: 'Daily subtitle download limit reached.' });
      else toast({ title: 'Could not download subtitles.' });
      return;
    }

    if (!onLoadExternalSubtitle) return;
    const p = await getPosition();
    // Snapshot current track ids so we can detect the new one after reload.
    pendingSubRef.current = { trackIdBefore: new Set(subs.map((s) => s.id)) };
    onLoadExternalSubtitle(
      { url: dl.url, lang: r.lang, label: `OpenSubtitles ${r.lang.toUpperCase()}`, mime: 'application/x-subrip' },
      Math.floor(p.position),
    );
    setMenu('none');
  }, [osdlBusyId, onLoadExternalSubtitle, getPosition, subs, toast]);

  const openQuality = useCallback(() => {
    setMenu('quality');
    const idx = PLEX_QUALITY_PRESETS.findIndex((p) => p.key === qualityKey);
    setMenuIdx(idx >= 0 ? idx : 0);
  }, [qualityKey]);

  // Screen format. 'fit' is the default because the picture is drawn into a
  // full-screen surface — without a correction every video is stretched to the
  // panel, which is why 4:3 looked fat and scope films looked squeezed.
  const screen = useScreenFormat(active);
  const openFormat = useCallback(() => {
    setMenu('format');
    const idx = SCREEN_FORMATS.findIndex((f) => f.id === screenFormatRef.current);
    setMenuIdx(idx < 0 ? 0 : idx);
  }, []);

  const doAction = useCallback(async (r: Row) => {
    if (!controller && r !== 'volume' && r !== 'buffering') return;
    if (r === 'play') controller?.togglePlay();
    else if (r === 'seek-10') { const p = await getPosition(); await seekTo(Math.max(0, p.position - 10)); }
    else if (r === 'seek+30') { const p = await getPosition(); await seekTo(p.position + 30); }
    else if (r === 'audio') { setMenu('audio'); setMenuIdx(Math.max(0, auds.findIndex((a) => a.active))); }
    else if (r === 'subs') { openSubs(); }
    else if (r === 'quality') { openQuality(); }
    else if (r === 'format') { openFormatRef.current(); }
    else if (r === 'volume') { setMenu('volume'); setMenuIdx(0); }
    else if (r === 'buffering') { setMenu('help'); setMenuIdx(0); }
  }, [controller, getPosition, seekTo, auds, openSubs, openQuality]);

  // Refs for key handler
  const rowRef = useRef(row); useEffect(() => { rowRef.current = row; }, [row]);
  const posRef = useRef(pos); useEffect(() => { posRef.current = pos; }, [pos]);
  const durRef = useRef(dur); useEffect(() => { durRef.current = dur; }, [dur]);
  const scrubPosRef = useRef(scrubPos); useEffect(() => { scrubPosRef.current = scrubPos; }, [scrubPos]);
  const seekToRef = useRef(seekTo); useEffect(() => { seekToRef.current = seekTo; }, [seekTo]);
  const visibleRef = useRef(visible); useEffect(() => { visibleRef.current = visible; }, [visible]);
  const menuRef = useRef(menu); useEffect(() => { menuRef.current = menu; }, [menu]);
  const menuIdxRef = useRef(menuIdx); useEffect(() => { menuIdxRef.current = menuIdx; }, [menuIdx]);
  const subsRef = useRef(subs); useEffect(() => { subsRef.current = subs; }, [subs]);
  const audsRef = useRef(auds); useEffect(() => { audsRef.current = auds; }, [auds]);
  const osdlResultsRef = useRef(osdlResults); useEffect(() => { osdlResultsRef.current = osdlResults; }, [osdlResults]);
  const doActionRef = useRef(doAction); useEffect(() => { doActionRef.current = doAction; }, [doAction]);
  const showRef = useRef(show); useEffect(() => { showRef.current = show; }, [show]);
  const armHideRef = useRef(armHide); useEffect(() => { armHideRef.current = armHide; }, [armHide]);
  const controllerRef = useRef(controller); useEffect(() => { controllerRef.current = controller; }, [controller]);
  const onBackHiddenRef = useRef(onBackWhileHidden); useEffect(() => { onBackHiddenRef.current = onBackWhileHidden; }, [onBackWhileHidden]);
  const openOsdlRef = useRef(openOsdl); useEffect(() => { openOsdlRef.current = openOsdl; }, [openOsdl]);
  const openSubsRef = useRef(openSubs); useEffect(() => { openSubsRef.current = openSubs; }, [openSubs]);
  const pickOsdlRef = useRef(pickOsdl); useEffect(() => { pickOsdlRef.current = pickOsdl; }, [pickOsdl]);
  const qualityKeyRef = useRef(qualityKey); useEffect(() => { qualityKeyRef.current = qualityKey; }, [qualityKey]);
  const screenFormatRef = useRef(screen.format); useEffect(() => { screenFormatRef.current = screen.format; }, [screen.format]);
  const setScreenFormatRef = useRef(screen.setFormat); useEffect(() => { setScreenFormatRef.current = screen.setFormat; }, [screen.setFormat]);
  const openFormatRef = useRef(openFormat); useEffect(() => { openFormatRef.current = openFormat; }, [openFormat]);
  const onChangeQualityRef = useRef(onChangeQuality); useEffect(() => { onChangeQualityRef.current = onChangeQuality; }, [onChangeQuality]);
  const getPositionRef = useRef(getPosition); useEffect(() => { getPositionRef.current = getPosition; }, [getPosition]);
  const toastRef = useRef(toast); useEffect(() => { toastRef.current = toast; }, [toast]);
  const volumeRef = useRef(volume); useEffect(() => { volumeRef.current = volume; }, [volume]);
  const onChangeVolumeRef = useRef(onChangeVolume); useEffect(() => { onChangeVolumeRef.current = onChangeVolume; }, [onChangeVolume]);
  const onOpenBufferingGuideRef = useRef(onOpenBufferingGuide); useEffect(() => { onOpenBufferingGuideRef.current = onOpenBufferingGuide; }, [onOpenBufferingGuide]);
  const onOpenSupportRef = useRef(onOpenSupport); useEffect(() => { onOpenSupportRef.current = onOpenSupport; }, [onOpenSupport]);
  const onFixAudioRef = useRef(onFixAudio); useEffect(() => { onFixAudioRef.current = onFixAudio; }, [onFixAudio]);

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;
      // keyCode 23 is DPAD_CENTER and 66 is ENTER. Some TV remotes deliver OK
      // with those and an unhelpful e.key ('Unidentified' or ''), which would
      // leave the viewer unable to open the control bar at all. StoreScreen
      // already accepts 23 for the same reason.
      const isNav = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '].includes(e.key)
        || e.keyCode === 23 || e.keyCode === 66;
      const isOk = e.key === 'Enter' || e.key === ' ' || e.keyCode === 23 || e.keyCode === 66;

      if (isBack) {
        if (menuRef.current === 'osdl') {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          openSubsRef.current(); armHideRef.current(); return;
        }
        if (menuRef.current !== 'none') {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          setMenu('none'); armHideRef.current(); return;
        }
        if (visibleRef.current) {
          e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
          setVisible(false); return;
        }
        // hidden → let parent handle
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        onBackHiddenRef.current();
        return;
      }
      if (!isNav) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();

      // Any key shows the overlay + resets the auto-hide timer.
      if (!visibleRef.current) { showRef.current(); return; }
      armHideRef.current();

      if (menuRef.current === 'audio') {
        const list = audsRef.current;
        const total = list.length + 1;   // + synthetic "Fix audio" row at end
        const fixIdx = list.length;
        const i = menuIdxRef.current;
        if (e.key === 'ArrowUp') setMenuIdx(Math.max(0, i - 1));
        else if (e.key === 'ArrowDown') setMenuIdx(Math.min(total - 1, i + 1));
        else if (isOk) {
          if (i === fixIdx) {
            void (async () => {
              const p = await getPositionRef.current();
              onFixAudioRef.current?.(Math.floor(p.position));
              try { toastRef.current({ title: 'Fixing audio — converting sound only…' }); } catch { /* ignore */ }
            })();
            setMenu('none');
            return;
          }
          const track = list[i];
          if (track) controllerRef.current?.setAudioTrack(track.id);
          setMenu('none');
        }
        return;
      }
      if (menuRef.current === 'subs') {
        // list = [Off, ...subs, Get subtitles…]
        const list = subsRef.current;
        const total = list.length + 2;
        const getIdx = list.length + 1;
        const i = menuIdxRef.current;
        if (e.key === 'ArrowUp') setMenuIdx(Math.max(0, i - 1));
        else if (e.key === 'ArrowDown') setMenuIdx(Math.min(total - 1, i + 1));
        else if (isOk) {
          if (i === getIdx) { void openOsdlRef.current(); return; }
          if (i === 0) controllerRef.current?.setSubtitleTrack(-1);
          else { const track = list[i - 1]; if (track) controllerRef.current?.setSubtitleTrack(track.id); }
          setMenu('none');
        }
        return;
      }
      if (menuRef.current === 'osdl') {
        const list = osdlResultsRef.current;
        if (list.length === 0) return;
        const i = menuIdxRef.current;
        if (e.key === 'ArrowUp') setMenuIdx(Math.max(0, i - 1));
        else if (e.key === 'ArrowDown') setMenuIdx(Math.min(list.length - 1, i + 1));
        else if (isOk) { const item = list[i]; if (item) void pickOsdlRef.current(item); }
        return;
      }
      if (menuRef.current === 'format') {
        const list = SCREEN_FORMATS;
        const i = menuIdxRef.current;
        if (e.key === 'ArrowUp') setMenuIdx(Math.max(0, i - 1));
        else if (e.key === 'ArrowDown') setMenuIdx(Math.min(list.length - 1, i + 1));
        else if (isOk) {
          const f = list[i];
          if (f) {
            void setScreenFormatRef.current(f.id as ScreenFormat);
            try { toastRef.current({ title: `Screen format: ${f.label}` }); } catch { /* ignore */ }
          }
          setMenu('none');
        }
        return;
      }
      if (menuRef.current === 'quality') {
        const list = PLEX_QUALITY_PRESETS;
        const i = menuIdxRef.current;
        if (e.key === 'ArrowUp') setMenuIdx(Math.max(0, i - 1));
        else if (e.key === 'ArrowDown') setMenuIdx(Math.min(list.length - 1, i + 1));
        else if (isOk) {
          const p = list[i];
          if (p && p.key !== qualityKeyRef.current) {
            void (async () => {
              const pos = await getPositionRef.current();
              onChangeQualityRef.current(p.key, Math.floor(pos.position));
              try { toastRef.current({ title: `Switching to ${p.label}…` }); } catch { /* ignore */ }
            })();
          }
          setMenu('none');
        }
        return;
      }
      if (menuRef.current === 'volume') {
        if (e.key === 'ArrowLeft') {
          const next = Math.max(0, +(volumeRef.current - 0.1).toFixed(2));
          onChangeVolumeRef.current(next);
        } else if (e.key === 'ArrowRight') {
          const next = Math.min(1, +(volumeRef.current + 0.1).toFixed(2));
          onChangeVolumeRef.current(next);
        } else if (isOk) {
          setMenu('none');
        }
        return;
      }
      if (menuRef.current === 'help') {
        const i = menuIdxRef.current;
        if (e.key === 'ArrowUp') setMenuIdx(Math.max(0, i - 1));
        else if (e.key === 'ArrowDown') setMenuIdx(Math.min(1, i + 1));
        else if (isOk) {
          setMenu('none');
          if (i === 0) onOpenBufferingGuideRef.current?.();
          else onOpenSupportRef.current?.();
        }
        return;
      }




      const r = rowRef.current;

      // Scrub row: the progress bar owns ◀ ▶ / OK; ▼ returns to the controls.
      if (r === 'scrub') {
        if (e.key === 'ArrowDown') { setScrubPos(null); setRow('play'); return; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const now = Date.now();
          const rep = scrubRepeatRef.current;
          const quick = now - rep.at < SCRUB_REPEAT_MS;
          rep.count = quick ? rep.count + 1 : 0;
          rep.at = now;
          const level = Math.min(SCRUB_STEPS.length - 1, Math.floor(rep.count / 4));
          const step = SCRUB_STEPS[level] * (e.key === 'ArrowLeft' ? -1 : 1);
          const from = scrubPosRef.current ?? posRef.current;
          const max = durRef.current > 0 ? durRef.current : Number.MAX_SAFE_INTEGER;
          setScrubPos(Math.min(max, Math.max(0, from + step)));
          return;
        }
        if (isOk) {
          const target = scrubPosRef.current;
          setScrubPos(null);
          if (target != null && Math.abs(target - posRef.current) >= 1) {
            setPos(target);
            void seekToRef.current(target);
          }
          return;
        }
        return;
      }
      if (e.key === 'ArrowUp') { setScrubPos(null); setRow('scrub'); return; }

      // main control row (horizontal)
      const idx = ROWS.indexOf(r);
      if (e.key === 'ArrowLeft') { if (idx > 0) setRow(ROWS[idx - 1]); }
      else if (e.key === 'ArrowRight') { if (idx < ROWS.length - 1) setRow(ROWS[idx + 1]); }
      else if (isOk) void doActionRef.current(r);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [active]);

  if (!visible) return null;

  const scrubbing = row === 'scrub';
  const shownPos = scrubbing && scrubPos != null ? scrubPos : pos;
  const pct = dur > 0 ? Math.min(100, Math.max(0, (shownPos / dur) * 100)) : 0;
  const scrubDelta = scrubbing && scrubPos != null ? Math.round(scrubPos - pos) : 0;
  const volPct = Math.round(Math.min(1, Math.max(0, volume)) * 100);
  const btnBase = 'flex items-center justify-center rounded-full transition-transform duration-150';
  // Control-bar row whose popup menu is open. That button drops its focused
  // look (and data-focused) for an "open" outline so the eye moves to the menu.
  const menuRow: Row | null =
    menu === 'audio' ? 'audio'
      : menu === 'subs' || menu === 'osdl' ? 'subs'
        : menu === 'quality' ? 'quality'
        : menu === 'format' ? 'format'
          : menu === 'volume' ? 'volume'
            : menu === 'help' ? 'buffering'
              : null;
  const btnFocused = (r: Row) => (row === r && menuRow !== r ? 'true' : 'false');
  const focusVis = (r: Row) => menuRow === r
    ? 'bg-black/60 text-brand-gold border-2 border-brand-gold scale-100'
    : row === r
      ? 'bg-brand-gold text-brand-navy scale-110'
      : 'bg-white/10 text-white';

  const subsList: Array<{ id: number; label: string; active: boolean }> = [
    { id: -1, label: 'Off', active: subs.every((s) => !s.active) },
    ...subs.map((s) => ({ id: s.id, label: s.label, active: s.active })),
    { id: -2, label: '⬇ Get subtitles…', active: false },
  ];

  return (
    <>
      <div className="absolute left-0 right-0 bottom-0 z-20 px-8 pt-16 pb-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent animate-fade-in pointer-events-none">
        <div className="max-w-6xl mx-auto pointer-events-auto">
          <p className="text-xl font-quicksand font-bold text-white truncate mb-2">
            {title}
            {resolutionLabel && (
              <span className={`ml-2 align-middle text-xs font-bold px-2 py-1 rounded-lg bg-black/70 ${resolutionLabel === '4K' ? 'text-brand-gold' : 'text-white/80'}`}>{resolutionLabel}</span>
            )}
          </p>
          <div
            className={`relative rounded-full ${scrubbing ? 'h-2.5 bg-white/25' : 'h-1.5 bg-white/15'}`}
            data-focused={scrubbing ? 'true' : 'false'}
            aria-label="Seek bar"
          >
            <div className="h-full rounded-full bg-brand-gold" style={{ width: `${pct}%` }} />
            {scrubbing && (
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-5 rounded-full bg-brand-gold border-2 border-white"
                style={{ left: `${pct}%` }}
                aria-hidden="true"
              />
            )}
          </div>
          <div className="flex justify-between text-xs text-brand-ice/70 font-nunito tabular-nums mt-1">
            <span>
              {fmtTime(shownPos)}
              {scrubDelta !== 0 && (
                <span className="ml-2 text-brand-gold">{scrubDelta > 0 ? '+' : '−'}{fmtTime(Math.abs(scrubDelta))}</span>
              )}
            </span>
            <span>{dur > 0 ? fmtTime(dur) : ''}</span>
          </div>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button type="button" data-focused={row === 'seek-10' ? 'true' : 'false'} className={`${btnBase} w-12 h-12 ${focusVis('seek-10')}`} aria-label="Back 10 seconds"><Rewind className="w-6 h-6" /></button>
            <button type="button" data-focused={row === 'play' ? 'true' : 'false'} className={`${btnBase} w-16 h-16 ${focusVis('play')}`} aria-label="Play/Pause">
              {paused ? <Play className="w-7 h-7 fill-current" /> : <Pause className="w-7 h-7 fill-current" />}
            </button>
            <button type="button" data-focused={row === 'seek+30' ? 'true' : 'false'} className={`${btnBase} w-12 h-12 ${focusVis('seek+30')}`} aria-label="Forward 30 seconds"><FastForward className="w-6 h-6" /></button>
            <button type="button" data-focused={btnFocused('audio')} className={`${btnBase} w-12 h-12 ${focusVis('audio')}`} aria-label="Audio"><AudioLines className="w-6 h-6" /></button>
            <button type="button" data-focused={btnFocused('subs')} className={`${btnBase} w-12 h-12 ${focusVis('subs')}`} aria-label="Subtitles"><Subtitles className="w-6 h-6" /></button>
            <button type="button" data-focused={btnFocused('quality')} className={`${btnBase} w-12 h-12 ${focusVis('quality')}`} aria-label="Quality"><Gauge className="w-6 h-6" /></button>
            <button type="button" data-focused={btnFocused('format')} className={`${btnBase} w-12 h-12 ${focusVis('format')}`} aria-label="Screen format"><Maximize className="w-6 h-6" /></button>
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                data-focused={btnFocused('volume')}
                className={`${btnBase} w-12 h-12 ${focusVis('volume')}`}
                aria-label="Volume"
              >
                {volPct === 0 ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />}
              </button>
              {row === 'volume' && (
                <span className="text-xs font-nunito text-brand-ice/80 tabular-nums leading-none">{volPct}%</span>
              )}
            </div>
            <div className="flex flex-col items-center gap-1">
              <button type="button" data-focused={btnFocused('buffering')} className={`${btnBase} w-12 h-12 ${focusVis('buffering')}`} aria-label="Help" onClick={() => { setMenu('help'); setMenuIdx(0); }}><LifeBuoy className="w-6 h-6" /></button>
              <span className="text-xs font-nunito text-brand-ice/70 leading-none">Help</span>
            </div>
          </div>
          <p className="text-center text-xs text-brand-ice/60 font-nunito mt-4">
            {row === 'scrub'
              ? '◀ ▶ move · keep pressing for bigger jumps · OK jump there · ▼ controls'
              : row === 'buffering'
                ? 'Help — OK for support options'
                : row === 'volume'
                  ? 'Volume — OK opens the slider'
                  : '▲ seek bar · ◀ ▶ select · OK activate · Back hides'}
          </p>
        </div>
      </div>

      {menu === 'audio' && (
        <div className="absolute right-8 bottom-40 z-30 w-72 rounded-2xl bg-black/90 border border-white/15 p-2 overflow-visible animate-fade-in pointer-events-auto">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/70">Audio</p>
            <span className="text-xs text-brand-ice/60 font-nunito">▲▼ · OK · Back</span>
          </div>
          {auds.length === 0 && <p className="text-sm text-brand-ice/70 px-3 py-2">No tracks</p>}
          <div className="space-y-1">
            {auds.map((a, i) => (
              <div key={`${a.id}-${a.label}`} data-focused={menuIdx === i ? 'true' : 'false'}
                className={`tv-ring px-3 py-3 rounded-xl font-nunito text-sm flex items-center justify-between ${menuIdx === i ? 'bg-brand-gold/20 text-white scale-[1.02] z-10' : 'text-brand-ice/90'}`}>
                <span className="truncate">{a.label}</span>{a.active && <span className="text-brand-gold text-xs">●</span>}
              </div>
            ))}
            <div data-focused={menuIdx === auds.length ? 'true' : 'false'}
              className={`tv-ring px-3 py-3 rounded-xl font-nunito text-sm flex items-center gap-2 ${menuIdx === auds.length ? 'bg-brand-gold/20 text-white scale-[1.02] z-10' : 'text-brand-gold'}`}>
              <VolumeX className="w-3.5 h-3.5" />
              <span className="truncate">Fix audio (no sound?)</span>
            </div>
          </div>
        </div>
      )}

      {menu === 'volume' && (
        <div className="absolute right-8 bottom-40 z-30 w-72 rounded-2xl bg-black/90 border border-white/15 p-2 overflow-visible animate-fade-in pointer-events-auto">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/70 flex items-center gap-2">
              {volPct === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              Volume
            </p>
            <span className="text-xs text-brand-ice/60 font-nunito">◀ ▶ · OK · Back</span>
          </div>
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="h-2 flex-1 rounded-full bg-white/15 overflow-hidden">
              <div className="h-full bg-brand-gold transition-[width] duration-150 ease-out" style={{ width: `${volPct}%` }} />
            </div>
            <span className="text-sm font-quicksand font-bold text-brand-gold tabular-nums w-10 text-right">{volPct}%</span>
          </div>
        </div>
      )}


      {menu === 'format' && (
        <div className="absolute right-8 bottom-40 z-30 w-72 rounded-2xl bg-black/90 border border-white/15 p-2 overflow-visible animate-fade-in pointer-events-auto">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/70">Screen format</p>
            <span className="text-xs text-brand-ice/60 font-nunito">▲▼ · OK · Back</span>
          </div>
          <div className="space-y-1">
            {SCREEN_FORMATS.map((f, i) => (
              <div key={f.id} data-focused={menuIdx === i ? 'true' : 'false'}
                className={`tv-ring px-3 py-2 rounded-xl font-nunito text-sm ${menuIdx === i ? 'bg-brand-gold/20 text-white scale-[1.02] z-10' : 'text-brand-ice/90'}`}>
                <div className="flex items-center justify-between">
                  <span className="truncate">{f.label}</span>
                  {f.id === screen.format && <span className="text-brand-gold text-xs">●</span>}
                </div>
                <div className="text-[11px] text-brand-ice/60">{f.hint}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {menu === 'quality' && (
        <div className="absolute right-8 bottom-40 z-30 w-72 rounded-2xl bg-black/90 border border-white/15 p-2 overflow-visible animate-fade-in pointer-events-auto">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/70">Quality</p>
            <span className="text-xs text-brand-ice/60 font-nunito">▲▼ · OK · Back</span>
          </div>
          <div className="space-y-1">
            {PLEX_QUALITY_PRESETS.map((p, i) => (
              <div key={p.key} data-focused={menuIdx === i ? 'true' : 'false'}
                className={`tv-ring px-3 py-3 rounded-xl font-nunito text-sm flex items-center justify-between ${menuIdx === i ? 'bg-brand-gold/20 text-white scale-[1.02] z-10' : 'text-brand-ice/90'}`}>
                <span className="truncate">{p.label}</span>{p.key === qualityKey && <span className="text-brand-gold text-xs">●</span>}
              </div>
            ))}
          </div>
        </div>
      )}


      {menu === 'subs' && (
        <div className="absolute right-8 bottom-40 z-30 w-72 rounded-2xl bg-black/90 border border-white/15 p-2 overflow-visible animate-fade-in pointer-events-auto">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/70">Subtitles</p>
            <span className="text-xs text-brand-ice/60 font-nunito">▲▼ · OK · Back</span>
          </div>
          <div className="space-y-1">
            {subsList.map((r, i) => (
              <div key={`${r.id}-${r.label}-${i}`} data-focused={menuIdx === i ? 'true' : 'false'}
                className={`tv-ring px-3 py-3 rounded-xl font-nunito text-sm flex items-center justify-between ${menuIdx === i ? 'bg-brand-gold/20 text-white scale-[1.02] z-10' : r.id === -2 ? 'text-brand-gold' : 'text-brand-ice/90'}`}>
                <span className="truncate">{r.label}</span>{r.active && <span className="text-brand-gold text-xs">●</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {menu === 'osdl' && (
        <div className="absolute right-8 bottom-40 z-30 w-96 max-h-[60vh] overflow-y-auto rounded-2xl bg-black/90 border border-white/15 p-2 animate-fade-in pointer-events-auto">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/70 flex items-center gap-2">
              <Download className="w-3.5 h-3.5 text-brand-gold" /> OpenSubtitles
            </p>
            <span className="text-xs text-brand-ice/60 font-nunito">▲▼ · OK · Back</span>
          </div>
          {osdlLoading && (
            <div className="flex items-center gap-2 px-3 py-4 text-brand-ice/70 font-nunito text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> Searching…
            </div>
          )}
          {!osdlLoading && osdlError && (
            <p className="px-3 py-3 text-sm font-nunito text-brand-ice/70">{osdlError}</p>
          )}
          {!osdlLoading && !osdlError && osdlResults.length === 0 && (
            <p className="px-3 py-3 text-sm font-nunito text-brand-ice/70">No subtitles found.</p>
          )}
          <div className="space-y-1 px-1">
            {!osdlLoading && osdlResults.map((r, i) => (
              <div key={r.id}
                data-focused={menuIdx === i ? 'true' : 'false'}
                className={`tv-ring px-3 py-3 rounded-xl font-nunito text-sm flex items-center gap-2 ${menuIdx === i ? 'bg-brand-gold/20 text-white scale-[1.02] z-10' : 'text-brand-ice/90'}`}>
                <span className="uppercase font-quicksand font-bold w-8 text-brand-gold">{r.lang}</span>
                <span className="flex-1 truncate">{r.release || '—'}</span>
                <span className="text-xs text-brand-ice/70 tabular-nums">{r.downloads}⬇</span>
                {osdlBusyId === r.id && <Loader2 className="w-3 h-3 animate-spin text-brand-gold" />}
              </div>
            ))}
          </div>
        </div>
      )}

      {menu === 'help' && (
        <div className="absolute right-8 bottom-40 z-30 w-72 rounded-2xl bg-black/90 border border-white/15 p-2 overflow-visible animate-fade-in pointer-events-auto">
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/70 flex items-center gap-2">
              <LifeBuoy className="w-3.5 h-3.5 text-brand-gold" /> Help
            </p>
            <span className="text-xs text-brand-ice/60 font-nunito">▲▼ · OK · Back</span>
          </div>
          {routeLabel && (
            <p className="px-2 pb-2 text-xs text-brand-ice/70 font-nunito">Connection: <span className="text-white/90">{routeLabel}</span></p>
          )}
          <div className="space-y-1">
            {['Fix buffering — step-by-step guide', 'More help & support'].map((label, i) => (
              <div key={label} data-focused={menuIdx === i ? 'true' : 'false'}
                className={`tv-ring px-3 py-3 rounded-xl font-nunito text-sm flex items-center justify-between ${menuIdx === i ? 'bg-brand-gold/20 text-white scale-[1.02] z-10' : 'text-brand-ice/90'}`}>
                <span className="truncate">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
});


PlexPlayerOverlay.displayName = 'PlexPlayerOverlay';
export default PlexPlayerOverlay;
