import { memo, useEffect, useMemo, useState } from 'react';
import { Gauge, Check } from 'lucide-react';
import { BackButton } from '@/components/ui/BackButton';
import { SnowPlayer } from '@/capacitor/SnowPlayer';
import { usePlayerEngine, type PlayerEngine } from '@/hooks/usePlayerEngine';
import { compareEngines, type EngineCompareRow } from '@/lib/engineCompare';

interface Props {
  onBack: () => void;
}

/** Why MPV isn't offered, in plain English (EngineChoice's own reason codes). */
const REASON_LABEL: Record<string, string> = {
  'not-in-build': 'Not in this build',
  'android-too-old': 'Needs Android 8 or later',
  'init-failed': "Couldn't start on this box",
};

interface EngineChip {
  id: PlayerEngine;
  label: string;
  hint: string;
}
const CHIPS: EngineChip[] = [
  { id: 'exo', label: 'ExoPlayer (default)', hint: 'Plays every screen: Live TV, Plex, VOD, Multi-Screen, Backups.' },
  { id: 'mpv', label: 'MPV (beta)', hint: 'Live TV channels and the Live/Guide preview boxes only.' },
];

const dash = (n: number | null, digits = 0, suffix = ''): string => (n == null ? '—' : `${n.toFixed(digits)}${suffix}`);

const PlaybackScreen = memo(({ onBack }: Props) => {
  const { engine, setEngine, loaded } = usePlayerEngine();
  const [mpvAvailable, setMpvAvailable] = useState(true);
  const [mpvReason, setMpvReason] = useState<string | null>(null);
  const [rows, setRows] = useState<EngineCompareRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void SnowPlayer.getEngines()
      .then((r) => {
        if (cancelled) return;
        setMpvAvailable(r.mpv.available);
        setMpvReason(r.mpv.reason ?? null);
      })
      .catch(() => { if (!cancelled) { setMpvAvailable(false); setMpvReason('not-in-build'); } });
    setRows(compareEngines());
    return () => { cancelled = true; };
  }, []);

  // Focus: 0 = Back, 1 = ExoPlayer chip, 2 = MPV chip.
  const [focusIdx, setFocusIdx] = useState(1);
  const isDisabled = (chip: EngineChip) => chip.id === 'mpv' && !mpvAvailable;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;
      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        onBack();
        return;
      }
      const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!arrows.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();

      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        setFocusIdx((i) => Math.min(2, i + 1));
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' || e.key === ' ') {
        setFocusIdx((cur) => {
          if (cur === 0) { onBack(); return cur; }
          const chip = CHIPS[cur - 1];
          if (chip && !isDisabled(chip)) void setEngine(chip.id);
          return cur;
        });
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBack, mpvAvailable, setEngine]);

  const compareLabel = (r: EngineCompareRow) => (r.engine === 'mpv' ? 'MPV' : 'ExoPlayer');

  return (
    <div className="h-screen overflow-hidden flex flex-col text-white bg-black/70">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 bg-black/30">
        <BackButton onClick={onBack} label="Back" data-player-header-btn="" focused={focusIdx === 0} />
        <div className="flex items-center gap-2">
          <Gauge className="w-7 h-7 text-brand-gold" />
          <h1 className="text-2xl font-quicksand font-bold text-white">Playback</h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 flex items-start justify-center">
        <div className="w-full max-w-3xl space-y-6">
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-white/70">Player engine</div>
            <div className="flex flex-wrap gap-2">
              {CHIPS.map((chip, i) => {
                const flatIdx = i + 1;
                const focused = focusIdx === flatIdx;
                const selected = loaded && engine === chip.id;
                const disabled = isDisabled(chip);
                return (
                  <div
                    key={chip.id}
                    data-focused={focused ? 'true' : 'false'}
                    data-selected={selected ? 'true' : 'false'}
                    onClick={() => { setFocusIdx(flatIdx); if (!disabled) void setEngine(chip.id); }}
                    className={`tv-ring inline-flex flex-col gap-1 rounded-2xl px-4 py-3 border cursor-pointer max-w-xs ${
                      disabled ? 'opacity-50 bg-slate-900/40 border-white/10'
                        : selected ? 'bg-brand-gold/25 border-brand-gold/60' : 'bg-slate-900/60 border-white/10'
                    } ${focused ? 'scale-105 z-10' : ''}`}
                  >
                    <span className="flex items-center gap-2 text-sm font-quicksand font-bold text-white">
                      {chip.label}
                      {selected && <Check className="w-3.5 h-3.5 text-brand-gold" />}
                    </span>
                    <span className="text-xs font-nunito text-brand-ice/70">
                      {disabled && chip.id === 'mpv' ? (REASON_LABEL[mpvReason ?? ''] ?? 'Not available') : chip.hint}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs font-nunito text-brand-ice/60">
              On MPV, volume past 100% is plain gain — no boost limiter (that's an ExoPlayer-only feature for now).
            </p>
          </div>

          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-white/70">Compare</div>
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 overflow-hidden">
              <table className="w-full text-sm font-nunito">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-brand-ice/60 border-b border-white/10">
                    <th className="px-3 py-2">Engine</th>
                    <th className="px-3 py-2">First picture</th>
                    <th className="px-3 py-2">Stalls / hr</th>
                    <th className="px-3 py-2">Stall sec / hr</th>
                    <th className="px-3 py-2">CPU</th>
                    <th className="px-3 py-2">Memory</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.engine} className="border-b border-white/5 last:border-0">
                      <td className="px-3 py-2 font-quicksand font-semibold">{compareLabel(r)}</td>
                      <td className="px-3 py-2 tabular-nums">{dash(r.medianFirstPictureMs, 0, ' ms')}</td>
                      <td className="px-3 py-2 tabular-nums">{dash(r.stallsPerHour, 1)}</td>
                      <td className="px-3 py-2 tabular-nums">{dash(r.stallSecPerHour, 1, ' s')}</td>
                      <td className="px-3 py-2 tabular-nums">{dash(r.avgCpuPct, 1, '%')}</td>
                      <td className="px-3 py-2 tabular-nums">{dash(r.avgMemoryMb, 0, ' MB')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs font-nunito text-brand-ice/60">
              Built from up to the last 30 Live TV watches per engine on this box — one reading 60 s in and one when it stops.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});

PlaybackScreen.displayName = 'PlaybackScreen';
export default PlaybackScreen;
