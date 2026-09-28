// Live TV › Settings › Rewind & recording (TRACKER 25): on/off, how far back
// ("Max rewind"), what the buffer uses on this box, and how early a scheduled
// recording starts and how late it ends ("Start early" / "End late"). The buffer only
// exists while a channel plays full screen; it is wiped when the player is
// left, so "now" is normally nothing and the useful figure is how much the
// box would allow (Auto).
//
// Rewind on the box opens a second stream on the line while a channel is
// full screen, so it says so, and says why it does not run on a one-stream
// plan (only channels with provider catch-up rewind there).
//
// D-pad: ▲▼ rows, ◀▶ or OK changes the focused row, Back closes.
import { memo, useEffect, useRef, useState } from 'react';
import { History, Info } from 'lucide-react';
import { BackButton } from '@/components/ui/BackButton';
import { SnowPlayer } from '@/capacitor/SnowPlayer';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { bufferGate, rewindOffMessage } from '@/hooks/useLiveRewind';
import { AFTER_CHOICES, BEFORE_CHOICES, loadPadding, savePadding, type RecordPadding } from '@/lib/recordSchedule';
import { isDemo } from '@/lib/demoMode';
import {
  HARD_CAP_BYTES, MAX_REWIND_CHOICES, formatBytes, loadRewindSettings, rewindBudgetBytes, saveRewindSettings,
  type RewindSettings,
} from '@/lib/liveRewind';

interface Props { onBack: () => void }

type Row = 'back' | 'enabled' | 'max' | 'before' | 'after';
const ROWS: Row[] = ['back', 'enabled', 'max', 'before', 'after'];

/** Said under the switch: what the buffer costs the line. */
export const EXTRA_STREAM_LINE = 'Uses one extra stream on your line';

