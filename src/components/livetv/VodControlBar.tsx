// The control bar over a Live TV film or episode (VodPlayer), the same look
// as the channel bar (PlayerControlBar's BarButton, its popup menus) and the
// Plex player's seek bar.
//
// - OK, ▲ or ▼ bring it up on Play; it hides 5 s after the last key, and
//   stays while the film is paused (however it was paused).
// - Buttons (vodBar.ts): back 10 s, play/pause, forward 30 s, next episode
//   (a series), subtitles, audio, volume (to 150% on the native player),
//   stats (native). ▲ from the buttons reaches the seek bar: ◀ ▶ move the
//   marker (bigger jumps when held), and the film jumps there on OK or a
//   second after the last press.
// - With the bar hidden ◀ ▶ jump back 10 s / forward 30 s, like the remote's
//   media keys. They no longer touch the volume: changing it silently with
//   nothing on screen was half of the "no sound" reports. Volume is the bar's.
// - Back: a menu, then the stats panel, then the bar, then the player.
// - Touch screens (phones, tablets) only: a tap on the picture brings the bar
//   up or puts it away (a popup menu closes first), a tap on a button or a
//   menu row does what OK does on it, a finger on the seek bar moves the
//   marker and the film jumps where it lifts, and one on the volume level
//   sets it (usePlayerTouch). A TV gets no listener and no click handler.
// - Owns its own keydown listener (window, capture) for as long as it is
//   mounted; the section behind leaves every key to it while a film plays.
//   The remote's media keys stay the player's (onMediaKey); Next skips to
//   the next episode here.
//
// Chrome 66: no inset, no aspect-ratio, no gap beyond gap-1..4.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioLines, FastForward, Gauge, Pause, Play, Rewind, SkipForward, Subtitles, Volume2, VolumeX } from 'lucide-react';
import type { VideoController, VideoTrackInfo } from './VideoPlayer';
import { BarButton } from './PlayerControlBar';
import PlayerStatsPanel from './PlayerStatsPanel';
import { moveBarFocus } from './liveBar';
import { VOD_BACK_SEC, VOD_FWD_SEC, vodBarDisabled, vodBarLabel, vodBarOrder, type VodBarId } from './vodBar';
import { stepVolume } from '@/utils/volume';
import { keepInView } from '@/utils/keepInView';
import { onMediaKey } from '@/lib/mediaKeys';
import { useTouchUI } from '@/lib/phoneMode';
import { touchChrome, usePictureTouch, useTrackTouch, type DragPhase } from '@/hooks/usePlayerTouch';

type Focus = VodBarId | 'timeline';
type Menu = 'none' | 'cc' | 'audio' | 'vol';

