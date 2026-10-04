import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/ui/BackButton';
import { SnowPlayer } from '@/capacitor/SnowPlayer';
import { usePlayerEngine, type PlayerEngine } from '@/hooks/usePlayerEngine';
import { compareEngines, type EngineCompareRow } from '@/lib/engineCompare';
import { loadDecodeAudioOnBox, loadMatchFrameRate, saveDecodeAudioOnBox, saveMatchFrameRate } from '@/lib/playerFlags';

interface Props {
  onBack: () => void;
}

/** Why MPV isn't offered (EngineChoice's own reason codes), as translation keys. */
const REASON_KEY: Record<string, string> = {
  'not-in-build': 'live.playback.reasonNotInBuild',
  'android-too-old': 'live.playback.reasonAndroidTooOld',
  'init-failed': 'live.playback.reasonInitFailed',
};

interface EngineChip {
  id: PlayerEngine;
  labelKey: string;
  hintKey: string;
}
const CHIPS: EngineChip[] = [
  { id: 'exo', labelKey: 'live.playback.exoLabel', hintKey: 'live.playback.exoHint' },
  { id: 'mpv', labelKey: 'live.playback.mpvLabel', hintKey: 'live.playback.mpvHint' },
];

/** On/off rows under the engine choice: the viewer's own player settings,
 *  saved on this box and sent with every load (lib/playerFlags). */
interface ToggleRow {
  id: string;
  labelKey: string;
  descKey: string;
  load: () => boolean;
  save: (on: boolean) => void;
}
const TOGGLES: ToggleRow[] = [
  { id: 'matchFrameRate', labelKey: 'live.playback.matchFrameRate', descKey: 'live.playback.matchFrameRateDesc', load: loadMatchFrameRate, save: saveMatchFrameRate },
  { id: 'decodeAudio', labelKey: 'live.playback.decodeAudio', descKey: 'live.playback.decodeAudioDesc', load: loadDecodeAudioOnBox, save: saveDecodeAudioOnBox },
];
/** Focus: 0 = Back, 1-2 = the engine chips, then one per toggle. */
const FIRST_TOGGLE = 1 + CHIPS.length;
const LAST_FOCUS = FIRST_TOGGLE + TOGGLES.length - 1;

const dash = (n: number | null, digits = 0, suffix = ''): string => (n == null ? '—' : `${n.toFixed(digits)}${suffix}`);

const PlaybackScreen = memo(({ onBack }: Props) => {
  const { t } = useTranslation();
  const { engine, setEngine, loaded } = usePlayerEngine();
  const [mpvAvailable, setMpvAvailable] = useState(true);
  const [mpvReason, setMpvReason] = useState<string | null>(null);
  const [rows, setRows] = useState<EngineCompareRow[]>([]);
  const [toggles, setToggles] = useState<Record<string, boolean>>(() => Object.fromEntries(TOGGLES.map((r) => [r.id, r.load()])));
  const flip = (row: ToggleRow) => {
    const next = !row.load();
    row.save(next);
    setToggles((cur) => ({ ...cur, [row.id]: next }));
  };

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

  // Focus: 0 = Back, 1 = ExoPlayer chip, 2 = MPV chip, 3+ = the toggles.
  const [focusIdx, setFocusIdx] = useState(1);
  const focusRef = useRef(focusIdx);
  focusRef.current = focusIdx;
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
        setFocusIdx((i) => Math.min(LAST_FOCUS, i + 1));
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        setFocusIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter' || e.key === ' ') {
        // A toggle flips once per press (outside the state updater, which
        // React may run twice).
        const row = TOGGLES[focusRef.current - FIRST_TOGGLE];
        if (row) { flip(row); return; }
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
        <BackButton onClick={onBack} label={t('common.back')} data-player-header-btn="" focused={focusIdx === 0} />
        <div className="flex items-center gap-2">
          <Gauge className="w-7 h-7 text-brand-gold" />
          <h1 className="text-2xl font-quicksand font-bold text-white">{t('live.playback.title')}</h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 flex items-start justify-center">
        <div className="w-full max-w-3xl space-y-6">
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-white/70">{t('live.playback.engineHeading')}</div>
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
                      {t(chip.labelKey)}
                      {selected && <Check className="w-3.5 h-3.5 text-brand-gold" />}
                    </span>
                    <span className="text-xs font-nunito text-brand-ice/70">
                      {disabled && chip.id === 'mpv' ? t(REASON_KEY[mpvReason ?? ''] ?? 'live.playback.notAvailable') : t(chip.hintKey)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs font-nunito text-brand-ice/60">
              {t('live.playback.mpvGainNote')}
            </p>
          </div>

          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-white/70">{t('live.playback.settingsHeading')}</div>
            {TOGGLES.map((row, i) => {
              const flatIdx = FIRST_TOGGLE + i;
              const focused = focusIdx === flatIdx;
              const on = toggles[row.id] === true;
              return (
                <div
                  key={row.id}
                  data-playback-toggle={row.id}
                  data-focused={focused ? 'true' : 'false'}
                  data-on={on ? 'true' : 'false'}
                  onClick={() => { setFocusIdx(flatIdx); flip(row); }}
                  className={`tv-ring flex items-center rounded-2xl px-4 py-3 border cursor-pointer bg-slate-900/60 border-white/10 ${focused ? 'scale-[1.02] z-10' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-quicksand font-bold text-white">{t(row.labelKey)}</p>
                    <p className="text-xs font-nunito text-brand-ice/70 mt-1">{t(row.descKey)}</p>
                  </div>
                  <span className={`ml-4 px-3 py-1 rounded-lg text-sm font-quicksand font-bold ${on ? 'bg-brand-gold text-brand-navy' : 'bg-white/10 text-white/70'}`}>
                    {on ? t('live.playback.on') : t('live.playback.off')}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-white/70">{t('live.playback.compareHeading')}</div>
            <div className="rounded-2xl border border-white/10 bg-slate-900/60 overflow-hidden">
              <table className="w-full text-sm font-nunito">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-brand-ice/60 border-b border-white/10">
                    <th className="px-3 py-2">{t('live.playback.colEngine')}</th>
                    <th className="px-3 py-2">{t('live.playback.colFirstPicture')}</th>
                    <th className="px-3 py-2">{t('live.playback.colStalls')}</th>
                    <th className="px-3 py-2">{t('live.playback.colStallSec')}</th>
                    <th className="px-3 py-2">{t('live.playback.colCpu')}</th>
                    <th className="px-3 py-2">{t('live.playback.colMemory')}</th>
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
              {t('live.playback.footnote')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});

PlaybackScreen.displayName = 'PlaybackScreen';
export default PlaybackScreen;
