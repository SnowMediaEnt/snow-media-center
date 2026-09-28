// Record a live channel (TRACKER 25): hold OK on a channel in the list, or the
// Record button in the player bar. Where to save (the box, or a USB drive when
// one is plugged in) and for how long, then Start. The recording runs in the
// background (RecordingService). A channel already recording offers Stop
// instead. "More options…" hands over to the existing channel menu (favourite,
// report).
//
// Above Start it says, plainly, that a recording is one more stream on the
// viewer's line (extraStreamNote): the same words as the start toast and the
// error when the provider refuses. Every start passes through here.
//
// D-pad: ▲▼ rows, ◀▶ along a row's choices, OK, Back closes.
// Chrome 66: margins, no flex gap beyond gap-1..4, no inset.
import { memo, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Circle, HardDrive, Info, MoreHorizontal, Square, Usb, X } from 'lucide-react';
import { SnowRecorder, type RecordVolume, type RecordingJob } from '@/capacitor/SnowRecorder';
import {
  CUSTOM_DEFAULT, RECORD_DURATIONS, endsAtLabel, extraStreamNote, formatMinutes, isLowSpace, stepCustom,
} from '@/lib/recording';
import { formatBytes } from '@/lib/liveRewind';

export interface RecordChoice {
  volumeId: string;
  /** Minutes; 0 = until stopped. */
  durationMin: number;
}

/** Said on a one-stream plan too: the picture being watched is the one stream. */
export const ONE_STREAM_WARNING = 'While it records, watching TV may stop the picture or the recording.';

interface Props {
  channelName: string;
  /** Streams the plan allows at once (null = not known); goes into the extra-stream line. */
  maxConnections?: number | null;
  /** This channel is recording right now. */
  activeJob?: RecordingJob | null;
  onStart: (choice: RecordChoice) => void;
  onStop?: (id: string) => void;
  /** The channel's other options (favourite, report…), from a held OK. */
  onMore?: () => void;
  onClose: () => void;
}

type Row = 'dest' | 'dur' | 'custom' | 'start' | 'stop' | 'more' | 'cancel';

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);

