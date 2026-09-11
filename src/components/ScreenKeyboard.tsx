import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import {
  canUseScreenKeyboard,
  closeScreenKeyboard,
  deleteScreenKeyboardValue,
  getScreenKeyboardTarget,
  nextScreenKeyboardField,
  openScreenKeyboard,
  subscribeScreenKeyboard,
  writeScreenKeyboardValue,
} from '@/lib/screenKeyboard';

const LETTERS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', '@', '.', '-'],
];
const SYMBOLS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['!', '#', '$', '%', '&', '*', '(', ')', '/', '?'],
  ['+', '=', '_', ':', ';', "'", '"', ',', '.', '-'],
];

type Key = { label: string; value?: string; action?: 'shift' | 'symbols' | 'space' | 'delete' | 'next' | 'done' };

const ScreenKeyboard = () => {
  const target = useSyncExternalStore(subscribeScreenKeyboard, getScreenKeyboardTarget, () => null);
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const [row, setRow] = useState(0);
  const [column, setColumn] = useState(0);

  useEffect(() => {
    if (!canUseScreenKeyboard()) return;
    const openFromPointer = (event: PointerEvent) => {
      const element = event.target;
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        openScreenKeyboard(element);
      }
    };
    document.addEventListener('pointerup', openFromPointer, true);
    return () => document.removeEventListener('pointerup', openFromPointer, true);
  }, []);

  useEffect(() => {
    if (!target) return;
    const timer = window.setInterval(() => {
      if (!target.isConnected) closeScreenKeyboard();
    }, 250);
    return () => window.clearInterval(timer);
  }, [target]);

  const rows = useMemo<Key[][]>(() => {
    const source = symbols ? SYMBOLS : LETTERS;
    const characterRows = source.map((values) => values.map((value) => ({
      label: shift && !symbols ? value.toUpperCase() : value,
      value: shift && !symbols ? value.toUpperCase() : value,
    })));
    return [
      ...characterRows,
      [
        { label: shift ? 'Shift on' : 'Shift', action: 'shift' },
        { label: symbols ? 'ABC' : '#+=', action: 'symbols' },
        { label: 'Space', action: 'space' },
        { label: 'Delete', action: 'delete' },
        { label: target?.enterKeyHint === 'next' ? 'Next' : 'Done', action: target?.enterKeyHint === 'next' ? 'next' : 'done' },
      ],
    ];
  }, [shift, symbols, target?.enterKeyHint]);

  useEffect(() => {
    if (!target) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const currentRow = rows[row] ?? rows[0];
      if (event.key === 'Escape' || event.keyCode === 4 || event.code === 'GoBack') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeScreenKeyboard();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'ArrowLeft') setColumn((value) => (value - 1 + currentRow.length) % currentRow.length);
        if (event.key === 'ArrowRight') setColumn((value) => (value + 1) % currentRow.length);
        if (event.key === 'ArrowUp') setRow((value) => {
          const next = (value - 1 + rows.length) % rows.length;
          setColumn((col) => Math.min(col, rows[next].length - 1));
          return next;
        });
        if (event.key === 'ArrowDown') setRow((value) => {
          const next = (value + 1) % rows.length;
          setColumn((col) => Math.min(col, rows[next].length - 1));
          return next;
        });
        return;
      }
      const isOk = event.key === 'Enter' || event.key === 'Select' || event.keyCode === 13 || event.keyCode === 23;
      if (isOk) {
        event.preventDefault();
        event.stopImmediatePropagation();
        activate(rows[row]?.[column] ?? rows[0][0]);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  const activate = (key: Key) => {
    if (key.value !== undefined) {
      writeScreenKeyboardValue(key.value);
      if (shift) setShift(false);
      return;
    }
    if (key.action === 'shift') setShift((value) => !value);
    if (key.action === 'symbols') setSymbols((value) => !value);
    if (key.action === 'space') writeScreenKeyboardValue(' ');
    if (key.action === 'delete') deleteScreenKeyboardValue();
    if (key.action === 'next') {
      const next = nextScreenKeyboardField();
      if (next) {
        openScreenKeyboard(next);
        setRow(0);
        setColumn(0);
      } else closeScreenKeyboard();
    }
    if (key.action === 'done') closeScreenKeyboard();
  };

  if (!target) return null;

  return (
    <section
      aria-label="On-screen keyboard"
      className="fixed inset-x-0 bottom-0 z-[100] border-t border-brand-gold/50 bg-brand-navy/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-2xl backdrop-blur-md"
      onPointerDown={(event) => event.preventDefault()}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
        {rows.map((keys, rowIndex) => (
          <div key={rowIndex} className="flex min-h-11 justify-center gap-2">
            {keys.map((key, columnIndex) => {
              const selected = row === rowIndex && column === columnIndex;
              return (
                <Button
                  key={`${key.label}-${columnIndex}`}
                  type="button"
                  variant={selected ? 'gold' : 'navy'}
                  aria-label={key.label}
                  aria-pressed={selected}
                  className={`h-11 min-w-10 flex-1 rounded-md px-2 text-base font-bold ${key.action === 'space' ? 'max-w-72' : 'max-w-24'} ${selected ? 'scale-110 shadow-[var(--shadow-glow)]' : ''}`}
                  onPointerEnter={() => { setRow(rowIndex); setColumn(columnIndex); }}
                  onClick={() => activate(key)}
                >
                  {key.action === 'space' ? 'Space' : key.label}
                </Button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
};

export default ScreenKeyboard;