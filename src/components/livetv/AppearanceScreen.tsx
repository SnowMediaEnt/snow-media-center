import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Palette, RotateCcw, Check } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';
import {
  ACCENT_SWATCHES,
  BG_SWATCHES,
  FONT_FAMILIES,
  FONT_SCALES,
  TEXT_SWATCHES,
  resetTheme,
} from '@/lib/theme';
import { LIVE_LAYOUTS, saveLiveLayout, useLiveLayout, type LiveLayout } from '@/lib/liveLayout';
import { VIEW_SIZES, saveViewSize, useViewSize } from '@/lib/viewSize';
import { LIVE_ROW_SIZES, saveLiveRowSize, useLiveRowSize } from '@/lib/liveRows';
import LiveLayoutWire from './LiveLayoutWire';
import { keepInView } from '@/utils/keepInView';
import { useTranslation } from 'react-i18next';

interface Props {
  onBack: () => void;
  /** Picking a different Live TV layout: try it on the real screen (the
   *  Player shows Live TV in it, then asks Keep / Change). */
  onTryLayout?: (prev: LiveLayout, next: LiveLayout) => void;
  /** Drawn beside the Settings menu: no header of its own, Back (and Left from a row's first chip) return to the menu. */
  embedded?: boolean;
  /** Embedded only: whether the remote is on this page (false while it is on the menu). */
  active?: boolean;
}

type ChipKind = 'liveLayout' | 'liveRows' | 'viewSize' | 'fontScale' | 'fontFamily' | 'accent' | 'bg' | 'text';
interface Chip {
  kind: ChipKind;
  id: string;
  label: string;
  hsl?: string;   // for color chips
  value?: number; // for fontScale
}
/** One row of chips, its heading and the hint under it (translation keys). */
interface Group {
  kind: ChipKind;
  labelKey: string;
  hintKey?: string;
  chips: Chip[];
}

