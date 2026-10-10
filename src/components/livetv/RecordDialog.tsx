// Record a live channel (TRACKER 25): "Record…" in the channel's short menu
// (held OK on a channel in the list), or the Record button in the player bar.
// Where to save (the box, or a USB drive when one is plugged in) and for how
// long, then Start. The recording runs in the background (RecordingService).
// A channel already recording offers Stop instead. "More options…" (onMore)
// is optional and Live TV no longer uses it: the menu comes first now.
//
// Above Start it says, plainly, that a recording is one more stream on the
// viewer's line (extraStreamNote): the same words as the start toast and the
// error when the provider refuses. Every start passes through here.
//
// Two more things (scheduled recordings, TRACKER 25.12 / 25.13):
// - Live TV: when the programme on now is known, the length row gets a first
//   chip "This programme (until 21:05)" (its end plus the "End late" padding).
// - Programme mode (the Guide's held OK): a "What" row lists up to six
//   programmes of the channel; the button says "Record this programme" with
//   the padded times. One on now records at once; a later one is scheduled.
//   The dialog also shows a space warning and, before anything is set, the
//   conflict message when more recordings than the plan allows would overlap.
//
// D-pad: ▲▼ rows, ◀▶ along a row's choices, OK, Back closes.
// Chrome 66: margins, no flex gap beyond gap-1..4, no inset.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Circle, HardDrive, Info, MoreHorizontal, Square, Usb, X } from 'lucide-react';
import { SnowRecorder, type RecordVolume, type RecordingJob } from '@/capacitor/SnowRecorder';
import {
  CUSTOM_DEFAULT, RECORD_DURATIONS, endsAtLabel, extraStreamNote, formatMinutes, isLowSpace, stepCustom,
} from '@/lib/recording';
import { formatBytes } from '@/lib/liveRewind';
import { useTranslation } from 'react-i18next';
import { useTouchUI } from '@/lib/phoneMode';
import {
  clockLabel, conflictMessage, loadPadding, minutesUntil, paddedLabel, paddedWindow, programmeMode, recordFloorBytes,
  recordingCap, scheduleConflict, spaceWarning, type ProgrammeChoice, type RecordPadding, type SchedLike,
} from '@/lib/recordSchedule';

export interface RecordChoice {
  volumeId: string;
  /** Minutes; 0 = until stopped. In programme mode: the length of the padded window from now (or its start). */
  durationMin: number;
  /** Programme mode: the programme chosen (UTC ms). */
  programme?: ProgrammeChoice;
}

/**
 * Said on a one-stream plan too: the picture being watched is the one stream. This is the English
 * text (the tests compare against it); the dialog shows i18n 'recordings.dialog.oneStream'.
 */
export const ONE_STREAM_WARNING = 'While it records, watching TV may stop the picture or the recording.';

interface Props {
  channelName: string;
  /** Streams the plan allows at once (null = not known); goes into the extra-stream line. */
  maxConnections?: number | null;
  /** Live TV: the programme on now (true UTC end), for the "This programme" length chip. */
  programme?: { title: string; endMs: number } | null;
  /** The viewer's "Start early" / "End late" (read from settings when not given). */
  padding?: RecordPadding;
  /** Programme mode (the Guide): the channel's programmes to pick from. */
  programmes?: ProgrammeChoice[];
  /** Programme mode: the channel's id and the recordings already set or running, to check the plan's limit. */
  streamId?: number;
  existing?: SchedLike[];
  /** This channel is recording right now. */
  activeJob?: RecordingJob | null;
  onStart: (choice: RecordChoice) => void;
  onStop?: (id: string) => void;
  /** The channel's other options (favourite, report…), from a held OK. */
  onMore?: () => void;
  /** Opened by a key other than OK (the Guide's Menu key): OK acts at once,
   *  with no held OK's release to wait for. */
  armed?: boolean;
  onClose: () => void;
}

type Row = 'what' | 'dest' | 'dur' | 'custom' | 'start' | 'stop' | 'more' | 'cancel';

// Message keys for the length chips (RECORD_DURATIONS keeps the English names as a fallback).
const DUR_KEYS: Record<string, string> = {
  '30': 'min30', '60': 'hour1', '120': 'hour2', '180': 'hour3', custom: 'custom', open: 'open',
};

