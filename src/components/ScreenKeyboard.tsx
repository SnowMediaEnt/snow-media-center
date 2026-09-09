import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowBigUp, CornerDownLeft, Delete, Check } from 'lucide-react';
import {
  closeScreenKeyboard,
  editableSiblings,
  isEditableField,
  onScreenKeyboardChange,
  openScreenKeyboard,
  screenKeyboardAvailable,
  setFieldValue,
  type EditableField,
} from '@/lib/screenKeyboard';

/**
 * The on-screen keyboard the app draws itself, for the browser preview.
 *
 * It never appears in the installed Android / Fire TV app — that keeps using
 * the platform's own system keyboard. See `src/lib/screenKeyboard.ts`.
 *
 * While it is open it OWNS the remote keys: arrows move its own highlight, OK
 * types, and nothing reaches the screen's focus/back handlers underneath.
 */

type ActionKey = 'shift' | 'space' | 'back' | 'layout' | 'next' | 'done';
type Key = { label: string; char?: string; action?: ActionKey; wide?: number };

const k = (char: string): Key => ({ label: char, char });

const LETTER_ROWS: Key[][] = [
  '1234567890'.split('').map(k),
  'qwertyuiop'.split('').map(k),
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', '@'].map(k),
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', '.', '-', '_'].map(k),
];

const SYMBOL_ROWS: Key[][] = [
  ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'].map(k),
  ['-', '_', '=', '+', '[', ']', '{', '}', ';', ':'].map(k),
  ["'", '"', '\\', '|', ',', '.', '<', '>', '/', '?'].map(k),
  ['~', '`', '£', '€', '¢', '¥', '§', '°', '•', '…'].map(k),
];

const ACTIONS: Key[] = [
  { label: 'Shift', action: 'shift', wide: 2 },
  { label: 'Space', action: 'space', wide: 3 },
  { label: 'Delete', action: 'back', wide: 2 },
  { label: '#+=', action: 'layout' },
  { label: 'Next', action: 'next' },
  { label: 'Done', action: 'done' },
];

const isBackKey = (e: KeyboardEvent) =>
  e.key === 'Escape' || e.keyCode === 4 || e.code === 'GoBack';

const isOk = (e: KeyboardEvent) =>
  e.key === 'Enter' || e.key === 'Select' || e.code === 'Enter' || e.code === 'NumpadEnter'
  || e.keyCode === 13 || e.keyCode === 23;