const AppearanceScreen = memo(({ onBack, onTryLayout, embedded = false, active = true }: Props) => {
  const { t } = useTranslation();
  // The names in lib/theme and lib/liveLayout stay the fallback; the screen shows the translated one by id.
  const chipLabel = (chip: Chip) => {
    // Layout names are shared with the Live TV layout chooser (live.layouts.*).
    const layout = chip.kind === 'liveLayout' ? LIVE_LAYOUTS.find(l => l.id === chip.id) : undefined;
    return layout ? t(layout.labelKey) : t(`liveAccount.appearance.${chip.kind}.${chip.id}`, { defaultValue: chip.label });
  };
  const [theme, setTheme] = useTheme();
  const liveLayout = useLiveLayout();
  const liveLayoutRef = useRef(liveLayout);
  liveLayoutRef.current = liveLayout;
  // The Guide and logo wall size (lib/viewSize): one choice, right under the
  // layouts. Compact (the default) or Large.
  const viewSize = useViewSize();
  // Normal or Slim channel rows (lib/liveRows): only Classic and Compact
  // draw them, so the row is there only with one of those chosen.
  const liveRowSize = useLiveRowSize();
  const listRows = liveLayout === 'classic' || liveLayout === 'compact';

  const groupList = useMemo(() => {
    const list: Group[] = [
      { kind: 'liveLayout', labelKey: 'liveAccount.appearance.groupLayout', chips: LIVE_LAYOUTS.map(l => ({ kind: 'liveLayout', id: l.id, label: l.label })) },
      ...(listRows ? [{ kind: 'liveRows' as const, labelKey: 'liveAccount.appearance.groupLiveRows', hintKey: 'liveAccount.appearance.liveRowsHint', chips: LIVE_ROW_SIZES.map((id): Chip => ({ kind: 'liveRows', id, label: id })) }] : []),
      { kind: 'viewSize', labelKey: 'liveAccount.appearance.groupViewSize', hintKey: 'liveAccount.appearance.viewSizeHint', chips: VIEW_SIZES.map(id => ({ kind: 'viewSize', id, label: id })) },
      { kind: 'fontScale', labelKey: 'liveAccount.appearance.groupTextSize', chips: FONT_SCALES.map(s => ({ kind: 'fontScale', id: s.id, label: s.label, value: s.value })) },
      { kind: 'fontFamily', labelKey: 'liveAccount.appearance.groupFont', chips: FONT_FAMILIES.map(f => ({ kind: 'fontFamily', id: f.id, label: f.label })) },
      { kind: 'accent', labelKey: 'liveAccount.appearance.groupAccent', chips: ACCENT_SWATCHES.map(s => ({ kind: 'accent', id: s.id, label: s.label, hsl: s.hsl })) },
      { kind: 'bg', labelKey: 'liveAccount.appearance.groupBackground', chips: BG_SWATCHES.map(s => ({ kind: 'bg', id: s.id, label: s.label, hsl: s.hsl })) },
      { kind: 'text', labelKey: 'liveAccount.appearance.groupTextColor', chips: TEXT_SWATCHES.map(s => ({ kind: 'text', id: s.id, label: s.label, hsl: s.hsl })) },
    ];
    return list;
  }, [listRows]);
  const groups = useMemo(() => groupList.map(g => g.chips), [groupList]);

  // Flat focus index: 0 = Back, then for each group N chips, then Reset last.
  const groupStarts = useMemo(() => {
    const starts: number[] = [];
    let n = 1; // after Back
    groups.forEach(g => { starts.push(n); n += g.length; });
    return { starts, totalChips: n - 1, resetIdx: n };
  }, [groups]);
  const totalFocusable = groupStarts.resetIdx + 1;

  const [focusIdx, setFocusIdx] = useState(1);
  const focusIdxRef = useRef(focusIdx);
  useEffect(() => { focusIdxRef.current = focusIdx; }, [focusIdx]);
  // A row coming or going (Channel rows, with the layout) moves every place
  // after it: never past Reset.
  useEffect(() => { if (focusIdx > groupStarts.resetIdx) setFocusIdx(groupStarts.resetIdx); }, [focusIdx, groupStarts]);
  // Follow the highlight down the page: Background, Text color and Reset sit
  // below the fold on a TV, and nothing scrolled them into view.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    if (focusIdx <= 1) { node.scrollTop = 0; return; }
    const el = node.querySelector<HTMLElement>('[data-focused="true"]');
    if (el) keepInView(node, el, 24);
  }, [focusIdx]);

  const findChip = (idx: number): { chip: Chip; group: number; posInGroup: number } | null => {
    if (idx <= 0 || idx >= groupStarts.resetIdx) return null;
    for (let g = 0; g < groups.length; g++) {
      const start = groupStarts.starts[g];
      const end = start + groups[g].length;
      if (idx >= start && idx < end) {
        return { chip: groups[g][idx - start], group: g, posInGroup: idx - start };
      }
    }
    return null;
  };

  const isSelected = (chip: Chip): boolean => {
    if (chip.kind === 'liveLayout') return liveLayout === chip.id;
    if (chip.kind === 'liveRows') return liveRowSize === chip.id;
    if (chip.kind === 'viewSize') return viewSize === chip.id;
    if (chip.kind === 'fontScale') return theme.fontScale === chip.value;
    if (chip.kind === 'fontFamily') return theme.fontFamily === chip.id;
    if (chip.kind === 'accent') return theme.accentColor === chip.hsl;
    if (chip.kind === 'bg') return theme.bgColor === chip.hsl;
    if (chip.kind === 'text') return theme.textColor === chip.hsl;
    return false;
  };

  const applyChip = (chip: Chip) => {
    if (chip.kind === 'liveLayout') {
      const next = chip.id as LiveLayout;
      if (next !== liveLayoutRef.current && onTryLayout) onTryLayout(liveLayoutRef.current, next);
      else saveLiveLayout(next);
    }
    else if (chip.kind === 'liveRows') saveLiveRowSize(chip.id === 'slim' ? 'slim' : 'normal');
    else if (chip.kind === 'viewSize') saveViewSize(chip.id === 'large' ? 'large' : 'compact');
    else if (chip.kind === 'fontScale' && typeof chip.value === 'number') setTheme({ fontScale: chip.value });
    else if (chip.kind === 'fontFamily') setTheme({ fontFamily: chip.id });
    else if (chip.kind === 'accent' && chip.hsl) setTheme({ accentColor: chip.hsl });
    else if (chip.kind === 'bg' && chip.hsl) setTheme({ bgColor: chip.hsl });
    else if (chip.kind === 'text' && chip.hsl) setTheme({ textColor: chip.hsl });
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (embedded && !active) return; // the remote is on the Settings menu
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

      const cur = focusIdxRef.current;
      const info = findChip(cur);

      if (e.key === 'ArrowDown') {
        if (cur === 0) {
          setFocusIdx(groupStarts.starts[0]); // first chip
        } else if (cur === groupStarts.resetIdx) {
          // stay
        } else if (info) {
          if (info.group < groups.length - 1) {
            setFocusIdx(groupStarts.starts[info.group + 1]);
          } else {
            setFocusIdx(groupStarts.resetIdx);
          }
        }
      } else if (e.key === 'ArrowUp') {
        if (cur === 0) {
          // stay
        } else if (cur === groupStarts.resetIdx) {
          setFocusIdx(groupStarts.starts[groups.length - 1]);
        } else if (info) {
          if (info.group > 0) setFocusIdx(groupStarts.starts[info.group - 1]);
          else if (!embedded) setFocusIdx(0); // embedded: no Back button up there
        }
      } else if (e.key === 'ArrowLeft') {
        if (info && info.posInGroup > 0) setFocusIdx(cur - 1);
        // Embedded: Left from a row's first chip (or from Reset) goes back to the menu.
        else if (embedded) onBack();
      } else if (e.key === 'ArrowRight') {
        if (info && info.posInGroup < groups[info.group].length - 1) setFocusIdx(cur + 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (cur === 0) onBack();
        else if (cur === groupStarts.resetIdx) resetTheme();
        else if (info) applyChip(info.chip);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBack, groups, groupStarts, embedded, active]);

  const renderChip = (chip: Chip, flatIdx: number) => {
    const focused = focusIdx === flatIdx;
    const selected = isSelected(chip);
    // Live TV layouts are pictures of the screen, not text chips.
    if (chip.kind === 'liveLayout') {
      return (
        <div
          key={`${chip.kind}-${chip.id}`}
          data-focused={focused ? 'true' : 'false'}
          data-selected={selected ? 'true' : 'false'}
          onClick={() => { setFocusIdx(flatIdx); applyChip(chip); }}
          className={`tv-ring relative rounded-2xl p-3 border cursor-pointer transition-transform ${selected ? 'bg-brand-gold/15 border-brand-gold/60' : 'bg-slate-900/60 border-white/10'} ${focused ? 'scale-105 z-10' : ''}`}
        >
          <LiveLayoutWire id={chip.id as LiveLayout} />
          <div className="mt-2 flex items-center justify-between">
            <span className={`text-base font-quicksand font-bold ${selected ? 'text-brand-gold' : 'text-white'}`}>{chipLabel(chip)}</span>
            {selected && <Check className="w-4 h-4 text-brand-gold" />}
          </div>
        </div>
      );
    }
    const showDot = chip.kind === 'accent' || chip.kind === 'bg' || chip.kind === 'text';
    return (
      <div
        key={`${chip.kind}-${chip.id}`}
        data-focused={focused ? 'true' : 'false'}
        data-selected={selected ? 'true' : 'false'}
        onClick={() => { setFocusIdx(flatIdx); applyChip(chip); }}
        className={`tv-ring inline-flex items-center gap-2 rounded-full px-4 py-3 border cursor-pointer ${selected ? 'bg-brand-gold/25 border-brand-gold/60' : 'bg-slate-900/60 border-white/10' } ${focused ? 'scale-105 z-10' : ''}`}
      >
        {showDot && chip.hsl && (
          <span
            className="w-4 h-4 rounded-full border border-white/30 shrink-0"
            style={{ backgroundColor: `hsl(${chip.hsl})` }}
          />
        )}
        <span className="text-sm font-nunito text-white">{chipLabel(chip)}</span>
        {selected && <Check className="w-3.5 h-3.5 text-brand-gold" />}
      </div>
    );
  };

  const layoutDesc = LIVE_LAYOUTS.find(l => l.id === liveLayout);
  const groupHint = (g: Group): string => (g.kind === 'liveLayout'
    ? `${layoutDesc ? t(layoutDesc.descKey) : ''}${onTryLayout ? ` · ${t('liveAccount.appearance.tryHint')}` : ''}`
    : g.hintKey ? t(g.hintKey) : '');

  return (
    <div className={embedded ? 'h-full min-h-0 overflow-hidden flex flex-col text-white' : 'h-screen overflow-hidden flex flex-col text-white bg-black/70'}>
      {!embedded && (
        <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 bg-black/30">
          <BackButton
            onClick={onBack}
            label={t('common.back')}
            data-player-header-btn=""
            focused={focusIdx === 0}
          />
          <div className="flex items-center gap-2">
            <Palette className="w-7 h-7 text-brand-gold" />
            <h1 className="text-2xl font-quicksand font-bold text-white">{t('liveAccount.appearance.title')}</h1>
          </div>
        </div>
      )}

      <div ref={scrollRef} className={embedded ? 'flex-1 overflow-auto p-1' : 'flex-1 overflow-auto p-6 flex items-start justify-center'}>
        <div className="w-full max-w-3xl space-y-6">
          {groupList.map((grp, gi) => {
            const hint = groupHint(grp);
            const chips = grp.chips.map((chip, ci) => renderChip(chip, groupStarts.starts[gi] + ci));
            return (
              <div key={grp.kind} className="space-y-3" data-appearance-group={grp.kind}>
                <div className="text-xs uppercase tracking-wide text-white/70">{t(grp.labelKey)}</div>
                {hint ? <div className="text-sm font-nunito text-brand-ice/70">{hint}</div> : null}
                {grp.kind === 'liveLayout'
                  ? <div className="grid grid-cols-4 gap-4">{chips}</div>
                  : <div className="flex flex-wrap gap-2">{chips}</div>}
              </div>
            );
          })}

          <div className="pt-2">
            <div
              data-focused={focusIdx === groupStarts.resetIdx ? 'true' : 'false'}
              onClick={() => { setFocusIdx(groupStarts.resetIdx); resetTheme(); }}
              className={`tv-ring inline-flex items-center gap-2 rounded-xl px-4 py-3 border border-white/15 bg-slate-900/60 cursor-pointer ${focusIdx === groupStarts.resetIdx ? 'scale-105 z-10' : ''}`}
            >
              <RotateCcw className="w-4 h-4 text-brand-ice" />
              <span className="text-sm font-nunito">{t('liveAccount.appearance.resetBtn')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

AppearanceScreen.displayName = 'AppearanceScreen';
export default AppearanceScreen;