const RewindSettingsScreen = memo(({ onBack }: Props) => {
  const [s, setS] = useState<RewindSettings>(loadRewindSettings);
  const [pad, setPad] = useState<RecordPadding>(loadPadding);
  const [focus, setFocus] = useState<Row>('enabled');
  const [usage, setUsage] = useState<{ usedBytes: number; freeBytes: number; totalBytes: number } | null>(null);
  const { account } = usePlayerAccount();
  const gate = bufferGate(account?.maxConnections ?? null);
  // The demo line is fixed and plays nothing: no plan to explain.
  const plan = isDemo() || gate === 'ok' ? null : rewindOffMessage(gate === 'few' ? 'streams' : 'streams-unknown');

  useEffect(() => {
    let alive = true;
    SnowPlayer.timeshiftUsage().then((u) => { if (alive) setUsage(u); }).catch(() => { if (alive) setUsage(null); });
    return () => { alive = false; };
  }, []);

  const update = (next: RewindSettings) => { setS(next); saveRewindSettings(next); };
  const updatePad = (next: RecordPadding) => { setPad(next); savePadding(next); };
  const stateRef = useRef({ s, pad, focus });
  stateRef.current = { s, pad, focus };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      const { s: cur, pad: curPad, focus: f } = stateRef.current;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      const isOk = e.key === 'Enter' || e.key === ' ';
      if (!isBack && !isOk && !e.key.startsWith('Arrow')) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (isBack) { onBack(); return; }
      const i = ROWS.indexOf(f);
      if (e.key === 'ArrowDown') { setFocus(ROWS[Math.min(ROWS.length - 1, i + 1)]); return; }
      if (e.key === 'ArrowUp') { setFocus(ROWS[Math.max(0, i - 1)]); return; }
      if (f === 'back') { if (isOk) onBack(); return; }
      if (f === 'enabled') {
        if (isOk || e.key === 'ArrowLeft' || e.key === 'ArrowRight') update({ ...cur, enabled: !cur.enabled });
        return;
      }
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      // Start early / End late: ◀▶ along the choices, OK the next one.
      if (f === 'before' || f === 'after') {
        const list = f === 'before' ? BEFORE_CHOICES : AFTER_CHOICES;
        const cur2 = f === 'before' ? curPad.beforeMin : curPad.afterMin;
        const at2 = Math.max(0, list.indexOf(cur2));
        const to = list[isOk ? (at2 + 1) % list.length : Math.max(0, Math.min(list.length - 1, at2 + d))];
        updatePad(f === 'before' ? { ...curPad, beforeMin: to } : { ...curPad, afterMin: to });
        return;
      }
      // Max rewind: ◀▶ along the choices, OK the next one.
      const at = MAX_REWIND_CHOICES.findIndex((c) => c.id === cur.maxRewind);
      const n = MAX_REWIND_CHOICES.length;
      const next = isOk ? (at + 1) % n : Math.max(0, Math.min(n - 1, at + d));
      update({ ...cur, maxRewind: MAX_REWIND_CHOICES[next].id });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onBack]);

  // Keep the highlighted row on screen (the page scrolls at 960x540).
  useEffect(() => {
    try { document.querySelector('[data-rewind-row][data-focused="true"]')?.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
  }, [focus]);

  const budget = usage && usage.totalBytes > 0
    ? rewindBudgetBytes({ freeBytes: usage.freeBytes, totalBytes: usage.totalBytes, usedBytes: usage.usedBytes, hardCapBytes: HARD_CAP_BYTES })
    : null;

  const row = (r: Row) => `tv-ring rounded-xl px-5 py-3 bg-slate-900/70 border border-white/10 ${focus === r ? 'scale-[1.02] z-10' : ''}`;

  return (
    <div className="h-screen overflow-hidden flex flex-col text-white bg-black/70">
      <div className="flex items-center px-6 py-4 border-b border-white/10 bg-black/30">
        <BackButton onClick={onBack} label="Back" data-player-header-btn="" focused={focus === 'back'} />
        <History className="w-7 h-7 ml-3 mr-2 text-brand-gold" />
        <h1 className="text-2xl font-quicksand font-bold">Rewind &amp; recording</h1>
      </div>
      <div className="flex-1 overflow-auto p-6 flex items-start justify-center">
        <div className="w-full max-w-xl space-y-3">
          <div data-rewind-row="enabled" data-focused={focus === 'enabled' ? 'true' : 'false'} className={`${row('enabled')} flex items-center`}
            onClick={() => update({ ...s, enabled: !s.enabled })}>
            <div className="flex-1 min-w-0">
              <p className="text-xl font-quicksand font-semibold">Rewind live TV</p>
              <p className="text-sm font-nunito text-white/70 mt-1">
                Pause and go back on live channels. Channels with catch-up use the provider's archive;
                others are kept on this box while you watch, and wiped when you leave the player.
              </p>
              <p data-rewind-extra-stream className="text-sm font-nunito text-brand-gold mt-1 flex items-center">
                <Info className="w-4 h-4 mr-1 flex-shrink-0" /> {EXTRA_STREAM_LINE}
              </p>
              {plan && (
                <p data-rewind-plan className="text-sm font-nunito text-amber-300 mt-1">{plan}</p>
              )}
            </div>
            <span className={`ml-4 px-3 py-1 rounded-lg font-quicksand font-bold ${s.enabled ? 'bg-brand-gold text-brand-navy' : 'bg-white/10 text-white/70'}`}>
              {s.enabled ? 'On' : 'Off'}
            </span>
          </div>

          <div data-rewind-row="max" data-focused={focus === 'max' ? 'true' : 'false'} className={row('max')}>
            <p className="text-xl font-quicksand font-semibold">Max rewind</p>
            <div className="mt-2">
              {MAX_REWIND_CHOICES.map((c) => (
                <span
                  key={String(c.id)}
                  onClick={() => update({ ...s, maxRewind: c.id })}
                  className={`inline-block mr-2 px-3 py-1 rounded-lg font-nunito text-base ${
                    s.maxRewind === c.id ? (focus === 'max' ? 'bg-brand-gold text-brand-navy font-bold' : 'bg-white/25 font-semibold') : 'text-brand-ice/80'}`}
                >
                  {c.label}
                </span>
              ))}
            </div>
            <p className="text-sm font-nunito text-white/70 mt-2">
              Auto keeps as much as the box can spare: at least 1 GB (or 15% of the storage) always stays free,
              and never more than {formatBytes(HARD_CAP_BYTES)}.
            </p>
          </div>

          {(['before', 'after'] as const).map((r) => {
            const list = r === 'before' ? BEFORE_CHOICES : AFTER_CHOICES;
            const value = r === 'before' ? pad.beforeMin : pad.afterMin;
            return (
              <div key={r} data-rewind-row={r} data-focused={focus === r ? 'true' : 'false'} className={row(r)}>
                <p className="text-xl font-quicksand font-semibold">{r === 'before' ? 'Start early' : 'End late'}</p>
                <div className="mt-2">
                  {list.map((n) => (
                    <span
                      key={n}
                      onClick={() => updatePad(r === 'before' ? { ...pad, beforeMin: n } : { ...pad, afterMin: n })}
                      className={`inline-block mr-2 px-3 py-1 rounded-lg font-nunito text-base ${
                        value === n ? (focus === r ? 'bg-brand-gold text-brand-navy font-bold' : 'bg-white/25 font-semibold') : 'text-brand-ice/80'}`}
                    >
                      {n} min
                    </span>
                  ))}
                </div>
                <p className="text-sm font-nunito text-white/70 mt-2">
                  {r === 'before'
                    ? 'A recording scheduled from the Guide starts this long before the programme.'
                    : 'It keeps recording this long after the programme ends. A schedule keeps the times it was made with.'}
                </p>
              </div>
            );
          })}

          <div className="rounded-xl px-5 py-3 bg-black/30 border border-white/10">
            <p className="text-base font-quicksand font-semibold">On this box</p>
            <p className="text-sm font-nunito text-white/70 mt-1">
              {usage
                ? <>Rewind buffer now: {formatBytes(usage.usedBytes)} · Free: {formatBytes(usage.freeBytes)}
                  {budget != null ? <> · Auto could use up to {formatBytes(budget)}</> : null}</>
                : 'Figures show in the app on your TV box.'}
            </p>
            {budget != null && budget < 256 * 1024 * 1024 && (
              <p className="text-sm font-nunito text-amber-300 mt-1">
                This box is nearly full: rewind on channels without catch-up won't have room.
              </p>
            )}
            <p className="text-sm font-nunito text-white/60 mt-1">Recordings are separate (Live TV › Recordings) and are never wiped by rewind.</p>
          </div>
        </div>
      </div>
    </div>
  );
});

RewindSettingsScreen.displayName = 'RewindSettingsScreen';
export default RewindSettingsScreen;
