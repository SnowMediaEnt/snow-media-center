// Plex VOD playback overlay. Shown for 5s on any key while fullscreen. Owns
// its own keydown listener (capture=true) when visible; hides on Back. When
// hidden, this component renders nothing — PlexSection's own Back handler
// exits playback. Native-only (uses SnowPlayer position/tracks).
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Rewind, FastForward, Subtitles, AudioLines } from 'lucide-react';
import type { VideoController, VideoTrackInfo } from './VideoPlayer';

type Row = 'seek-10' | 'play' | 'seek+30' | 'audio' | 'subs';
const ROWS: Row[] = ['seek-10', 'play', 'seek+30', 'audio', 'subs'];

interface Props {
  active: boolean;                              // component only wires listeners when true
  title: string;
  controller: VideoController | null;
  tracksTick: number;
  getPosition: () => Promise<{ position: number; duration: number; playing: boolean }>;
  seekTo: (sec: number) => Promise<void>;
  onBackWhileHidden: () => void;                // called when Back pressed with overlay hidden (fullscreen exit)
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(ss)}` : `${pad2(m)}:${pad2(ss)}`;
};

const PlexPlayerOverlay = memo(({ active, title, controller, tracksTick, getPosition, seekTo, onBackWhileHidden }: Props) => {
  const [visible, setVisible] = useState(false);
  const [row, setRow] = useState<Row>('play');
  const [menu, setMenu] = useState<'none' | 'audio' | 'subs'>('none');
  const [menuIdx, setMenuIdx] = useState(0);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(false);

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

  const doAction = useCallback(async (r: Row) => {
    if (!controller) return;
    if (r === 'play') controller.togglePlay();
    else if (r === 'seek-10') { const p = await getPosition(); await seekTo(Math.max(0, p.position - 10)); }
    else if (r === 'seek+30') { const p = await getPosition(); await seekTo(p.position + 30); }
    else if (r === 'audio') { setMenu('audio'); setMenuIdx(Math.max(0, auds.findIndex((a) => a.active))); }
    else if (r === 'subs') {
      setMenu('subs');
      const activeIdx = subs.findIndex((s) => s.active);
      setMenuIdx(activeIdx >= 0 ? activeIdx + 1 : 0);
    }
  }, [controller, getPosition, seekTo, auds, subs]);

  // Refs for key handler
  const rowRef = useRef(row); useEffect(() => { rowRef.current = row; }, [row]);
  const visibleRef = useRef(visible); useEffect(() => { visibleRef.current = visible; }, [visible]);
  const menuRef = useRef(menu); useEffect(() => { menuRef.current = menu; }, [menu]);
  const menuIdxRef = useRef(menuIdx); useEffect(() => { menuIdxRef.current = menuIdx; }, [menuIdx]);
  const subsRef = useRef(subs); useEffect(() => { subsRef.current = subs; }, [subs]);
  const audsRef = useRef(auds); useEffect(() => { audsRef.current = auds; }, [auds]);
  const doActionRef = useRef(doAction); useEffect(() => { doActionRef.current = doAction; }, [doAction]);
  const showRef = useRef(show); useEffect(() => { showRef.current = show; }, [show]);
  const armHideRef = useRef(armHide); useEffect(() => { armHideRef.current = armHide; }, [armHide]);
  const controllerRef = useRef(controller); useEffect(() => { controllerRef.current = controller; }, [controller]);
  const onBackHiddenRef = useRef(onBackWhileHidden); useEffect(() => { onBackHiddenRef.current = onBackWhileHidden; }, [onBackWhileHidden]);

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;
      const isNav = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '].includes(e.key);

      if (isBack) {
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
        // list = [Off, ...subs]
        const list = subsRef.current;
        const total = list.length + 1;
        const i = menuIdxRef.current;
        if (e.key === 'ArrowUp') setMenuIdx(Math.max(0, i - 1));
        else if (e.key === 'ArrowDown') setMenuIdx(Math.min(total - 1, i + 1));
        else if (e.key === 'Enter' || e.key === ' ') {
          if (i === 0) controllerRef.current?.setSubtitleTrack(-1);
          else { const track = list[i - 1]; if (track) controllerRef.current?.setSubtitleTrack(track.id); }
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

  return (
    <>
      <div className="absolute left-0 right-0 bottom-0 z-20 px-6 pt-16 pb-5 bg-gradient-to-t from-black/95 via-black/70 to-transparent animate-fade-in pointer-events-none">
        <div className="max-w-6xl mx-auto pointer-events-auto">
          <p className="font-quicksand font-bold text-white truncate mb-2">{title}</p>
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
          </div>
          <p className="text-center text-[11px] text-brand-ice/50 font-nunito mt-2">◀ ▶ select · OK activate · Back hides · idle 5s auto-hides</p>
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
      {menu === 'subs' && (
        <div className="absolute right-8 bottom-40 z-30 w-64 rounded-xl bg-black/95 border border-white/15 p-2 animate-fade-in pointer-events-auto">
          <p className="text-xs font-quicksand font-semibold text-brand-ice/70 px-2 py-1">Subtitles</p>
          {[{ id: -1, label: 'Off', active: subs.every((s) => !s.active) } as VideoTrackInfo]
            .concat(subs)
            .map((row, i) => (
              <div key={`${row.id}-${row.label}-${i}`} data-focused={menuIdx === i ? 'true' : 'false'}
                className={`px-3 py-2 rounded-lg font-nunito text-sm flex items-center justify-between ${menuIdx === i ? 'bg-brand-gold/25 ring-2 ring-brand-gold text-white' : 'text-brand-ice'}`}>
                <span className="truncate">{row.label}</span>{row.active && <span className="text-[10px] text-brand-gold">●</span>}
              </div>
            ))}
        </div>
      )}
    </>
  );
});

PlexPlayerOverlay.displayName = 'PlexPlayerOverlay';
export default PlexPlayerOverlay;
