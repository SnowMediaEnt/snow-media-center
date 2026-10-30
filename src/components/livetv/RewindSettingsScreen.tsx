// Live TV › Settings › Recording & Rewind (TRACKER 25): on/off, how far back
// ("Max rewind"), what the buffer uses on this box, and how early a scheduled
// recording starts and how late it ends ("Start early" / "End late"). The buffer only
// exists while a channel plays full screen; it is wiped when the player is
// left, so "now" is normally nothing and the useful figure is how much the
// box would allow (Auto).
//
// Rewind on the box opens a second stream on the line while a channel is
// full screen, so it says so: it turns on only when the line has a free stream
// and turns itself off if another TV needs it. It also says why it does not
// run on a one-stream plan (only channels with provider catch-up rewind there).
//
// "Recordings on a computer" (the last row) opens NetworkFolderScreen in this
// page's place: the shared folder on a computer or NAS recordings can go to.
// Back there comes back here, so one Back is one step.
//
// Laid out to be read at a glance (owner, 2026-10-23: "clunky"): two groups,
// Rewind and Recording, one line per setting (its name, and its value or
// choices beside it), and the highlighted row's explanation in a box under
// the list, which stays put while the rows move (it used to be a tall card
// per setting, two screens of them).
//
// D-pad: ▲▼ rows, ◀▶ or OK changes the focused row, Back closes.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, History, Info, Monitor } from 'lucide-react';
import { BackButton } from '@/components/ui/BackButton';
import { SnowPlayer } from '@/capacitor/SnowPlayer';
import { SnowRecorder, hasRecorder, type NetworkFolder } from '@/capacitor/SnowRecorder';
import NetworkFolderScreen from './NetworkFolderScreen';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { bufferGate } from '@/hooks/useLiveRewind';
import { AFTER_CHOICES, BEFORE_CHOICES, loadPadding, savePadding, type RecordPadding } from '@/lib/recordSchedule';
import { isDemo } from '@/lib/demoMode';
import { useTranslation } from 'react-i18next';
import {
  HARD_CAP_BYTES, MAX_REWIND_CHOICES, formatBytes, loadRewindSettings, rewindBudgetBytes, rewindOffMessage, saveRewindSettings,
  type RewindSettings,
} from '@/lib/liveRewind';

interface Props {
  onBack: () => void;
  /** Drawn beside the Settings menu: no header of its own, Back returns to the menu
   *  (Left / Right change this page's values, so they stay here). */
  embedded?: boolean;
  /** Embedded only: whether the remote is on this page (false while it is on the menu). */
  active?: boolean;
}

type Row = 'back' | 'enabled' | 'max' | 'before' | 'after' | 'net';
const ROWS: Row[] = ['back', 'enabled', 'max', 'before', 'after'];
const ROWS_NET: Row[] = [...ROWS, 'net'];

/**
 * Said under the switch: what the buffer costs the line. This is the English text (the tests compare
 * against it); the screen shows i18n 'recordings.rewind.extraStream'.
 */
export const EXTRA_STREAM_LINE = 'Uses one extra stream. It turns on only when your line has a free stream, and turns off by itself if another TV needs it.';

