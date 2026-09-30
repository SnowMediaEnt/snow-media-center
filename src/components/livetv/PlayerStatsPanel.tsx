// "Stats for nerds" for Plex playback, like the Plex app's: small cards over
// the picture saying what the player is doing right now — how the file is
// played, how far ahead it has read, how fast the server is sending, the
// decoders, restarts and memory. So "it keeps buffering" can be read off the
// screen next to what the Plex app shows for the same file.
//
// - Read from SnowPlayer.getStats() once a second, and only while mounted:
//   the player overlay mounts it while the viewer has it open, so a closed
//   panel costs nothing (no timer, no bridge calls).
// - pointer-events-none, no tabIndex, no data-focused: it never takes D-pad
//   focus from the playback controls; the overlay owns every key.
// - No aria-live: a screen reader must not read a table out every second.
// - Chrome 66 WebView: CSS grid with gap (fine there), no flex gap, no
//   aspect-ratio / inset, no backdrop-blur or shadows (low-memory mode strips
//   them anyway). Sized for the 960x540 viewport: about half the width and
//   the top half of the picture, clear of the control bar.
// - Codec names, numbers and error code names only: the plugin never sends a
//   URL, and the route is the kind of address (plexRouteLabel), never a token.
import { memo, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SnowPlayer, type PlayerStats } from '@/capacitor/SnowPlayer';
import { formatMbps } from '@/lib/bufferDiagnostics';
import { formatNumber } from '@/i18n/format';

/** How often the panel reads the player while open. */
const STATS_POLL_MS = 1000;