const ScreenKeyboard = () => {
  const [target, setTarget] = useState<EditableField | null>(null);
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const [pos, setPos] = useState({ row: 1, col: 0 });
  const targetRef = useRef<EditableField | null>(null);
  targetRef.current = target;
  const posRef = useRef(pos);
  posRef.current = pos;
  const shiftRef = useRef(shift);
  shiftRef.current = shift;
  const symbolsRef = useRef(symbols);
  symbolsRef.current = symbols;
  // The very key press that opened the keyboard must not also type a
  // character; anything stamped before we opened is ignored.
  const openedAtRef = useRef(0);

  const rows = useMemo<Key[][]>(
    () => [...(symbols ? SYMBOL_ROWS : LETTER_ROWS), ACTIONS],
    [symbols],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  // Open on a real pointer click / tap in a text bar. Focus alone never opens
  // it: arrow highlighting and mount autofocus must stay silent.
  useEffect(() => {
    if (!screenKeyboardAvailable()) return;
    const onPointerDown = (event: Event) => {
      const el = event.target as Element | null;
      if (!el || el.closest('[data-screen-keyboard]')) return;
      const field = el.closest('input, textarea');
      if (!isEditableField(field)) return;
      openedAtRef.current = performance.now();
      // Let the browser place the caret first, then open.
      setTimeout(() => {
        if (document.activeElement === field || field.isConnected) openScreenKeyboard(field);
      }, 0);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  useEffect(() => onScreenKeyboardChange((el) => {
    openedAtRef.current = performance.now();
    setTarget(el);
    if (el) setPos({ row: 1, col: 0 });
    else { setShift(false); setSymbols(false); }
  }), []);

  // The field can vanish under us (navigation, a screen swap). Close rather
  // than keep typing into a detached node.
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => {
      if (!targetRef.current?.isConnected) closeScreenKeyboard();
    }, 400);
    return () => clearInterval(id);
  }, [target]);

  const insert = useCallback((text: string) => {
    const el = targetRef.current;
    if (!el || !el.isConnected) { closeScreenKeyboard(); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setFieldValue(el, next, start + text.length);
    el.focus({ preventScroll: true });
  }, []);

  const deleteBack = useCallback(() => {
    const el = targetRef.current;
    if (!el || !el.isConnected) { closeScreenKeyboard(); return; }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    if (end > start) {
      setFieldValue(el, el.value.slice(0, start) + el.value.slice(end), start);
    } else if (start > 0) {
      setFieldValue(el, el.value.slice(0, start - 1) + el.value.slice(start), start - 1);
    }
    el.focus({ preventScroll: true });
  }, []);

  const close = useCallback(() => {
    const el = targetRef.current;
    closeScreenKeyboard();
    // Leave the field's own highlight in place so remote navigation keeps
    // working; the screen's focus hook draws that from data-tv-focused.
    el?.blur();
  }, []);

  /** Next editable field of the same form, keeping the keyboard open. */
  const goNext = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const fields = editableSiblings(el);
    const next = fields[fields.indexOf(el) + 1];
    if (!next) { close(); return; }
    next.focus({ preventScroll: true });
    openScreenKeyboard(next);
  }, [close]);

  const press = useCallback((key: Key) => {
    if (key.char) {
      insert(shiftRef.current ? key.char.toUpperCase() : key.char);
      if (shiftRef.current) setShift(false);
      return;
    }
    switch (key.action) {
      case 'shift': setShift((s) => !s); break;
      case 'space': insert(' '); break;
      case 'back': deleteBack(); break;
      case 'layout': setSymbols((s) => !s); break;
      case 'next': goNext(); break;
      case 'done': close(); break;
    }
  }, [close, deleteBack, goNext, insert]);

  // Exclusive remote ownership while open.
  useEffect(() => {
    if (!target) return;
    const handler = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.timeStamp && event.timeStamp <= openedAtRef.current) return;
      const stop = () => {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      };
      const current = rowsRef.current;
      const { row, col } = posRef.current;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        stop();
        const nextRow = event.key === 'ArrowUp'
          ? Math.max(0, row - 1)
          : Math.min(current.length - 1, row + 1);
        setPos({ row: nextRow, col: Math.min(col, current[nextRow].length - 1) });
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        stop();
        const len = current[row].length;
        setPos({ row, col: event.key === 'ArrowLeft' ? Math.max(0, col - 1) : Math.min(len - 1, col + 1) });
        return;
      }
      if (isOk(event)) {
        stop();
        press(current[row][col]);
        return;
      }
      if (isBackKey(event)) {
        stop();
        close();
        return;
      }
      if (event.key === 'Backspace') {
        // Own it: the screen underneath reads Backspace as "go back".
        stop();
        deleteBack();
        return;
      }
      // Everything else — real letters from the computer's keyboard — reaches
      // the focused field untouched.
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [close, deleteBack, press, target]);

  if (!target) return null;

  const masked = target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'password';
  const fieldLabel = target.getAttribute('aria-label') || target.getAttribute('placeholder') || 'text';

  return (
    <div
      data-screen-keyboard
      className="fixed inset-x-0 bottom-0 z-[300] border-t border-brand-gold/40 bg-slate-950/97 px-[2vw] pb-[3vh] pt-[1.5vh] shadow-[0_-20px_60px_rgba(0,0,0,0.7)]"
    >
      <div className="mx-auto w-full max-w-[70rem]">
        <div className="mb-[1vh] flex items-center justify-between font-nunito text-[clamp(0.7rem,1.1vw,0.95rem)] text-brand-ice/70">
          <span>Typing in <span className="text-brand-gold">{fieldLabel}</span>{masked ? ' (hidden)' : ''}</span>
          <span>◀ ▲ ▼ ▶ move · OK type · Back close</span>
        </div>
        <div className="flex flex-col gap-[0.8vh]">
          {rows.map((rowKeys, r) => (
            <div key={r} className="flex justify-center gap-[0.6vw]">
              {rowKeys.map((key, c) => {
                const focused = pos.row === r && pos.col === c;
                const label = key.char && shift ? key.char.toUpperCase() : key.label;
                const activeToggle = (key.action === 'shift' && shift) || (key.action === 'layout' && symbols);
                return (
                  <button
                    key={`${r}-${c}-${key.label}`}
                    type="button"
                    tabIndex={-1}
                    aria-label={key.action ? key.label : `key ${label}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setPos({ row: r, col: c }); press(key); }}
                    style={{ flexGrow: key.wide ?? 1, flexBasis: 0 }}
                    className={`min-h-[clamp(2.1rem,4.4vh,3.2rem)] rounded-xl border font-quicksand text-[clamp(0.8rem,1.5vw,1.15rem)] font-bold transition-transform duration-100
                      ${focused
                        ? 'scale-110 border-brand-gold bg-brand-gold text-slate-950 shadow-[0_0_22px_rgba(212,175,110,0.65)]'
                        : activeToggle
                          ? 'border-brand-gold/60 bg-brand-gold/25 text-brand-gold'
                          : 'border-white/15 bg-white/10 text-white'}`}
                  >
                    {key.action === 'shift' ? <ArrowBigUp className="mx-auto h-5 w-5" />
                      : key.action === 'back' ? <Delete className="mx-auto h-5 w-5" />
                      : key.action === 'next' ? <span className="inline-flex items-center gap-1"><CornerDownLeft className="h-4 w-4" />Next</span>
                      : key.action === 'done' ? <span className="inline-flex items-center gap-1"><Check className="h-4 w-4" />Done</span>
                      : label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ScreenKeyboard;