/** The bar hides this long after the last key (not while paused). */
export const VOD_BAR_HIDE_MS = 5000;
/** On the seek bar the film jumps this long after the last ◀ ▶ (OK: at once). */
export const VOD_SCRUB_COMMIT_MS = 1000;
// Seek-bar step (seconds) by acceleration level; every 4 quick presses
// (< 700 ms apart) bump one level, as on the Plex player.
const SCRUB_STEPS = [10, 30, 60, 120, 300];
const SCRUB_REPEAT_MS = 700;
const SEEK_NOTE_MS = 1500;

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`;
};

export interface VodPosition { position: number; duration: number; playing: boolean }

interface Props {
  title?: string;
  controller: VideoController | null;
  /** Bumped when the player's track lists change: the menus re-read them. */
  tracksTick: number;
  /** Paused on purpose (not a stall). */
  paused: boolean;
  getPosition: () => Promise<VodPosition>;
  seekTo: (sec: number) => Promise<void> | void;
  /** 0..maxVolume. */
  volume: number;
  /** 1.5 on the native player (boost past 100%), 1 in the browser. */
  maxVolume: number;
  onVolume: (v: number) => void;
  /** Back with nothing else open. Left out: Back passes through. */
  onClose?: () => void;
  /** A series: the Next episode button (greyed out on the last one). */
  onNext?: () => void;
  hasNext?: boolean;
  /** The Stats button and panel (the native player's numbers). */
  stats?: boolean;
  /** An error card is up: OK is its Retry's, and the bar stays down. */
  blocked?: boolean;
  /** The viewer picked a sound track (kept over the automatic pick). */
  onAudioPicked?: (id: number) => void;
}

export default function VodControlBar({
  title, controller, tracksTick, paused, getPosition, seekTo, volume, maxVolume, onVolume,
  onClose, onNext, hasNext = false, stats = false, blocked = false, onAudioPicked,
}: Props) {
  const { t } = useTranslation();
  // Fixed for the life of the player: buttons never move under the highlight.
  const [order] = useState(() => vodBarOrder({ next: !!onNext, stats }));

  const [visible, setVisible] = useState(false);
  const [focus, setFocus] = useState<Focus>('play');
  const [menu, setMenu] = useState<Menu>('none');
  const [menuIdx, setMenuIdx] = useState(0);
  const [statsOn, setStatsOn] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [scrubPos, setScrubPos] = useState<number | null>(null);
  // ◀ ▶ with the bar hidden: which way, and where the film is now.
  const [seekNote, setSeekNote] = useState<{ dir: 1 | -1; at: number; dur: number } | null>(null);

  void tracksTick; // the lists below are re-read on every render
  const subs: VideoTrackInfo[] = controller?.getSubtitleTracks() ?? [];
  const auds: VideoTrackInfo[] = controller?.getAudioTracks() ?? [];
  const disabled = (id: VodBarId) => vodBarDisabled(id, { subtitles: subs.length, audios: auds.length, hasNext });

  const hideTimer = useRef<number | null>(null);
  const scrubTimer = useRef<number | null>(null);
  const noteTimer = useRef<number | null>(null);
  const scrubRepeat = useRef({ at: 0, count: 0 });
  const clearTimer = (r: { current: number | null }) => { if (r.current) { window.clearTimeout(r.current); r.current = null; } };

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const armHide = useCallback(() => {
    clearTimer(hideTimer);
    if (pausedRef.current) return; // paused: the bar stays
    hideTimer.current = window.setTimeout(() => { setVisible(false); setMenu('none'); setScrubPos(null); }, VOD_BAR_HIDE_MS);
  }, []);

  // Everything the key handler reads, current as of the last render.
  const cur = useRef({
    visible, focus, menu, menuIdx, statsOn, pos, dur, scrubPos, subs, auds, order, disabled,
    controller, getPosition, seekTo, volume, maxVolume, onVolume, onClose, onNext, blocked, onAudioPicked,
  });
  cur.current = {
    visible, focus, menu, menuIdx, statsOn, pos, dur, scrubPos, subs, auds, order, disabled,
    controller, getPosition, seekTo, volume, maxVolume, onVolume, onClose, onNext, blocked, onAudioPicked,
  };

  // Where the film is, once a second while the bar is up.
  useEffect(() => {
    if (!visible) return;
    let gone = false;
    const tick = async () => {
      const p = await cur.current.getPosition();
      if (gone) return;
      setPos(p.position);
      setDur(p.duration);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1000);
    return () => { gone = true; window.clearInterval(id); };
  }, [visible]);

  // A pause brings the bar up on Play and holds it; playing again lets it hide.
  useEffect(() => {
    if (blocked) return;
    if (paused) {
      clearTimer(hideTimer);
      if (!cur.current.visible) { setFocus('play'); setScrubPos(null); setVisible(true); }
    } else if (cur.current.visible) {
      armHide();
    }
  }, [paused, blocked, armHide]);

  // An error card takes the screen: the bar and its menus step aside.
  useEffect(() => {
    if (blocked) { setVisible(false); setMenu('none'); setScrubPos(null); }
  }, [blocked]);

  useEffect(() => () => { clearTimer(hideTimer); clearTimer(scrubTimer); clearTimer(noteTimer); }, []);

  // A jump of `delta` seconds from where the film is now.
  const seekBy = useCallback(async (delta: number, note: boolean) => {
    const c = cur.current;
    const p = await c.getPosition();
    const max = p.duration > 0 ? Math.max(0, p.duration - 1) : Number.MAX_SAFE_INTEGER;
    const to = Math.min(max, Math.max(0, p.position + delta));
    await c.seekTo(to);
    setPos(to);
    if (p.duration > 0) setDur(p.duration);
    if (note) {
      clearTimer(noteTimer);
      setSeekNote({ dir: delta < 0 ? -1 : 1, at: to, dur: p.duration });
      noteTimer.current = window.setTimeout(() => setSeekNote(null), SEEK_NOTE_MS);
    }
  }, []);

  const commitScrub = useCallback(() => {
    clearTimer(scrubTimer);
    const c = cur.current;
    const target = c.scrubPos;
    setScrubPos(null);
    if (target != null && Math.abs(target - c.pos) >= 1) {
      setPos(target);
      void c.seekTo(target);
    }
  }, []);

  const setVol = useCallback((v: number) => {
    const c = cur.current;
    c.onVolume(Math.min(c.maxVolume, Math.max(0, v)));
  }, []);

  // OK with the bar down, and a tap on the picture: the bar comes up on Play.
  const showBar = useCallback(() => {
    clearTimer(noteTimer);
    setSeekNote(null);
    setFocus('play');
    setMenu('none');
    setVisible(true);
    armHide();
  }, [armHide]);

  // OK on a subtitles / audio row (0 = Off in the subtitles), and a tap on one.
  const pickRow = useCallback((i: number) => {
    const c = cur.current;
    if (c.menu === 'cc') {
      if (i === 0) c.controller?.setSubtitleTrack(-1);
      else { const s = c.subs[i - 1]; if (s) c.controller?.setSubtitleTrack(s.id); }
    } else if (c.menu === 'audio') {
      const a = c.auds[i];
      if (a) { c.controller?.setAudioTrack(a.id); c.onAudioPicked?.(a.id); }
    }
    setMenu('none');
  }, []);

  const act = useCallback((id: VodBarId, repeat: boolean) => {
    const c = cur.current;
    if (c.disabled(id)) return;
    if (id === 'play') { if (!repeat) c.controller?.togglePlay(); }
    else if (id === 'rew') void seekBy(-VOD_BACK_SEC, false);
    else if (id === 'fwd') void seekBy(VOD_FWD_SEC, false);
    else if (id === 'next') { if (!repeat) { c.onNext?.(); setFocus('play'); } }
    else if (id === 'cc') { setMenu('cc'); setMenuIdx(Math.max(0, c.subs.findIndex((s) => s.active) + 1)); }
    else if (id === 'audio') { setMenu('audio'); setMenuIdx(Math.max(0, c.auds.findIndex((a) => a.active))); }
    else if (id === 'vol') setMenu('vol');
    else if (id === 'stats') { if (!repeat) setStatsOn((on) => !on); }
  }, [seekBy]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const c = cur.current;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;
      // keyCode 23 (DPAD_CENTER) / 66 (ENTER): remotes whose OK has no useful e.key.
      const isOk = e.key === 'Enter' || e.key === ' ' || e.keyCode === 23 || e.keyCode === 66;
      const isArrow = e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      if (!isBack && !isOk && !isArrow) return; // media keys and the rest pass by
      const stop = () => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

      if (isBack) {
        if (c.menu !== 'none') { stop(); setMenu('none'); armHide(); return; }
        if (c.statsOn) { stop(); setStatsOn(false); if (c.visible) armHide(); return; }
        if (c.visible) { stop(); clearTimer(scrubTimer); setScrubPos(null); setVisible(false); return; }
        if (!c.onClose) return;
        stop();
        c.onClose();
        return;
      }
      // The error card's Retry (it has the DOM focus) takes OK.
      const ae = document.activeElement;
      if (c.blocked || (isOk && ae instanceof HTMLButtonElement && !!ae.closest('[data-vod-player]') && !ae.closest('[data-vod-bar]'))) return;
      stop();

      if (!c.visible) {
        if (e.key === 'ArrowLeft') { void seekBy(-VOD_BACK_SEC, true); return; }
        if (e.key === 'ArrowRight') { void seekBy(VOD_FWD_SEC, true); return; }
        showBar();
        return;
      }
      armHide();

      if (c.menu === 'vol') {
        if (e.key === 'ArrowLeft') setVol(+(c.volume - 0.1).toFixed(2));
        else if (e.key === 'ArrowRight') setVol(stepVolume(c.volume, 0.1));
        else if (isOk) setMenu('none');
        return;
      }
      if (c.menu === 'cc' || c.menu === 'audio') {
        const count = c.menu === 'cc' ? c.subs.length + 1 : c.auds.length;
        const i = c.menuIdx;
        if (e.key === 'ArrowUp') setMenuIdx(Math.max(0, i - 1));
        else if (e.key === 'ArrowDown') setMenuIdx(Math.min(count - 1, i + 1));
        else if (e.key === 'ArrowLeft') setMenu('none');
        else if (isOk) pickRow(i);
        return;
      }

      if (c.focus === 'timeline') {
        if (e.key === 'ArrowDown') { commitScrub(); setFocus('play'); return; }
        if (isOk) { commitScrub(); return; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const now = Date.now();
          const rep = scrubRepeat.current;
          rep.count = now - rep.at < SCRUB_REPEAT_MS ? rep.count + 1 : 0;
          rep.at = now;
          const level = Math.min(SCRUB_STEPS.length - 1, Math.floor(rep.count / 4));
          const step = SCRUB_STEPS[level] * (e.key === 'ArrowLeft' ? -1 : 1);
          const from = c.scrubPos ?? c.pos;
          const max = c.dur > 0 ? Math.max(0, c.dur - 1) : Number.MAX_SAFE_INTEGER;
          const next = Math.min(max, Math.max(0, from + step));
          c.scrubPos = next; // a second press before the re-render builds on this one
          setScrubPos(next);
          clearTimer(scrubTimer);
          scrubTimer.current = window.setTimeout(commitScrub, VOD_SCRUB_COMMIT_MS);
        }
        return;
      }

      if (e.key === 'ArrowUp') { setFocus('timeline'); return; }
      if (e.key === 'ArrowDown') return;
      const f = c.focus as VodBarId;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        setFocus(moveBarFocus(c.order, f, e.key === 'ArrowLeft' ? -1 : 1, c.disabled));
        return;
      }
      if (isOk) act(f, e.repeat);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [armHide, seekBy, commitScrub, act, setVol, showBar, pickRow]);

  // The remote's Next: the next episode (Play/Pause and skips are the player's).
  useEffect(() => {
    if (!onNext) return;
    return onMediaKey((k) => {
      const c = cur.current;
      if (k === 'next' && !c.disabled('next')) c.onNext?.();
    });
  }, [onNext]);

  // The highlighted row of a long track list stays in sight.
  const listRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (menu !== 'cc' && menu !== 'audio') return;
    const box = listRef.current;
    const row = box?.querySelector<HTMLElement>('[data-focused="true"]');
    if (box && row) keepInView(box, row);
  }, [menu, menuIdx]);

  // ── Touch screens: the same bar by finger (nothing of this on a TV) ──
  const touch = useTouchUI();
  // A tap on the picture: a popup menu closes first (like Back), then the
  // bar goes; a hidden bar comes up on Play, as OK brings it.
  const tapPicture = useCallback(() => {
    const c = cur.current;
    if (c.menu !== 'none') { setMenu('none'); armHide(); return; }
    if (c.visible) { clearTimer(scrubTimer); setScrubPos(null); setVisible(false); return; }
    showBar();
  }, [armHide, showBar]);
  usePictureTouch({
    within: '[data-vod-player]',
    // The error card's Retry answers its own tap; the bar stays down.
    enabled: !blocked,
    onTap: tapPicture,
    onChrome: armHide,
  });
  // A tap on a button: the highlight moves there and it does what OK does.
  // Greyed out: nothing. A second tap on the button of the open menu closes
  // it; any other button closes an open menu first.
  const tapControl = useCallback((id: VodBarId) => {
    const c = cur.current;
    armHide();
    if (c.disabled(id)) return;
    const ownMenu = (id === 'cc' || id === 'audio' || id === 'vol') && c.menu === id;
    setMenu('none');
    if (ownMenu) return;
    setFocus(id);
    act(id, false);
  }, [armHide, act]);
  const tapRow = useCallback((i: number) => { armHide(); setMenuIdx(i); pickRow(i); }, [armHide, pickRow]);
  // A finger on the seek bar: the marker follows it, the film jumps where it
  // lifts (the remote's scrub and its commit).
  const seekTouch = useTrackTouch(touch ? (f: number, phase: DragPhase) => {
    const c = cur.current;
    armHide();
    if (phase === 'cancel' || !(c.dur > 0)) { clearTimer(scrubTimer); setScrubPos(null); setFocus('play'); return; }
    const to = Math.min(Math.max(0, c.dur - 1), Math.max(0, f * c.dur));
    c.scrubPos = to; // commitScrub reads it before the re-render
    setScrubPos(to);
    setFocus('timeline');
    if (phase === 'end') { commitScrub(); setFocus('play'); }
  } : undefined);
  // A finger on the volume level (the whole level box takes it).
  const volTrackRef = useRef<HTMLDivElement | null>(null);
  const volTouch = useTrackTouch(touch ? (f: number) => {
    armHide();
    setVol(Math.round(f * cur.current.maxVolume * 100) / 100);
  } : undefined, volTrackRef);
  const chrome = touchChrome(touch);

  const statsEl = stats && statsOn ? <PlayerStatsPanel /> : null;

  const noteEl = seekNote && !visible ? (
    <div data-vod-seek className="absolute bottom-12 left-0 w-full flex justify-center pointer-events-none animate-fade-in">
      <span className="inline-flex items-center px-4 py-2 rounded-full bg-black/75 text-white font-quicksand font-bold text-base tabular-nums">
        {seekNote.dir < 0 ? <Rewind className="w-5 h-5 mr-2 text-brand-gold" /> : <FastForward className="w-5 h-5 mr-2 text-brand-gold" />}
        {fmtTime(seekNote.at)}{seekNote.dur > 0 ? ` / ${fmtTime(seekNote.dur)}` : ''}
      </span>
    </div>
  ) : null;

  if (!visible) return statsEl || noteEl ? <>{statsEl}{noteEl}</> : null;

  const vol = Math.round(volume * 100);
  const boost = volume > 1.0001;
  const volFill = Math.min(100, (volume / maxVolume) * 100);
  const scrubbing = focus === 'timeline';
  const shownPos = scrubbing && scrubPos != null ? scrubPos : pos;
  const pct = dur > 0 ? Math.min(100, Math.max(0, (shownPos / dur) * 100)) : 0;
  const scrubDelta = scrubbing && scrubPos != null ? Math.round(scrubPos - pos) : 0;

  const iconFor = (id: VodBarId): JSX.Element => {
    switch (id) {
      case 'rew': return <Rewind className="w-6 h-6" />;
      case 'fwd': return <FastForward className="w-6 h-6" />;
      case 'next': return <SkipForward className="w-6 h-6" />;
      case 'play': return paused ? <Play className="w-7 h-7 fill-current" /> : <Pause className="w-7 h-7 fill-current" />;
      case 'cc': return <Subtitles className="w-6 h-6" />;
      case 'audio': return <AudioLines className="w-6 h-6" />;
      case 'vol': return vol === 0 ? <VolumeX className="w-6 h-6" /> : <Volume2 className="w-6 h-6" />;
      default: return <Gauge className="w-6 h-6" />;
    }
  };

  const rows: Array<{ id: number; label: string; active: boolean }> = menu === 'cc'
    ? [{ id: -1, label: t('live.bar.subsOff'), active: subs.every((s) => !s.active) }, ...subs]
    : menu === 'audio' ? auds : [];
  const listOpen = menu === 'cc' || menu === 'audio';
  const volOpen = menu === 'vol';
  const menuBox = 'absolute right-8 bottom-40 z-30 w-72 rounded-2xl bg-black/90 border border-white/15 p-2 animate-fade-in pointer-events-auto';

  return (
    <>
      {statsEl}
      <div data-vod-bar {...chrome} className="absolute left-0 right-0 bottom-0 z-20 px-8 pt-12 pb-3 bg-gradient-to-t from-black/95 via-black/80 to-transparent animate-fade-in pointer-events-none">
        <div className="max-w-6xl mx-auto pointer-events-auto">
          {title && <p className="text-lg font-quicksand font-bold text-white truncate leading-tight mb-2">{title}</p>}
          <div
            data-vod-timeline
            data-touch-track={touch ? '' : undefined}
            {...seekTouch}
            data-focused={scrubbing ? 'true' : 'false'}
            aria-label={t('plex.player.seekBar')}
            className={`relative rounded-full ${scrubbing ? 'h-2.5 bg-white/25' : 'h-1.5 bg-white/15'}`}
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
            <span data-vod-time>
              {fmtTime(shownPos)}
              {scrubDelta !== 0 && <span className="ml-2 text-brand-gold">{scrubDelta > 0 ? '+' : '−'}{fmtTime(Math.abs(scrubDelta))}</span>}
            </span>
            <span data-vod-duration>{dur > 0 ? fmtTime(dur) : ''}</span>
          </div>
          <div className="mt-1 flex items-center justify-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-black/80 border border-white/10 px-3 py-1.5">
              {order.map((id) => (
                <BarButton
                  key={id}
                  id={id}
                  icon={iconFor(id)}
                  label={vodBarLabel(id, { isPaused: paused, statsOn, volumePct: vol })}
                  focused={focus === id}
                  open={(id === 'cc' && menu === 'cc') || (id === 'audio' && menu === 'audio') || (id === 'vol' && menu === 'vol') || (id === 'stats' && statsOn)}
                  disabled={disabled(id)}
                  onPress={touch ? () => tapControl(id) : undefined}
                />
              ))}
            </div>
          </div>
          <p className="text-center text-xs text-brand-ice/60 font-nunito mt-2">
            {scrubbing ? t('plex.player.hintScrub') : t('plex.player.hintControls')}
          </p>
        </div>
      </div>

      {listOpen && (
        <div data-vod-menu={menu} {...chrome} className={menuBox}>
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/70">{menu === 'cc' ? t('live.bar.ccLabel') : t('live.bar.audioLabel')}</p>
            <span className="text-xs text-brand-ice/60 font-nunito">{t('live.bar.menuHint')}</span>
          </div>
          {rows.length === 0 && <p className="text-sm text-brand-ice/70 font-nunito px-3 py-2">{t('plex.player.noTracks')}</p>}
          {/* Scrolls when a film carries more tracks than fit above the bar
              on the 540 px-tall screen; keepInView follows the highlight. */}
          <div ref={listRef} data-vod-menu-list className="space-y-1 overflow-y-auto p-1 -m-1" style={{ maxHeight: '48vh' }}>
            {rows.map((r, i) => (
              <div
                key={`${r.id}-${r.label}-${i}`}
                data-focused={menuIdx === i ? 'true' : 'false'}
                onClick={touch ? (e) => { e.stopPropagation(); tapRow(i); } : undefined}
                className={`tv-ring px-3 py-3 rounded-xl font-nunito text-sm flex items-center justify-between ${menuIdx === i ? 'bg-brand-gold/20 text-white scale-[1.02] z-10' : 'text-brand-ice/90'}`}
              >
                <span className="truncate">{r.label}</span>
                {r.active && <span className="text-brand-gold text-xs">●</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {volOpen && (
        <div data-vod-menu="vol" {...chrome} className={menuBox}>
          <div className="flex items-center justify-between px-2 py-1">
            <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/70 flex items-center gap-2">
              {vol === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              {t('live.bar.volLabel')}
            </p>
            <span className="text-xs text-brand-ice/60 font-nunito">{t('live.bar.volHint')}</span>
          </div>
          <div className="px-2 pb-1" {...volTouch}>
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-brand-ice/70 font-nunito">{t('live.bar.level')}</span>
              <span data-vod-vol-level className={`text-sm font-quicksand font-bold tabular-nums ${boost ? 'text-orange-300' : 'text-brand-gold'}`}>{boost ? t('live.bar.levelBoost', { pct: vol }) : `${vol}%`}</span>
            </div>
            {/* Over the player's whole range; on the native one the tick is
                100% and past it the sound is boosted. */}
            <div ref={volTrackRef} className="relative mt-2 h-2 w-full rounded-full bg-white/15 overflow-hidden">
              <div className={`h-full ${boost ? 'bg-orange-400' : 'bg-brand-gold'}`} style={{ width: `${volFill}%` }} />
              {maxVolume > 1 && <div className="absolute top-0 bottom-0 w-0.5 bg-white/70" style={{ left: `${(100 / maxVolume).toFixed(1)}%` }} />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