const RewindSettingsScreen = memo(({ onBack, embedded = false, active = true }: Props) => {
  const { t } = useTranslation();
  const [s, setS] = useState<RewindSettings>(loadRewindSettings);
  const [pad, setPad] = useState<RecordPadding>(loadPadding);
  const [focus, setFocus] = useState<Row>('enabled');
  const [usage, setUsage] = useState<{ usedBytes: number; freeBytes: number; totalBytes: number } | null>(null);
  const { account } = usePlayerAccount();
  const gate = bufferGate(account?.maxConnections ?? null);
  // The demo line is fixed and plays nothing: no plan to explain.
  const plan = isDemo() || gate === 'ok' ? null : rewindOffMessage(gate === 'few' ? 'streams' : 'streams-unknown');
  // Recordings on a computer: only where recording is (the app on a box, not
  // the demo). 'off' also when the app's native side can't say (an older build).
  const [net, setNet] = useState<'off' | 'loading' | NetworkFolder>(() => (hasRecorder() && !isDemo() ? 'loading' : 'off'));
  const [netOpen, setNetOpen] = useState(false);
  const loadNet = useCallback(() => {
    SnowRecorder.getNetworkFolder().then((nf) => setNet(nf)).catch(() => setNet('off'));
  }, []);
  useEffect(() => { if (net === 'loading') loadNet(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const netShown = net !== 'off';
  const rows = netShown ? ROWS_NET : ROWS;
  // Back from the computer's page: this page again, on its row, with what it saved.
  const closeNet = useCallback(() => { setNetOpen(false); setFocus('net'); loadNet(); }, [loadNet]);

  useEffect(() => {
    let alive = true;
    SnowPlayer.timeshiftUsage().then((u) => { if (alive) setUsage(u); }).catch(() => { if (alive) setUsage(null); });
    return () => { alive = false; };
  }, []);

  const update = (next: RewindSettings) => { setS(next); saveRewindSettings(next); };
  const updatePad = (next: RecordPadding) => { setPad(next); savePadding(next); };
  const stateRef = useRef({ s, pad, focus, rows });
  stateRef.current = { s, pad, focus, rows };
  useEffect(() => {
    if (netOpen) return; // the computer's page has the remote
    const onKey = (e: KeyboardEvent) => {
      if (embedded && !active) return; // the remote is on the Settings menu
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      const { s: cur, pad: curPad, focus: f, rows: list } = stateRef.current;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      const isOk = e.key === 'Enter' || e.key === ' ';
      if (!isBack && !isOk && !e.key.startsWith('Arrow')) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (isBack) { onBack(); return; }
      const i = list.indexOf(f);
      if (e.key === 'ArrowDown') { setFocus(list[Math.min(list.length - 1, i + 1)]); return; }
      // Embedded there is no Back button above the first row.
      if (e.key === 'ArrowUp') { setFocus(list[Math.max(embedded ? 1 : 0, i - 1)]); return; }
      if (f === 'back') { if (isOk) onBack(); return; }
      if (f === 'net') {
        // A page of its own: OK or Right opens it; Left beside the menu goes back to the menu.
        if (embedded && e.key === 'ArrowLeft') { onBack(); return; }
        if (isOk || e.key === 'ArrowRight') setNetOpen(true);
        return;
      }
      if (f === 'enabled') {
        // Beside the Settings menu, Left here goes back to it (as on every
        // other page); OK and Right still switch Rewind on and off.
        if (embedded && e.key === 'ArrowLeft') { onBack(); return; }
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
  }, [onBack, embedded, active, netOpen]);

  // Keep the highlighted row on screen (the page scrolls at 960x540).
  useEffect(() => {
    try { document.querySelector('[data-rewind-row][data-focused="true"]')?.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ }
  }, [focus]);

  const budget = usage && usage.totalBytes > 0
    ? rewindBudgetBytes({ freeBytes: usage.freeBytes, totalBytes: usage.totalBytes, usedBytes: usage.usedBytes, hardCapBytes: HARD_CAP_BYTES })
    : null;

  // One line per setting: its name, and beside it its value or its choices.
  const row = (r: Row, extra = '') =>
    `tv-ring flex items-center rounded-xl px-4 py-2 bg-slate-900/70 border border-white/10 cursor-pointer ${focus === r ? 'scale-[1.02] z-10' : ''} ${extra}`;
  const name = 'flex-1 min-w-0 text-base leading-6 font-quicksand font-semibold';
  const heading = 'text-sm font-quicksand font-semibold uppercase tracking-wide text-brand-ice/70 mb-1.5';
  /** A choice beside a row's name: the saved one filled in (gold while the row has the remote). */
  const chip = (selected: boolean, r: Row) => `inline-block ml-1 px-2.5 py-0.5 rounded-lg font-nunito text-sm leading-5 whitespace-nowrap ${
    selected ? (focus === r ? 'bg-brand-gold text-brand-navy font-bold' : 'bg-white/25 font-semibold') : 'text-brand-ice/75'}`;
  const note = 'text-[13px] leading-[18px] font-nunito';
  /** Start early / End late: the row, its choices. */
  const padRow = (r: 'before' | 'after') => {
    const list = r === 'before' ? BEFORE_CHOICES : AFTER_CHOICES;
    const value = r === 'before' ? pad.beforeMin : pad.afterMin;
    return (
      <div key={r} data-rewind-row={r} data-focused={focus === r ? 'true' : 'false'} className={row(r)} onClick={() => setFocus(r)}>
        <p className={name}>{r === 'before' ? t('recordings.rewindSettings.startEarly') : t('recordings.rewindSettings.endLate')}</p>
        <div className="ml-3 flex-shrink-0 whitespace-nowrap">
          {list.map((n) => (
            <span
              key={n}
              onClick={(e) => { e.stopPropagation(); setFocus(r); updatePad(r === 'before' ? { ...pad, beforeMin: n } : { ...pad, afterMin: n }); }}
              className={chip(value === n, r)}
            >
              {t('recordings.rewindSettings.minutes', { n })}
            </span>
          ))}
        </div>
      </div>
    );
  };

  /** What the highlighted row does, said once in the box under the list. */
  const about = (() => {
    if (focus === 'enabled' || focus === 'back') {
      return (
        <>
          <p className={`${note} text-white/75`}>{t('recordings.rewindSettings.rewindLiveDesc')}</p>
          <p data-rewind-extra-stream className={`${note} text-brand-gold mt-1 flex items-start`}>
            <Info className="w-3.5 h-3.5 mr-1.5 mt-0.5 flex-shrink-0" /> {t('recordings.rewind.extraStream')}
          </p>
          {plan && <p data-rewind-plan className={`${note} text-amber-300 mt-1`}>{plan}</p>}
        </>
      );
    }
    if (focus === 'max') {
      return (
        <>
          <p className={`${note} text-white/75`}>{t('recordings.rewindSettings.autoDesc', { cap: formatBytes(HARD_CAP_BYTES) })}</p>
          {/* What the buffer uses on this box (the figure Auto works from). */}
          <p data-rewind-usage className={`${note} text-brand-ice/70 mt-1`}>
            <span className="font-semibold">{t('recordings.rewindSettings.onThisBox')}</span>{' · '}
            {usage
              ? (budget != null
                ? t('recordings.rewindSettings.usageWithBudget', { used: formatBytes(usage.usedBytes), free: formatBytes(usage.freeBytes), budget: formatBytes(budget) })
                : t('recordings.rewindSettings.usage', { used: formatBytes(usage.usedBytes), free: formatBytes(usage.freeBytes) }))
              : t('recordings.rewindSettings.figuresInApp')}
          </p>
          {budget != null && budget < 256 * 1024 * 1024 && (
            <p className={`${note} text-amber-300 mt-1`}>{t('recordings.rewindSettings.nearlyFull')}</p>
          )}
          <p className={`${note} text-white/55 mt-1`}>{t('recordings.rewindSettings.recordingsSeparate')}</p>
        </>
      );
    }
    if (focus === 'before') return <p className={`${note} text-white/75`}>{t('recordings.rewindSettings.startEarlyDesc')}</p>;
    if (focus === 'after') return <p className={`${note} text-white/75`}>{t('recordings.rewindSettings.endLateDesc')}</p>;
    return <p className={`${note} text-white/75`}>{t('recordings.rewindSettings.networkRowDesc')}</p>;
  })();

  if (netOpen) return <NetworkFolderScreen embedded={embedded} active={active} onBack={closeNet} />;

  return (
    <div className={embedded ? 'h-full min-h-0 overflow-hidden flex flex-col text-white' : 'h-screen overflow-hidden flex flex-col text-white bg-black/70'}>
      {!embedded && (
        <div className="flex items-center px-6 py-4 border-b border-white/10 bg-black/30">
          <BackButton onClick={onBack} label={t('common.back')} data-player-header-btn="" focused={focus === 'back'} />
          <History className="w-7 h-7 ml-3 mr-2 text-brand-gold" />
          <h1 className="text-2xl font-quicksand font-bold">{t('recordings.rewindSettings.title')}</h1>
        </div>
      )}
      <div className={embedded ? 'flex-1 min-h-0 flex flex-col' : 'flex-1 min-h-0 p-6 flex justify-center'}>
        <div className="w-full max-w-2xl flex-1 min-h-0 flex flex-col">
          {/* The rows (they scroll on a small screen); the explanation stays under them. */}
          <div className="flex-1 min-h-0 overflow-auto p-1">
            <h3 className={heading}>{t('recordings.rewindSettings.groupRewind')}</h3>
            <div className="space-y-1.5">
              <div data-rewind-row="enabled" data-focused={focus === 'enabled' ? 'true' : 'false'} className={row('enabled')}
                onClick={() => { setFocus('enabled'); update({ ...s, enabled: !s.enabled }); }}>
                <p className={name}>{t('recordings.rewindSettings.rewindLive')}</p>
                <span className={`ml-3 px-3 py-0.5 rounded-full text-sm leading-5 font-quicksand font-bold flex-shrink-0 ${s.enabled ? 'bg-brand-gold text-brand-navy' : 'bg-white/10 text-white/70'}`}>
                  {s.enabled ? t('recordings.rewindSettings.onChip') : t('recordings.rewindSettings.offChip')}
                </span>
              </div>
              <div data-rewind-row="max" data-focused={focus === 'max' ? 'true' : 'false'} className={row('max')} onClick={() => setFocus('max')}>
                <p className={name}>{t('recordings.rewindSettings.maxRewind')}</p>
                <div className="ml-3 flex-shrink-0 whitespace-nowrap">
                  {MAX_REWIND_CHOICES.map((c) => (
                    <span
                      key={String(c.id)}
                      onClick={(e) => { e.stopPropagation(); setFocus('max'); update({ ...s, maxRewind: c.id }); }}
                      className={chip(s.maxRewind === c.id, 'max')}
                    >
                      {c.id === 'auto' ? t('recordings.rewindSettings.auto') : t('recordings.rewindSettings.minutes', { n: c.id })}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <h3 className={`${heading} mt-4`}>{t('recordings.rewindSettings.groupRecording')}</h3>
            <div className="space-y-1.5">
              {padRow('before')}
              {padRow('after')}
              {netShown && (
                <div data-rewind-row="net" data-focused={focus === 'net' ? 'true' : 'false'} className={row('net')}
                  onClick={() => { setFocus('net'); setNetOpen(true); }}>
                  <Monitor className="w-5 h-5 mr-2.5 text-brand-gold flex-shrink-0" />
                  <p className={name}>{t('recordings.rewindSettings.networkRow')}</p>
                  <span data-rewind-net-value className={`ml-3 px-3 py-0.5 rounded-lg text-sm leading-5 font-quicksand font-bold truncate ${net !== 'loading' && net.configured ? 'bg-brand-gold text-brand-navy' : 'bg-white/10 text-white/70'}`} style={{ maxWidth: '40%' }}>
                    {net === 'loading' ? '…' : net.configured ? (net.label || net.host) : t('recordings.rewindSettings.networkOffChip')}
                  </span>
                  <ChevronRight className="w-5 h-5 ml-1.5 text-white/60 flex-shrink-0" />
                </div>
              )}
            </div>
          </div>

          <div data-rewind-about={focus} className="flex-shrink-0 mt-2 mx-1 mb-1 rounded-xl px-4 py-2.5 bg-black/30 border border-white/10">
            {about}
          </div>
        </div>
      </div>
    </div>
  );
});

RewindSettingsScreen.displayName = 'RewindSettingsScreen';
export default RewindSettingsScreen;
