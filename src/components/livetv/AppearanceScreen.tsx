import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Palette, RotateCcw, Check } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import {
  ACCENT_SWATCHES,
  BG_SWATCHES,
  FONT_FAMILIES,
  FONT_SCALES,
  TEXT_SWATCHES,
  resetTheme,
} from '@/lib/theme';

interface Props { onBack: () => void }

type ChipKind = 'fontScale' | 'fontFamily' | 'accent' | 'bg' | 'text';
interface Chip {
  kind: ChipKind;
  id: string;
  label: string;
  hsl?: string;   // for color chips
  value?: number; // for fontScale
  groupIdx: number;
}

const AppearanceScreen = memo(({ onBack }: Props) => {
  const [theme, setTheme] = useTheme();

  const groups = useMemo(() => {
    const gFontScale: Chip[] = FONT_SCALES.map(s => ({ kind: 'fontScale', id: s.id, label: s.label, value: s.value, groupIdx: 0 }));
    const gFontFamily: Chip[] = FONT_FAMILIES.map(f => ({ kind: 'fontFamily', id: f.id, label: f.label, groupIdx: 1 }));
    const gAccent: Chip[] = ACCENT_SWATCHES.map(s => ({ kind: 'accent', id: s.id, label: s.label, hsl: s.hsl, groupIdx: 2 }));
    const gBg: Chip[] = BG_SWATCHES.map(s => ({ kind: 'bg', id: s.id, label: s.label, hsl: s.hsl, groupIdx: 3 }));
    const gText: Chip[] = TEXT_SWATCHES.map(s => ({ kind: 'text', id: s.id, label: s.label, hsl: s.hsl, groupIdx: 4 }));
    return [gFontScale, gFontFamily, gAccent, gBg, gText];
  }, []);

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
    if (chip.kind === 'fontScale') return theme.fontScale === chip.value;
    if (chip.kind === 'fontFamily') return theme.fontFamily === chip.id;
    if (chip.kind === 'accent') return theme.accentColor === chip.hsl;
    if (chip.kind === 'bg') return theme.bgColor === chip.hsl;
    if (chip.kind === 'text') return theme.textColor === chip.hsl;
    return false;
  };

  const applyChip = (chip: Chip) => {
    if (chip.kind === 'fontScale' && typeof chip.value === 'number') setTheme({ fontScale: chip.value });
    else if (chip.kind === 'fontFamily') setTheme({ fontFamily: chip.id });
    else if (chip.kind === 'accent' && chip.hsl) setTheme({ accentColor: chip.hsl });
    else if (chip.kind === 'bg' && chip.hsl) setTheme({ bgColor: chip.hsl });
    else if (chip.kind === 'text' && chip.hsl) setTheme({ textColor: chip.hsl });
  };

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
          else setFocusIdx(0);
        }
      } else if (e.key === 'ArrowLeft') {
        if (info && info.posInGroup > 0) setFocusIdx(cur - 1);
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
  }, [onBack, groups, groupStarts]);

  const renderChip = (chip: Chip, flatIdx: number) => {
    const focused = focusIdx === flatIdx;
    const selected = isSelected(chip);
    const showDot = chip.kind === 'accent' || chip.kind === 'bg' || chip.kind === 'text';
    return (
      <div
        key={`${chip.kind}-${chip.id}`}
        data-player-header-btn=""
        data-focused={focused ? 'true' : 'false'}
        data-selected={selected ? 'true' : 'false'}
        onClick={() => { setFocusIdx(flatIdx); applyChip(chip); }}
        className={`tv-focusable home-focus-surface inline-flex items-center gap-2 rounded-full px-4 py-2 border cursor-pointer transition-transform duration-150 ${
          selected ? 'bg-brand-gold/25 border-brand-gold/60' : 'bg-slate-900/60 border-white/10'
        } ${focused ? 'scale-105' : ''}`}
      >
        {showDot && chip.hsl && (
          <span
            className="w-4 h-4 rounded-full border border-white/30 shrink-0"
            style={{ backgroundColor: `hsl(${chip.hsl})` }}
          />
        )}
        <span className="text-sm font-nunito text-white">{chip.label}</span>
        {selected && <Check className="w-3.5 h-3.5 text-brand-gold" />}
      </div>
    );
  };

  const groupLabels = ['Text size', 'Font', 'Highlight color', 'Background', 'Text color'];

  return (
    <div className="min-h-screen flex flex-col text-white bg-black/70">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <Button
          variant="white"
          size="sm"
          onClick={onBack}
          data-player-header-btn=""
          data-focused={focusIdx === 0 ? 'true' : 'false'}
          className={`tv-focusable home-focus-surface transition-transform duration-150 ${
            focusIdx === 0 ? 'scale-105' : ''
          }`}
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <Palette className="w-7 h-7 text-brand-gold" />
          <h1 className="text-2xl font-quicksand font-bold text-white">Appearance</h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 flex items-start justify-center">
        <div className="w-full max-w-3xl space-y-5">
          {groups.map((g, gi) => (
            <div key={groupLabels[gi]} className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-white/60">{groupLabels[gi]}</div>
              <div className="flex flex-wrap gap-2">
                {g.map((chip, ci) => renderChip(chip, groupStarts.starts[gi] + ci))}
              </div>
            </div>
          ))}

          <div className="pt-2">
            <div
              data-player-header-btn=""
              data-focused={focusIdx === groupStarts.resetIdx ? 'true' : 'false'}
              onClick={() => { setFocusIdx(groupStarts.resetIdx); resetTheme(); }}
              className={`tv-focusable home-focus-surface inline-flex items-center gap-2 rounded-xl px-4 py-2 border border-white/15 bg-slate-900/60 cursor-pointer transition-transform duration-150 ${
                focusIdx === groupStarts.resetIdx ? 'scale-105' : ''
              }`}
            >
              <RotateCcw className="w-4 h-4 text-brand-ice" />
              <span className="text-sm font-nunito">Reset to default</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

AppearanceScreen.displayName = 'AppearanceScreen';
export default AppearanceScreen;