const RecordDialog = memo(({
  channelName, maxConnections = null, programme = null, padding, programmes, streamId = 0, existing, activeJob,
  onStart, onStop, onMore, armed = false, onClose,
}: Props) => {
  const { t } = useTranslation();
  const progMode = !!programmes && !activeJob;
  const [volumes, setVolumes] = useState<RecordVolume[] | null>(null);
  const [volIdx, setVolIdx] = useState(0);
  const [now] = useState(() => Date.now());
  const pad = useMemo(() => padding ?? loadPadding(), [padding]);
  // Live TV: a first chip for the programme on now, running to its end plus the late padding.
  const untilMs = programme && programme.endMs > now ? programme.endMs + pad.afterMin * 60_000 : 0;
  const durations = useMemo(
    () => (untilMs
      ? [{ id: 'programme', label: '', minutes: minutesUntil(untilMs, now) }, ...RECORD_DURATIONS]
      : RECORD_DURATIONS),
    [untilMs, now],
  );
  // The chosen length is kept by name: the programme chip can arrive after the dialog opens and shift the others along.
  const [durId, setDurId] = useState('60'); // 1 hour
  const durIdx = Math.max(0, durations.findIndex((d) => d.id === durId));
  const [custom, setCustom] = useState(CUSTOM_DEFAULT);
  const [progIdx, setProgIdx] = useState(0);
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    let alive = true;
    SnowRecorder.getVolumes()
      .then((r) => { if (alive) setVolumes(r.volumes); })
      .catch(() => { if (alive) setVolumes([]); });
    return () => { alive = false; };
  }, []);

  const dur = durations[durIdx];
  // Programme mode: the chosen programme, its padded window, and what setting it would do.
  const prog = progMode ? programmes![Math.min(progIdx, programmes!.length - 1)] ?? null : null;
  const win = prog ? paddedWindow({ startUtcMs: prog.startMs, endUtcMs: prog.endMs, padBeforeMin: pad.beforeMin, padAfterMin: pad.afterMin }) : null;
  const mode = prog ? programmeMode(prog, pad, now) : null;
  const progMinutes = win ? minutesUntil(win.endMs, Math.max(now, win.startMs)) : 0;
  const minutes = progMode ? progMinutes : dur.minutes < 0 ? custom : dur.minutes;
  const rows: Row[] = activeJob
    ? ['stop', ...(onMore ? (['more'] as Row[]) : []), 'cancel']
    : progMode
      ? ['what', 'dest', 'start', 'cancel']
      : ['dest', 'dur', ...(dur.minutes < 0 ? (['custom'] as Row[]) : []), 'start', ...(onMore ? (['more'] as Row[]) : []), 'cancel'];
  const focusRow = rows[Math.min(focus, rows.length - 1)];
  const vol = volumes?.[volIdx];
  const conflict = prog && win && mode !== 'over'
    ? scheduleConflict(
      existing ?? [],
      { id: 'candidate', streamId, startUtcMs: prog.startMs, endUtcMs: prog.endMs, padBeforeMin: mode === 'now' ? 0 : pad.beforeMin, padAfterMin: pad.afterMin },
      recordingCap(maxConnections),
    )
    : null;
  const space = prog && vol ? spaceWarning(progMinutes, vol.freeBytes, recordFloorBytes(vol.removable)) : null;
  const isOver = mode === 'over';
  const canStart = !!vol && (!progMode || (!!prog && mode !== 'over' && !conflict));

  // Keys — the dialog owns the remote while open. OK is ignored until it is
  // released once: the dialog often opens from a held OK (not when `armed`).
  const armedRef = useRef(!!armed);
  const stateRef = useRef({ rows, focusRow, volumes, volIdx, durIdx, durations, minutes, progCount: programmes?.length ?? 0, prog, canStart });
  stateRef.current = { rows, focusRow, volumes, volIdx, durIdx, durations, minutes, progCount: programmes?.length ?? 0, prog, canStart };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = stateRef.current;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      const isOk = e.key === 'Enter' || e.key === ' ';
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (isBack) {
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
        onClose();
        return;
      }
      if (isOk && (e.repeat || !armedRef.current)) return;
      const n = st.rows.length;
      if (e.key === 'ArrowDown') { setFocus((f) => Math.min(n - 1, f + 1)); return; }
      if (e.key === 'ArrowUp') { setFocus((f) => Math.max(0, f - 1)); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const d = e.key === 'ArrowRight' ? 1 : -1;
        if (st.focusRow === 'dest' && st.volumes && st.volumes.length > 0) {
          setVolIdx((i) => Math.max(0, Math.min(st.volumes!.length - 1, i + d)));
        } else if (st.focusRow === 'what') {
          setProgIdx((i) => Math.max(0, Math.min(st.progCount - 1, i + d)));
        } else if (st.focusRow === 'dur') {
          const at = Math.max(0, Math.min(st.durations.length - 1, st.durIdx + d));
          setDurId(st.durations[at].id);
        } else if (st.focusRow === 'custom') {
          setCustom((m) => stepCustom(m, d as 1 | -1));
        }
        return;
      }
      if (!isOk) return;
      switch (st.focusRow) {
        case 'what':
        case 'dest':
        case 'dur':
        case 'custom':
          setFocus((f) => Math.min(n - 1, f + 1));
          return;
        case 'start': {
          const v = st.volumes?.[st.volIdx];
          if (!v || !st.canStart) return;
          onStart({ volumeId: v.id, durationMin: st.minutes, ...(st.prog ? { programme: st.prog } : {}) });
          return;
        }
        case 'stop':
          if (activeJob) onStop?.(activeJob.id);
          return;
        case 'more':
          onMore?.();
          return;
        case 'cancel':
          onClose();
          return;
        default:
      }
    };
    const onUp = () => { armedRef.current = true; };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, [onClose, onStart, onStop, onMore, activeJob]);

  // A touch screen (Tronix 464aea5): every row and choice takes a tap; the
  // custom length steps with a tap on its left or right half.
  const touch = useTouchUI();
  const onTap = touch ? (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    const rowEl = el.closest<HTMLElement>('[data-record-row]');
    const r = rowEl?.dataset.recordRow as Row | undefined;
    if (!rowEl || !r) return;
    const st = stateRef.current;
    const at = st.rows.indexOf(r);
    if (at >= 0) setFocus(at);
    const progEl = el.closest<HTMLElement>('[data-record-programme]');
    const chipEl = el.closest<HTMLElement>('[data-record-chip]');
    if (r === 'what' && progEl) setProgIdx(Number(progEl.dataset.recordProgramme) || 0);
    else if (r === 'dest' && chipEl) setVolIdx(Number(chipEl.dataset.recordChip) || 0);
    else if (r === 'dur' && chipEl) { const d = st.durations[Number(chipEl.dataset.recordChip) || 0]; if (d) setDurId(d.id); }
    else if (r === 'custom') { const b = rowEl.getBoundingClientRect(); setCustom((m) => stepCustom(m, e.clientX < b.left + b.width / 2 ? -1 : 1)); }
    else if (r === 'start') { const v = st.volumes?.[st.volIdx]; if (v && st.canStart) onStart({ volumeId: v.id, durationMin: st.minutes, ...(st.prog ? { programme: st.prog } : {}) }); }
    else if (r === 'stop') { if (activeJob) onStop?.(activeJob.id); }
    else if (r === 'more') onMore?.();
    else if (r === 'cancel') onClose();
  } : undefined;

  const rowCls = (r: Row) =>
    `tv-ring rounded-xl px-4 py-2 ${focusRow === r ? 'bg-brand-gold/25 z-10' : 'bg-white/5'}`;
  const chip = (selected: boolean, rowFocused: boolean) =>
    `inline-block mr-2 mb-1 px-3 py-1 rounded-lg text-base font-nunito ${
      selected ? (rowFocused ? 'bg-brand-gold text-brand-navy font-bold' : 'bg-white/25 text-white font-semibold') : 'text-brand-ice/80'}`;

  const ends = dur.id === 'programme' ? clockLabel(untilMs) : endsAtLabel(minutes);
  const durLabel = (d: { id: string; label: string }) => (d.id === 'programme'
    ? t('recordings.dialog.duration.programme', { time: clockLabel(untilMs) })
    : t(`recordings.dialog.duration.${DUR_KEYS[d.id] ?? 'custom'}`, { defaultValue: d.label }));
  const started = activeJob ? new Date(activeJob.startedAt) : null;
  const oneStream = maxConnections === 1;

  return (
    <div data-record-dialog className="fixed left-0 top-0 w-full h-full z-[90] flex items-center justify-center bg-black/75">
      <div className="rounded-2xl bg-brand-navy/95 border border-brand-gold/40 shadow-[0_0_40px_rgba(245,200,80,0.25)] px-5 py-4 text-white" style={{ width: 720, maxWidth: '94%' }}>
        <div className="flex items-center mb-2">
          <Circle className="w-5 h-5 mr-2 fill-red-500 text-red-500 flex-shrink-0" />
          <h2 className="flex-1 min-w-0 truncate text-2xl font-quicksand font-bold">
            {activeJob ? t('recordings.dialog.titleActive', { channel: channelName }) : progMode ? t('recordings.dialog.titleProgramme', { channel: channelName }) : t('recordings.dialog.title', { channel: channelName })}
          </h2>
        </div>

        {activeJob ? (
          <p className="mb-2 text-base font-nunito text-brand-ice/80">
            {t(
              activeJob.endsAt > 0
                ? (activeJob.bytes > 0 ? 'recordings.dialog.runningUntilSize' : 'recordings.dialog.runningUntil')
                : (activeJob.bytes > 0 ? 'recordings.dialog.runningOpenSize' : 'recordings.dialog.runningOpen'),
              { since: started ? clockLabel(started.getTime()) : '…', until: activeJob.endsAt > 0 ? clockLabel(activeJob.endsAt) : '', size: formatBytes(activeJob.bytes) },
            )}
          </p>
        ) : null}

        <div className="space-y-2" onClick={onTap}>
          {rows.includes('what') && (
            <div data-record-row="what" data-howto="rec.programmes" data-focused={focusRow === 'what' ? 'true' : 'false'} className={rowCls('what')}>
              <p className="text-sm uppercase tracking-wide font-quicksand font-bold text-brand-gold mb-1">{t('recordings.dialog.what')}</p>
              {programmes!.length === 0 && (
                <p className="text-base font-nunito text-amber-300">{t('recordings.dialog.noListings')}</p>
              )}
              {programmes!.map((p, i) => {
                const picked = i === Math.min(progIdx, programmes!.length - 1);
                return (
                  <p
                    key={`${p.startMs}-${i}`}
                    data-record-programme={i}
                    data-picked={picked ? 'true' : 'false'}
                    className={`flex items-center rounded-md px-2 text-base leading-snug font-nunito truncate ${
                      picked ? (focusRow === 'what' ? 'bg-brand-gold text-brand-navy font-bold' : 'bg-white/25 text-white font-semibold') : 'text-brand-ice/80'}`}
                  >
                    <span className="tabular-nums mr-3 flex-shrink-0">{clockLabel(p.startMs)}–{clockLabel(p.endMs)}</span>
                    <span className="truncate">{p.title}</span>
                    {p.scheduled && <Circle className="ml-auto w-3 h-3 flex-shrink-0 fill-red-500 text-red-500" aria-label={t('recordings.dialog.alreadyScheduled')} />}
                  </p>
                );
              })}
            </div>
          )}
          {rows.includes('dest') && (
            <div data-record-row="dest" data-howto="rec.saveTo" data-focused={focusRow === 'dest' ? 'true' : 'false'} className={rowCls('dest')}>
              <p className="text-sm uppercase tracking-wide font-quicksand font-bold text-brand-gold mb-1">{t('recordings.dialog.saveTo')}</p>
              {volumes === null && <p className="text-base font-nunito text-brand-ice/70">{t('recordings.dialog.lookingForDrives')}</p>}
              {volumes && volumes.length === 0 && (
                <p className="text-base font-nunito text-amber-300">{t('recordings.dialog.noStorage')}</p>
              )}
              {volumes && volumes.map((v, i) => (
                <span key={v.id} data-record-chip={i} className={chip(i === volIdx, focusRow === 'dest')}>
                  {v.removable ? <Usb className="inline w-4 h-4 mr-1 -mt-0.5" /> : <HardDrive className="inline w-4 h-4 mr-1 -mt-0.5" />}
                  {t('recordings.dialog.volumeFree', { label: v.label, size: formatBytes(v.freeBytes) })}
                </span>
              ))}
              {vol && isLowSpace(vol.freeBytes) && (
                <p className="mt-1 text-sm font-nunito text-amber-300 flex items-center">
                  <AlertTriangle className="w-4 h-4 mr-1 flex-shrink-0" /> {t('recordings.dialog.lowSpace')}
                </p>
              )}
            </div>
          )}
          {rows.includes('dur') && (
            <div data-record-row="dur" data-howto="rec.length" data-focused={focusRow === 'dur' ? 'true' : 'false'} className={rowCls('dur')}>
              <p className="text-sm uppercase tracking-wide font-quicksand font-bold text-brand-gold mb-1">{t('recordings.dialog.howLong')}</p>
              {durations.map((d, i) => (
                <span key={d.id} data-record-chip={i} className={chip(i === durIdx, focusRow === 'dur')}>{durLabel(d)}</span>
              ))}
            </div>
          )}
          {rows.includes('custom') && (
            <div data-record-row="custom" data-focused={focusRow === 'custom' ? 'true' : 'false'} className={rowCls('custom')}>
              <p className="text-lg font-nunito">
                <span className="text-brand-ice/70 mr-2">{t('recordings.dialog.customLength')}</span>
                <span className="font-quicksand font-bold tabular-nums">◀ {formatMinutes(custom)} ▶</span>
              </p>
            </div>
          )}
          {/* Above Start, so every start has been read past it. */}
          {!activeJob && (
            <div data-record-note className="flex items-start px-1">
              <Info className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0 text-brand-gold" />
              <p className="text-sm font-nunito text-brand-ice/90">
                {extraStreamNote(maxConnections)}
                {oneStream ? ` ${t('recordings.dialog.oneStream')}` : ''}
              </p>
            </div>
          )}
          {progMode && (conflict || space || isOver) && (
            <div className="px-1">
              {isOver && (
                <p data-record-over className="text-sm font-nunito text-amber-300 flex items-center">
                  <AlertTriangle className="w-4 h-4 mr-1 flex-shrink-0" /> {t('recordings.dialog.finished')}
                </p>
              )}
              {conflict && (
                <p data-record-conflict className="text-sm font-nunito text-amber-300 flex items-center">
                  <AlertTriangle className="w-4 h-4 mr-1 flex-shrink-0" /> {conflictMessage(conflict)}
                </p>
              )}
              {space && !conflict && (
                <p data-record-space className="text-sm font-nunito text-amber-300 flex items-center">
                  <AlertTriangle className="w-4 h-4 mr-1 flex-shrink-0" /> {space}
                </p>
              )}
            </div>
          )}
          {rows.includes('start') && (
            <div
              data-record-row="start"
              data-howto="rec.start"
              data-focused={focusRow === 'start' ? 'true' : 'false'}
              data-disabled={canStart ? 'false' : 'true'}
              className={`${rowCls('start')} flex items-center ${canStart ? '' : 'opacity-50'}`}
            >
              <Circle className="w-5 h-5 mr-3 fill-red-500 text-red-500 flex-shrink-0" />
              <span className="text-lg font-quicksand font-bold">{progMode ? t('recordings.dialog.recordProgrammeAction') : t('recordings.dialog.startAction')}</span>
              <span className="ml-auto text-base font-nunito tabular-nums text-brand-ice/70">
                {progMode
                  ? (win ? (mode === 'now' ? t('recordings.dialog.nowUntil', { time: clockLabel(win.endMs) }) : paddedLabel(win.startMs, win.endMs)) : '')
                  : ends ? t('recordings.dialog.untilTime', { time: ends }) : t('recordings.dialog.untilStop')}
              </span>
            </div>
          )}
          {rows.includes('stop') && (
            <div data-record-row="stop" data-focused={focusRow === 'stop' ? 'true' : 'false'} className={`${rowCls('stop')} flex items-center`}>
              <Square className="w-5 h-5 mr-3 fill-current flex-shrink-0" />
              <span className="text-lg font-quicksand font-bold">{t('recordings.dialog.stopAction')}</span>
            </div>
          )}
          {rows.includes('more') && (
            <div data-record-row="more" data-focused={focusRow === 'more' ? 'true' : 'false'} className={`${rowCls('more')} flex items-center`}>
              <MoreHorizontal className="w-5 h-5 mr-3 flex-shrink-0" />
              <span className="text-lg font-nunito">{t('recordings.dialog.moreAction')}</span>
              <span className="ml-3 text-sm font-nunito text-brand-ice/60">{t('recordings.dialog.moreHint')}</span>
            </div>
          )}
          <div data-record-row="cancel" data-focused={focusRow === 'cancel' ? 'true' : 'false'} className={`${rowCls('cancel')} flex items-center`}>
            <X className="w-5 h-5 mr-3 flex-shrink-0" />
            <span className="text-lg font-nunito">{t('common.cancel')}</span>
          </div>
        </div>
        <p data-remote-hint="" className="mt-2 text-xs font-nunito text-brand-ice/60">{t('recordings.dialog.hint')}</p>
      </div>
    </div>
  );
});

RecordDialog.displayName = 'RecordDialog';
export default RecordDialog;
