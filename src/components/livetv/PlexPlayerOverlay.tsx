// Plex VOD playback overlay. Shown for 5s on any key while fullscreen. Owns
// its own keydown listener (capture=true) when visible; hides on Back. When
// hidden, this component renders nothing — PlexSection's own Back handler
// exits playback. Native-only (uses SnowPlayer position/tracks).
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Rewind, FastForward, Subtitles, AudioLines, Download, Loader2, Gauge, LifeBuoy, Volume2, VolumeX } from 'lucide-react';
import type { VideoController, VideoTrackInfo } from './VideoPlayer';
import type { SnowSubtitle } from '@/capacitor/SnowPlayer';
import { searchOpenSubtitles, downloadOpenSubtitle, type OpenSubResult } from '@/lib/opensubtitles';
import { PLEX_QUALITY_PRESETS } from '@/lib/plex';
import { useToast } from '@/hooks/use-toast';

type Row = 'seek-10' | 'play' | 'seek+30' | 'audio' | 'subs' | 'quality' | 'volume' | 'buffering';
const ROWS: Row[] = ['seek-10', 'play', 'seek+30', 'audio', 'subs', 'quality', 'volume', 'buffering'];

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
  /** Current playback volume 0..1. */
  volume: number;
  /** Called with the new volume 0..1 (live-adjusted from the slider popup). */
  onChangeVolume: (v: number) => void;
}