export interface PlayerStatsPanelProps {
  /** What the server does with the file: "Direct play of the original file",
   *  "Converting to 720p · 4 Mbps". Omitted for Live TV, which has no
   *  session in that sense — the Engine card covers it instead. */
  session?: string;
  /** The Plex server's name. */
  serverName?: string;
  /** The way to the server (plexRouteLabel): "Direct to server · https". */
  routeLabel?: string;
  /** What the video needs, kbps. */
  needKbps?: number;
  /** An HTTP status the caller knows of for this title (a conversion the
   *  server turned down), shown when the player's own stats have none. */
  httpStatus?: number | null;
  /** Player slot; the main one when left out. */
  screenId?: string;
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const clock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`;
};
const mbps = (kbps: number | null | undefined): string => (kbps != null && kbps >= 0 ? formatMbps(kbps) : '—');
const short = (kbps: number | null | undefined): string => (kbps != null && kbps >= 0 ? (kbps / 1000).toFixed(1) : '—');
const count = (n: number | null | undefined): string => (typeof n === 'number' && Number.isFinite(n) ? formatNumber(Math.round(n)) : '—');
const text = (v: string | null | undefined): string => (v && v.trim() ? v : '—');
const num = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

const engineLabel = (e: PlayerStats['engine']): string => (e === 'mpv' ? 'mpv' : 'ExoPlayer');
const stallsRow = (st: PlayerStats | null): string => {
  if (!st) return '—';
  return `${count(st.stalls)}${st.stalls > 0 ? ` (${st.stallSec.toFixed(1)} s)` : ''}`;
};
const cpuRow = (n: number | null | undefined): string => (num(n) ? `${n.toFixed(1)}%` : '—');

function engineState(st: PlayerStats, t: TFunction): string {
  if (st.state === 'ready') return st.playing ? t('plex.stats.playing') : t('plex.stats.paused');
  if (st.state === 'buffering') return t('plex.stats.buffering');
  if (st.state === 'ended') return t('plex.stats.ended');
  return t('plex.stats.idle');
}

const Card = ({ title, wide, children }: { title: string; wide?: boolean; children: ReactNode }) => (
  <div className={`min-w-0 overflow-hidden rounded-lg bg-white/5 border border-white/10 px-2 py-1.5 ${wide ? 'col-span-2' : ''}`}>
    <p className="text-[10px] uppercase tracking-wide font-quicksand font-semibold text-brand-gold leading-tight">{title}</p>
    {children}
  </div>
);

const Row = ({ label, children }: { label?: string; children: ReactNode }) => (
  <p className="mt-0.5 text-[11px] leading-snug text-white/90 tabular-nums break-words">
    {label && <span className="text-brand-ice/60">{label} </span>}
    {children}
  </p>
);

const PlayerStatsPanel = memo(({ session, serverName, routeLabel, needKbps, screenId, httpStatus }: PlayerStatsPanelProps) => {
  const { t } = useTranslation();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  // An app built before getStats existed rejects the call.
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    // One read at a time: a slow bridge must not pile calls up.
    let busy = false;
    const read = async () => {
      if (busy) return;
      busy = true;
      try {
        const st = await SnowPlayer.getStats(screenId ? { screenId } : undefined);
        if (alive) { setStats(st); setUnavailable(false); }
      } catch {
        if (alive) setUnavailable(true);
      } finally {
        busy = false;
      }
    };
    void read();
    const id = window.setInterval(() => { void read(); }, STATS_POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [screenId]);

  const st = stats;
  const frames = st && (st.renderedFrames != null || st.droppedFrames != null)
    ? t('plex.stats.framesValue', { rendered: count(st.renderedFrames), dropped: count(st.droppedFrames) })
    : '—';
  // Every figure is read defensively: an app between versions may leave one out.
  const restartCount = num(st?.restarts) ? st.restarts : 0;
  const restarts = st
    ? (restartCount > 0 && st.lastRestartReason ? t('plex.stats.restartsLast', { count: restartCount, reason: st.lastRestartReason }) : `${restartCount}`)
    : '—';
  const ahead = st && num(st.bufferedAheadSec) ? t('plex.stats.ahead', { value: st.bufferedAheadSec.toFixed(1) }) : '—';
  const at = st && num(st.positionSec) ? `${clock(st.positionSec)}${num(st.durationSec) && st.durationSec > 0 ? ` / ${clock(st.durationSec)}` : ''}` : '—';
  const memory = (mb: number | null | undefined) => (num(mb) ? `${Math.round(mb)} MB` : '—');
  // The HTTP status behind the last error ("HTTP 503"): the player's own, else
  // the one the caller kept (a fresh session's stats start over).
  const status = num(st?.httpStatus) && st.httpStatus > 0 ? st.httpStatus : (num(httpStatus) && httpStatus > 0 ? httpStatus : null);
  const http = status ? t('plex.stats.httpStatus', { code: status }) : null;
  const lastError = st?.lastError
    ? (http ? `${st.lastError} · ${http}` : st.lastError)
    : (http ?? (st ? t('plex.stats.none') : '—'));

  return (
    <div
      className="absolute top-4 left-4 z-30 w-[36rem] max-w-[60%] pointer-events-none rounded-2xl bg-black/75 border border-white/10 p-2 font-nunito"
      data-player-stats
    >
      <div className="flex items-center justify-between px-1 pb-1.5">
        <p className="text-xs uppercase tracking-wide font-quicksand font-semibold text-brand-ice/80">{t('plex.stats.title')}</p>
        <p className="text-[10px] text-brand-ice/60">{t('plex.stats.backCloses')}</p>
      </div>
      {unavailable && (
        <p className="px-1 pb-1.5 text-[11px] text-brand-ice/70 leading-snug">{t('plex.stats.unavailable')}</p>
      )}
      <div className="grid grid-cols-4 gap-1.5">
        {session != null && (
          <Card title={t('plex.stats.session')} wide>
            <Row>{session}</Row>
            <Row label={t('plex.stats.server')}>{text(serverName)}</Row>
            <Row label={t('plex.stats.route')}>{text(routeLabel)}</Row>
          </Card>
        )}
        <Card title={t('plex.stats.engine')} wide={session == null}>
          <Row>{engineLabel(st?.engine)} · {st ? engineState(st, t) : '—'}</Row>
          <Row label={t('plex.stats.buffer')}>{ahead}</Row>
          <Row label={t('plex.stats.at')}>{at}</Row>
          <Row label={t('plex.stats.firstPicture')}>{st && num(st.firstFrameMs) ? t('plex.stats.ms', { value: st.firstFrameMs }) : '—'}</Row>
          <Row label={t('plex.stats.stalls')}>{stallsRow(st)}</Row>
        </Card>
        <Card title={t('plex.stats.bandwidth')}>
          <Row label={t('plex.stats.now')}>{mbps(st?.nowKbps)}</Row>
          <Row label={t('plex.stats.average')}>{mbps(st?.avgKbps)}</Row>
          <Row>{t('plex.stats.minMax', { min: short(st?.minKbps), max: short(st?.maxKbps) })}</Row>
          {needKbps != null && needKbps > 0 && <Row label={t('plex.stats.needs')}>{formatMbps(needKbps)}</Row>}
        </Card>
        <Card title={t('plex.stats.video')}>
          <Row>{text(st?.videoDecoder)}</Row>
          <Row>{text(st?.videoFormat)}</Row>
          <Row label={t('plex.stats.frames')}>{frames}</Row>
        </Card>
        <Card title={t('plex.stats.audio')}>
          <Row>{text(st?.audioDecoder)}</Row>
          <Row>{text(st?.audioFormat)}</Row>
        </Card>
        <Card title={t('plex.stats.player')}>
          <Row label={t('plex.stats.restarts')}>{restarts}</Row>
          <Row label={t('plex.stats.lastError')}>{lastError}</Row>
          <Row label={t('plex.stats.load')}>{text(st?.loadProfile)}</Row>
        </Card>
        <Card title={t('plex.stats.memory')}>
          <Row label={t('plex.stats.cpu')}>{cpuRow(st?.cpuPct)}</Row>
          <Row label={t('plex.stats.process')}>{memory(st?.pssMb)}</Row>
          <Row label={t('plex.stats.java')}>{memory(st?.javaHeapMb)}</Row>
          <Row label={t('plex.stats.native')}>{memory(st?.nativeHeapMb)}</Row>
        </Card>
      </div>
    </div>
  );
});

PlayerStatsPanel.displayName = 'PlayerStatsPanel';
export default PlayerStatsPanel;