const RecordDialog = memo(({ channelName, maxConnections = null, activeJob, onStart, onStop, onMore, onClose }: Props) => {
  const [volumes, setVolumes] = useState<RecordVolume[] | null>(null);
  const [volIdx, setVolIdx] = useState(0);
  const [durIdx, setDurIdx] = useState(1); // 1 hour
  const [custom, setCustom] = useState(CUSTOM_DEFAULT);
  const [focus, setFocus] = useState(0);

  useEffect(() => {
    let alive = true;
    SnowRecorder.getVolumes()
      .then((r) => { if (alive) setVolumes(r.volumes); })
      .catch(() => { if (alive) setVolumes([]); });
    return () => { alive = false; };
  }, []);

  const dur = RECORD_DURATIONS[durIdx];
  const minutes = dur.minutes < 0 ? custom : dur.minutes;
  const rows: Row[] = activeJob
    ? ['stop', ...(onMore ? (['more'] as Row[]) : []), 'cancel']
    : ['dest', 'dur', ...(dur.minutes < 0 ? (['custom'] as Row[]) : []), 'start', ...(onMore ? (['more'] as Row[]) : []), 'cancel'];
  const focusRow = rows[Math.min(focus, rows.length - 1)];

  // Keys — the dialog owns the remote while open. OK is ignored until it is
  // released once: the dialog often opens from a held OK.
  const armedRef = useRef(false);
  const stateRef = useRef({ rows, focusRow, volumes, volIdx, durIdx, minutes });
  stateRef.current = { rows, focusRow, volumes, volIdx, durIdx, minutes };
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
        } else if (st.focusRow === 'dur') {
          setDurIdx((i) => Math.max(0, Math.min(RECORD_DURATIONS.length - 1, i + d)));
        } else if (st.focusRow === 'custom') {
          setCustom((m) => stepCustom(m, d as 1 | -1));
        }
        return;
      }
      if (!isOk) return;
      switch (st.focusRow) {
        case 'dest':
        case 'dur':
        case 'custom':
          setFocus((f) => Math.min(n - 1, f + 1));
          return;
        case 'start': {
          const v = st.volumes?.[st.volIdx];
          if (!v) return;
          onStart({ volumeId: v.id, durationMin: st.minutes });
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

  const rowCls = (r: Row) =>
    `tv-ring rounded-xl px-4 py-2 ${focusRow === r ? 'bg-brand-gold/25 z-10' : 'bg-white/5'}`;
  const chip = (selected: boolean, rowFocused: boolean) =>
    `inline-block mr-2 mb-1 px-3 py-1 rounded-lg text-base font-nunito ${
      selected ? (rowFocused ? 'bg-brand-gold text-brand-navy font-bold' : 'bg-white/25 text-white font-semibold') : 'text-brand-ice/80'}`;

  const vol = volumes?.[volIdx];
  const ends = endsAtLabel(minutes);
  const started = activeJob ? new Date(activeJob.startedAt) : null;
  const oneStream = maxConnections === 1;

  return (
    <div data-record-dialog className="fixed left-0 top-0 w-full h-full z-[90] flex items-center justify-center bg-black/75">
      <div className="rounded-2xl bg-brand-navy/95 border border-brand-gold/40 shadow-[0_0_40px_rgba(245,200,80,0.25)] px-5 py-4 text-white" style={{ width: 720, maxWidth: '94%' }}>
        <div className="flex items-center mb-2">
          <Circle className="w-5 h-5 mr-2 fill-red-500 text-red-500 flex-shrink-0" />
          <h2 className="flex-1 min-w-0 truncate text-2xl font-quicksand font-bold">
            {activeJob ? `Recording ${channelName}` : `Record ${channelName}`}
          </h2>
        </div>

        {activeJob ? (
          <p className="mb-2 text-base font-nunito text-brand-ice/80">
            Recording since {started ? `${pad2(started.getHours())}:${pad2(started.getMinutes())}` : '…'}
            {activeJob.endsAt > 0 ? `, until ${pad2(new Date(activeJob.endsAt).getHours())}:${pad2(new Date(activeJob.endsAt).getMinutes())}` : ', until you stop it'}
            {activeJob.bytes > 0 ? ` · ${formatBytes(activeJob.bytes)} so far` : ''}
          </p>
        ) : null}

        <div className="space-y-2">
          {rows.includes('dest') && (
            <div data-record-row="dest" data-focused={focusRow === 'dest' ? 'true' : 'false'} className={rowCls('dest')}>
              <p className="text-sm uppercase tracking-wide font-quicksand font-bold text-brand-gold mb-1">Save to</p>
              {volumes === null && <p className="text-base font-nunito text-brand-ice/70">Looking for drives…</p>}
              {volumes && volumes.length === 0 && (
                <p className="text-base font-nunito text-amber-300">No storage is available for recordings on this box.</p>
              )}
              {volumes && volumes.map((v, i) => (
                <span key={v.id} className={chip(i === volIdx, focusRow === 'dest')}>
                  {v.removable ? <Usb className="inline w-4 h-4 mr-1 -mt-0.5" /> : <HardDrive className="inline w-4 h-4 mr-1 -mt-0.5" />}
                  {v.label} · {formatBytes(v.freeBytes)} free
                </span>
              ))}
              {vol && isLowSpace(vol.freeBytes) && (
                <p className="mt-1 text-sm font-nunito text-amber-300 flex items-center">
                  <AlertTriangle className="w-4 h-4 mr-1 flex-shrink-0" /> Less than 2 GB free: a long recording may stop early.
                </p>
              )}
            </div>
          )}
          {rows.includes('dur') && (
            <div data-record-row="dur" data-focused={focusRow === 'dur' ? 'true' : 'false'} className={rowCls('dur')}>
              <p className="text-sm uppercase tracking-wide font-quicksand font-bold text-brand-gold mb-1">How long</p>
              {RECORD_DURATIONS.map((d, i) => (
                <span key={d.id} className={chip(i === durIdx, focusRow === 'dur')}>{d.label}</span>
              ))}
            </div>
          )}
          {rows.includes('custom') && (
            <div data-record-row="custom" data-focused={focusRow === 'custom' ? 'true' : 'false'} className={rowCls('custom')}>
              <p className="text-lg font-nunito">
                <span className="text-brand-ice/70 mr-2">Custom length</span>
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
                {oneStream ? ` ${ONE_STREAM_WARNING}` : ''}
              </p>
            </div>
          )}
          {rows.includes('start') && (
            <div data-record-row="start" data-focused={focusRow === 'start' ? 'true' : 'false'} className={`${rowCls('start')} flex items-center`}>
              <Circle className="w-5 h-5 mr-3 fill-red-500 text-red-500 flex-shrink-0" />
              <span className="text-lg font-quicksand font-bold">Start recording</span>
              <span className="ml-auto text-base font-nunito text-brand-ice/70">{ends ? `until ${ends}` : 'until you stop it'}</span>
            </div>
          )}
          {rows.includes('stop') && (
            <div data-record-row="stop" data-focused={focusRow === 'stop' ? 'true' : 'false'} className={`${rowCls('stop')} flex items-center`}>
              <Square className="w-5 h-5 mr-3 fill-current flex-shrink-0" />
              <span className="text-lg font-quicksand font-bold">Stop recording</span>
            </div>
          )}
          {rows.includes('more') && (
            <div data-record-row="more" data-focused={focusRow === 'more' ? 'true' : 'false'} className={`${rowCls('more')} flex items-center`}>
              <MoreHorizontal className="w-5 h-5 mr-3 flex-shrink-0" />
              <span className="text-lg font-nunito">More options…</span>
              <span className="ml-3 text-sm font-nunito text-brand-ice/60">favorite, report</span>
            </div>
          )}
          <div data-record-row="cancel" data-focused={focusRow === 'cancel' ? 'true' : 'false'} className={`${rowCls('cancel')} flex items-center`}>
            <X className="w-5 h-5 mr-3 flex-shrink-0" />
            <span className="text-lg font-nunito">Cancel</span>
          </div>
        </div>
        <p className="mt-2 text-xs font-nunito text-brand-ice/60">▲▼ choose · ◀▶ change · OK · Back closes. Recordings are under Live TV › Recordings.</p>
      </div>
    </div>
  );
});

RecordDialog.displayName = 'RecordDialog';
export default RecordDialog;