const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(ss)}` : `${pad2(m)}:${pad2(ss)}`;
};

const PlexPlayerOverlay = memo(({ active, title, resolutionLabel, controller, tracksTick, getPosition, seekTo, onBackWhileHidden, subtitleContext, onLoadExternalSubtitle, qualityKey, onChangeQuality, onOpenBufferingGuide, volume, onChangeVolume }: Props) => {
  const [visible, setVisible] = useState(false);
  const [row, setRow] = useState<Row>('play');
  const [menu, setMenu] = useState<'none' | 'audio' | 'subs' | 'osdl' | 'quality' | 'volume'>('none');
  const [menuIdx, setMenuIdx] = useState(0);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(false);
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
    hideTimerRef.current = window.setTimeout(() => { setVisible(false); setMenu('none'); }, 5000);
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

  const doAction = useCallback(async (r: Row) => {
    if (!controller && r !== 'volume' && r !== 'buffering') return;
    if (r === 'play') controller?.togglePlay();
    else if (r === 'seek-10') { const p = await getPosition(); await seekTo(Math.max(0, p.position - 10)); }
    else if (r === 'seek+30') { const p = await getPosition(); await seekTo(p.position + 30); }
    else if (r === 'audio') { setMenu('audio'); setMenuIdx(Math.max(0, auds.findIndex((a) => a.active))); }
    else if (r === 'subs') { openSubs(); }
    else if (r === 'quality') { openQuality(); }
    else if (r === 'volume') { setMenu('volume'); setMenuIdx(0); }
    else if (r === 'buffering') { onOpenBufferingGuide?.(); }
  }, [controller, getPosition, seekTo, auds, openSubs, openQuality, onOpenBufferingGuide]);

  // Refs for key handler
  const rowRef = useRef(row); useEffect(() => { rowRef.current = row; }, [row]);
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
  const onChangeQualityRef = useRef(onChangeQuality); useEffect(() => { onChangeQualityRef.current = onChangeQuality; }, [onChangeQuality]);
  const getPositionRef = useRef(getPosition); useEffect(() => { getPositionRef.current = getPosition; }, [getPosition]);
  const toastRef = useRef(toast); useEffect(() => { toastRef.current = toast; }, [toast]);

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;
      const isNav = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '].includes(e.key);

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
        if (list.length === 0) { setMenu('none'); return; }
        const i = menuIdxRef.current;
        if (e.key === 'ArrowUp') setMenuIdx(Math.max(0, i - 1));
        else if (e.key === 'ArrowDown') setMenuIdx(Math.min(list.length - 1, i + 1));
        else if (e.key === 'Enter' || e.key === ' ') { const track = list[i]; if (track) controllerRef.current?.setAudioTrack(track.id); setMenu('none'); }
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
        else if (e.key === 'Enter' || e.key === ' ') {
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
        else if (e.key === 'Enter' || e.key === ' ') { const item = list[i]; if (item) void pickOsdlRef.current(item); }
        return;
      }
      if (menuRef.current === 'quality') {
        const list = PLEX_QUALITY_PRESETS;
        const i = menuIdxRef.current;
        if (e.key === 'ArrowUp') setMenuIdx(Math.max(0, i - 1));
        else if (e.key === 'ArrowDown') setMenuIdx(Math.min(list.length - 1, i + 1));
        else if (e.key === 'Enter' || e.key === ' ') {
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

      // main control row (horizontal)
      const r = rowRef.current;
      const idx = ROWS.indexOf(r);
      if (e.key === 'ArrowLeft') { if (idx > 0) setRow(ROWS[idx - 1]); }
      else if (e.key === 'ArrowRight') { if (idx < ROWS.length - 1) setRow(ROWS[idx + 1]); }
      else if (e.key === 'Enter' || e.key === ' ') void doActionRef.current(r);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [active]);

  if (!visible) return null;

  const pct = dur > 0 ? Math.min(100, Math.max(0, (pos / dur) * 100)) : 0;
  const btnBase = 'flex items-center justify-center rounded-full transition-transform duration-150';
  const focusVis = (r: Row) => row === r
    ? 'bg-brand-gold text-brand-navy scale-110 shadow-[0_0_18px_rgba(245,200,80,0.55)]'
    : 'bg-white/10 text-white';

  const subsList: Array<{ id: number; label: string; active: boolean }> = [
    { id: -1, label: 'Off', active: subs.every((s) => !s.active) },
    ...subs.map((s) => ({ id: s.id, label: s.label, active: s.active })),
    { id: -2, label: '⬇ Get subtitles…', active: false },
  ];

  return (
    <>
      <div className="absolute left-0 right-0 bottom-0 z-20 px-6 pt-16 pb-5 bg-gradient-to-t from-black/95 via-black/70 to-transparent animate-fade-in pointer-events-none">
        <div className="max-w-6xl mx-auto pointer-events-auto">
          <p className="font-quicksand font-bold text-white truncate mb-2">
            {title}
            {resolutionLabel && (
              <span className={`ml-2 align-middle text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/70 ${resolutionLabel === '4K' ? 'text-brand-gold' : 'text-white/80'}`}>{resolutionLabel}</span>
            )}
          </p>
          <div className="h-1.5 bg-white/15 rounded-full overflow-hidden">
            <div className="h-full bg-brand-gold" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between text-[11px] text-brand-ice/70 font-nunito tabular-nums mt-1">
            <span>{fmtTime(pos)}</span>
            <span>{dur > 0 ? fmtTime(dur) : ''}</span>
          </div>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button type="button" data-focused={row === 'seek-10' ? 'true' : 'false'} className={`${btnBase} w-12 h-12 ${focusVis('seek-10')}`} aria-label="Back 10 seconds"><Rewind className="w-5 h-5" /></button>
            <button type="button" data-focused={row === 'play' ? 'true' : 'false'} className={`${btnBase} w-16 h-16 ${focusVis('play')}`} aria-label="Play/Pause">
              {paused ? <Play className="w-7 h-7 fill-current" /> : <Pause className="w-7 h-7 fill-current" />}
            </button>
            <button type="button" data-focused={row === 'seek+30' ? 'true' : 'false'} className={`${btnBase} w-12 h-12 ${focusVis('seek+30')}`} aria-label="Forward 30 seconds"><FastForward className="w-5 h-5" /></button>
            <button type="button" data-focused={row === 'audio' ? 'true' : 'false'} className={`${btnBase} w-12 h-12 ${focusVis('audio')}`} aria-label="Audio"><AudioLines className="w-5 h-5" /></button>
            <button type="button" data-focused={row === 'subs' ? 'true' : 'false'} className={`${btnBase} w-12 h-12 ${focusVis('subs')}`} aria-label="Subtitles"><Subtitles className="w-5 h-5" /></button>
            <button type="button" data-focused={row === 'quality' ? 'true' : 'false'} className={`${btnBase} w-12 h-12 ${focusVis('quality')}`} aria-label="Quality"><Gauge className="w-5 h-5" /></button>
            <div className="flex flex-col items-center gap-0.5">
              <button type="button" data-focused={row === 'buffering' ? 'true' : 'false'} className={`${btnBase} w-12 h-12 ${focusVis('buffering')}`} aria-label="Buffering help" onClick={() => onOpenBufferingGuide?.()}><LifeBuoy className="w-5 h-5" /></button>
              <span className="text-[9px] font-nunito text-brand-ice/70 leading-none">Help</span>
            </div>
          </div>
          <p className="text-center text-[11px] text-brand-ice/60 font-nunito mt-2">
            {row === 'buffering'
              ? 'Buffering help — OK opens the fix-buffering guide'
              : '◀ ▶ select · OK activate · Back hides · idle 5s auto-hides'}
          </p>
        </div>
      </div>

      {menu === 'audio' && (
        <div className="absolute right-8 bottom-40 z-30 w-64 rounded-xl bg-black/95 border border-white/15 p-2 animate-fade-in pointer-events-auto">
          <p className="text-xs font-quicksand font-semibold text-brand-ice/70 px-2 py-1">Audio</p>
          {auds.length === 0 && <p className="text-xs text-brand-ice/50 px-3 py-2">No tracks</p>}
          {auds.map((a, i) => (
            <div key={`${a.id}-${a.label}`} data-focused={menuIdx === i ? 'true' : 'false'}
              className={`px-3 py-2 rounded-lg font-nunito text-sm flex items-center justify-between ${menuIdx === i ? 'bg-brand-gold/25 ring-2 ring-brand-gold text-white' : 'text-brand-ice'}`}>
              <span className="truncate">{a.label}</span>{a.active && <span className="text-[10px] text-brand-gold">●</span>}
            </div>
          ))}
        </div>
      )}

      {menu === 'quality' && (
        <div className="absolute right-8 bottom-40 z-30 w-64 rounded-xl bg-black/95 border border-white/15 p-2 animate-fade-in pointer-events-auto">
          <p className="text-xs font-quicksand font-semibold text-brand-ice/70 px-2 py-1">Quality</p>
          {PLEX_QUALITY_PRESETS.map((p, i) => (
            <div key={p.key} data-focused={menuIdx === i ? 'true' : 'false'}
              className={`px-3 py-2 rounded-lg font-nunito text-sm flex items-center justify-between ${menuIdx === i ? 'bg-brand-gold/25 ring-2 ring-brand-gold text-white' : 'text-brand-ice'}`}>
              <span className="truncate">{p.label}</span>{p.key === qualityKey && <span className="text-[10px] text-brand-gold">●</span>}
            </div>
          ))}
        </div>
      )}


      {menu === 'subs' && (
        <div className="absolute right-8 bottom-40 z-30 w-72 rounded-xl bg-black/95 border border-white/15 p-2 animate-fade-in pointer-events-auto">
          <p className="text-xs font-quicksand font-semibold text-brand-ice/70 px-2 py-1">Subtitles</p>
          {subsList.map((r, i) => (
            <div key={`${r.id}-${r.label}-${i}`} data-focused={menuIdx === i ? 'true' : 'false'}
              className={`px-3 py-2 rounded-lg font-nunito text-sm flex items-center justify-between ${menuIdx === i ? 'bg-brand-gold/25 ring-2 ring-brand-gold text-white' : r.id === -2 ? 'text-brand-gold' : 'text-brand-ice'}`}>
              <span className="truncate">{r.label}</span>{r.active && <span className="text-[10px] text-brand-gold">●</span>}
            </div>
          ))}
        </div>
      )}

      {menu === 'osdl' && (
        <div className="absolute right-8 bottom-40 z-30 w-96 max-h-[60vh] overflow-y-auto rounded-xl bg-black/95 border border-white/15 p-2 animate-fade-in pointer-events-auto">
          <div className="flex items-center gap-2 px-2 py-1">
            <Download className="w-3.5 h-3.5 text-brand-gold" />
            <p className="text-xs font-quicksand font-semibold text-brand-ice/70">OpenSubtitles</p>
          </div>
          {osdlLoading && (
            <div className="flex items-center gap-2 px-3 py-4 text-brand-ice/60 font-nunito text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-brand-gold" /> Searching…
            </div>
          )}
          {!osdlLoading && osdlError && (
            <p className="px-3 py-3 text-xs font-nunito text-brand-ice/70">{osdlError}</p>
          )}
          {!osdlLoading && !osdlError && osdlResults.length === 0 && (
            <p className="px-3 py-3 text-xs font-nunito text-brand-ice/50">No subtitles found.</p>
          )}
          {!osdlLoading && osdlResults.map((r, i) => (
            <div key={r.id}
              data-focused={menuIdx === i ? 'true' : 'false'}
              className={`px-3 py-2 rounded-lg font-nunito text-xs flex items-center gap-2 ${menuIdx === i ? 'bg-brand-gold/25 ring-2 ring-brand-gold text-white' : 'text-brand-ice'}`}>
              <span className="uppercase font-quicksand font-bold w-8 text-brand-gold">{r.lang}</span>
              <span className="flex-1 truncate">{r.release || '—'}</span>
              <span className="text-[10px] text-brand-ice/60 tabular-nums">{r.downloads}⬇</span>
              {osdlBusyId === r.id && <Loader2 className="w-3 h-3 animate-spin text-brand-gold" />}
            </div>
          ))}
          <p className="text-center text-[10px] text-brand-ice/50 font-nunito mt-1">▲ ▼ select · OK download · Back</p>
        </div>
      )}
    </>
  );
});


PlexPlayerOverlay.displayName = 'PlexPlayerOverlay';
export default PlexPlayerOverlay;
