import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CircleDot, Coins, Gem, Loader2, RotateCw, Trash2, Trophy, Undo2 } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import { GameTopBar } from './shared/GameUI';
import { GameFxCanvas } from './shared/GameFxCanvas';
import { useGameLifecycle } from './shared/gameLifecycle';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { isBackKey, useGameBack } from './shared/gameBack';
import { isGlobalModalOpen, visualArrowDir } from './shared/gameInput';
import { useGameAudio } from './shared/gameAudio';
import '@/styles/games-wheels.css';

interface RouletteProps {
  onBack: () => void;
}

type WheelKind = 'european' | 'american';
type SlotNum = number | '00';

const DENOMS = [10, 25, 50, 100];
const RED_NUMS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const isRed = (n: number) => RED_NUMS.has(n);
const colorOf = (n: SlotNum): 'red' | 'black' | 'green' => {
  if (n === 0 || n === '00') return 'green';
  return isRed(n as number) ? 'red' : 'black';
};

const EU_ORDER: SlotNum[] = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const AM_ORDER: SlotNum[] = [0,28,9,26,30,11,7,20,32,17,5,22,34,15,3,24,36,13,1,'00',27,10,25,29,12,8,19,31,18,6,21,33,16,4,23,35,14,2];

type BetType =
  | 'straight' | 'column' | 'dozen'
  | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high';
/** What a bet points at: a slot for straights, an index for columns/dozens, nothing for evens. */
type BetSelection = SlotNum | number | number[] | null;
interface Bet { type: BetType; selection: BetSelection; amount: number }
interface PlacedChip { type: BetType; selection: BetSelection; key: string; amount: number }
/** One physical chip placement — the single source of truth for the board. */
interface ChipPlacement { key: string; type: BetType; selection: BetSelection; amount: number }
interface SpinResult {
  number: SlotNum;
  color: 'red' | 'black' | 'green';
  bets: { type: BetType; selection: BetSelection; amount: number; won: boolean; payout: number; halfBack?: boolean }[];
  totalBet: number;
  totalPayout: number;
  net: number;
}

const keyFor = (type: BetType, selection: BetSelection) =>
  `${type}:${selection === null || selection === undefined ? '_' : Array.isArray(selection) ? selection.join(',') : String(selection)}`;

interface RouletteCellProps {
  id: string; label?: string; type: BetType; selection: BetSelection;
  color: 'red' | 'black' | 'green' | 'neutral'; className?: string;
  children?: React.ReactNode; placed?: PlacedChip; won?: boolean; lost?: boolean; halfBack?: boolean;
  spinning: boolean; focused: boolean;
  register: (id: string, el: HTMLButtonElement | null, bet: { type: BetType; selection: BetSelection }) => void;
  onFocus: (id: string) => void; onPlace: (type: BetType, selection: BetSelection) => void;
}

/**
 * Module-scope, memoized betting cell. It is rendered directly (never wrapped
 * in a component created during render) so D-pad moves and chip placements
 * only re-render the affected cells instead of remounting the whole board.
 */
export const RouletteCell = memo(({ id, label, type, selection, color, className = '', children, placed, won, lost, halfBack, spinning, focused, register, onFocus, onPlace }: RouletteCellProps) => {
  const bg = color === 'red' ? 'snow-rl-cell--red' : color === 'black' ? 'snow-rl-cell--black' : color === 'green' ? 'snow-rl-cell--green' : 'snow-rl-cell--neutral';
  const accessibleLabel = label
    ?? (typeof children === 'string' || typeof children === 'number' ? String(children) : undefined)
    ?? (selection === null || selection === undefined ? undefined : String(selection));
  return (
    <button
      type="button"
      ref={(el) => register(id, el, { type, selection })}
      onFocus={() => onFocus(id)}
      onClick={() => { if (!spinning) onPlace(type, selection); }}
      aria-disabled={spinning ? 'true' : undefined}
      data-tv-focused={focused ? 'true' : 'false'}
      className={`snow-rl-cell ${bg} ${className} ${won ? 'is-won' : ''} ${lost ? 'is-lost' : ''} ${halfBack ? 'is-half-back' : ''}`}
      aria-label={accessibleLabel}
    >
      {children ?? label ?? String(selection)}
      {placed && <span className="snow-rl-chip">{placed.amount}</span>}
    </button>
  );
});
RouletteCell.displayName = 'RouletteCell';

const Roulette = ({ onBack }: RouletteProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { balance, status } = useGameSocket();
  const life = useGameLifecycle();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  const { play } = useGameAudio();

  const [wheel, setWheel] = useState<WheelKind>('european');
  const [denom, setDenom] = useState<number>(10);
  // Single source of truth: every chip physically placed, newest last.
  const [placements, setPlacements] = useState<ChipPlacement[]>([]);
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const spinEpoch = useRef(0);
  const [result, setResult] = useState<SpinResult | null>(null);
  const [winKeys, setWinKeys] = useState<Set<string>>(new Set());
  const [halfBackKeys, setHalfBackKeys] = useState<Set<string>>(new Set());
  const [celebrate, setCelebrate] = useState(false);
  const [backNote, setBackNote] = useState<string | null>(null);
  /**
   * Immutable copy of the chips that were on the felt when the wheel settled.
   * Live placements are cleared on settle (the wager is spent), so the board
   * colours won/lost cells from this snapshot until the next wager.
   */
  const [settledChips, setSettledChips] = useState<PlacedChip[]>([]);

  // Wheel animation
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wheelMeasureRef = useRef<HTMLDivElement>(null);
  const wheelVisualRef = useRef<HTMLDivElement>(null);
  const ballVisualRef = useRef<HTMLDivElement>(null);
  const wheelRotationRef = useRef(0);
  const ballRotationRef = useRef(0);

  // Focus
  const focusItems = useRef<Map<string, HTMLElement>>(new Map());
  const cellBets = useRef<Map<string, { type: BetType; selection: BetSelection }>>(new Map());
  const [focusId, setFocusId] = useState<string>('denom-10');

  // Live mirrors so cell callbacks stay referentially stable.
  const denomRef = useRef(denom);
  denomRef.current = denom;
  const spinningRef = useRef(spinning);
  spinningRef.current = spinning;

  const chips = useMemo<PlacedChip[]>(() => {
    const map = new Map<string, PlacedChip>();
    placements.forEach((p) => {
      const existing = map.get(p.key);
      if (existing) existing.amount += p.amount;
      else map.set(p.key, { type: p.type, selection: p.selection, key: p.key, amount: p.amount });
    });
    return [...map.values()];
  }, [placements]);

  const registerFocus = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) focusItems.current.set(id, el);
    else focusItems.current.delete(id);
  }, []);

  const registerCell = useCallback((id: string, el: HTMLButtonElement | null, bet: { type: BetType; selection: BetSelection }) => {
    if (el) { focusItems.current.set(id, el); cellBets.current.set(id, bet); }
    else { focusItems.current.delete(id); cellBets.current.delete(id); }
  }, []);

  const setWheelVisuals = useCallback((wheelRotation: number, ballRotation: number) => {
    wheelRotationRef.current = wheelRotation;
    ballRotationRef.current = ballRotation;
    if (wheelVisualRef.current) wheelVisualRef.current.style.transform = `rotate(${wheelRotation}deg)`;
    if (ballVisualRef.current) ballVisualRef.current.style.transform = `rotate(${ballRotation}deg)`;
  }, []);

  const retireWillChange = useCallback(() => {
    if (wheelVisualRef.current) wheelVisualRef.current.style.willChange = 'auto';
    if (ballVisualRef.current) ballVisualRef.current.style.willChange = 'auto';
  }, []);

  // Apply focus (never leave the remote without a target)
  useEffect(() => {
    const el = focusItems.current.get(focusId);
    if (el && document.activeElement !== el) {
      el.focus();
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [focusId, placements, spinning, wheel, result]);

  const usable = (el: HTMLElement) => el.getAttribute('aria-disabled') !== 'true' && !(el as HTMLButtonElement).disabled;

  // Spatial nav
  const moveFocus = useCallback((dir: 'up' | 'down' | 'left' | 'right') => {
    const current = focusItems.current.get(focusId);
    if (!current) return;
    const c = current.getBoundingClientRect();
    const cx = c.left + c.width / 2;
    const cy = c.top + c.height / 2;
    let best: { id: string; score: number } | null = null;
    focusItems.current.forEach((el, id) => {
      if (id === focusId) return;
      if (!usable(el)) return;
      const r = el.getBoundingClientRect();
      const rx = r.left + r.width / 2;
      const ry = r.top + r.height / 2;
      const dx = rx - cx;
      const dy = ry - cy;
      let dirOk = false;
      let primary = 0, secondary = 0;
      if (dir === 'right') { dirOk = dx > 4; primary = dx; secondary = Math.abs(dy); }
      else if (dir === 'left') { dirOk = dx < -4; primary = -dx; secondary = Math.abs(dy); }
      else if (dir === 'down') { dirOk = dy > 4; primary = dy; secondary = Math.abs(dx); }
      else { dirOk = dy < -4; primary = -dy; secondary = Math.abs(dx); }
      if (!dirOk) return;
      const score = primary + secondary * 3;
      if (!best || score < best.score) best = { id, score };
    });
    if (best) setFocusId(best.id);
  }, [focusId]);

  /** Drops the previous round's result AND its settled chip snapshot. */
  const clearSettleVisuals = useCallback(() => {
    setResult(null);
    setWinKeys(new Set());
    setHalfBackKeys(new Set());
    setSettledChips([]);
  }, []);

  // Place a chip (stable identity so memoized cells do not re-render on state churn)
  const placeChipOn = useCallback((type: BetType, selection: BetSelection) => {
    if (spinningRef.current) return;
    const amount = denomRef.current;
    setPlacements((prev) => [...prev, { key: keyFor(type, selection), type, selection, amount }]);
    clearSettleVisuals();
  }, [clearSettleVisuals]);

  /** Remove the most recent chip placed on this cell — the exact denomination. */
  const decrementChipOn = useCallback((type: BetType, selection: BetSelection) => {
    if (spinningRef.current) return;
    const k = keyFor(type, selection);
    setPlacements((prev) => {
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        if (prev[i].key === k) return [...prev.slice(0, i), ...prev.slice(i + 1)];
      }
      return prev;
    });
    clearSettleVisuals();
  }, [clearSettleVisuals]);

  const undoLast = useCallback(() => {
    if (spinningRef.current) return;
    setPlacements((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
    clearSettleVisuals();
  }, [clearSettleVisuals]);

  const clearBets = useCallback(() => {
    if (spinningRef.current) return;
    setPlacements([]);
    clearSettleVisuals();
  }, [clearSettleVisuals]);

  const totalBet = chips.reduce((s, c) => s + c.amount, 0);
  const canSpin = !spinning && !busy && totalBet > 0 && (balance ?? 0) >= totalBet && !!user;

  const buildBets = (): Bet[] => chips.map((c) => ({ type: c.type, selection: c.selection, amount: c.amount }));

  const handleErr = (err: string, detail?: string) => {
    if (err === 'insufficient_balance') setError(t('games.roulette.errInsufficientBalance'));
    else if (err === 'invalid_bet') setError(detail ? t('games.roulette.errInvalidBetWithDetail', { detail }) : t('games.roulette.errInvalidBet'));
    else if (err === 'game_disabled') setError(t('games.roulette.errGameDisabled'));
    else if (err === 'spin_failed') setError(t('games.roulette.errSpinFailed'));
    else setError(t('games.roulette.errGeneric'));
    life.timeout(() => setError(null), 3500);
  };

  // Landing rotation for a number (verified: pocket idx aligns under the top pointer)
  const computeTarget = (num: SlotNum, prevRot: number) => {
    const order = wheel === 'american' ? AM_ORDER : EU_ORDER;
    const idx = order.findIndex((v) => v === num);
    if (idx < 0) return prevRot;
    const perPocket = 360 / order.length;
    const target = -idx * perPocket;
    const spinsBase = 6 * 360;
    const cur = prevRot % 360;
    let delta = (target - cur) % 360;
    if (delta > 0) delta -= 360;
    return prevRot + spinsBase + delta;
  };

  const doSpin = useCallback(async () => {
    if (inFlight.current) return;
    if (!canSpin) return;
    inFlight.current = true;
    const epoch = ++spinEpoch.current;
    setBusy(true);
    setSpinning(true);
    setError(null);
    setResult(null);
    setWinKeys(new Set());
    setHalfBackKeys(new Set());
    if (wheelVisualRef.current) wheelVisualRef.current.style.willChange = 'transform';
    if (ballVisualRef.current) ballVisualRef.current.style.willChange = 'transform';

    const startRot = wheelRotationRef.current;
    let idleLastFrame = performance.now();
    let idleElapsed = 0;
    let idleRaf: number | null = null;
    let resolved = false;
    let landed = false;

    const scheduleIdle = () => {
      if (!landed && !resolved && !life.isHidden() && idleRaf === null) idleRaf = life.raf(animateIdle);
    };
    const animateIdle = (t: number) => {
      idleRaf = null;
      if (landed || resolved) return;
      if (life.isHidden()) return;
      idleElapsed += Math.max(0, t - idleLastFrame);
      idleLastFrame = t;
      setWheelVisuals(startRot + idleElapsed * (reducedFx ? 0.35 : 0.6), -idleElapsed * (reducedFx ? 0.5 : 0.9));
      scheduleIdle();
    };
    const stopIdleVisibility = life.onVisibilityChange((hidden) => {
      if (hidden) {
        life.cancelRaf(idleRaf);
        idleRaf = null;
      } else {
        idleLastFrame = performance.now();
        scheduleIdle();
      }
    });
    const stopIdleAnimation = () => {
      resolved = true;
      life.cancelRaf(idleRaf);
      idleRaf = null;
      stopIdleVisibility();
    };
    scheduleIdle();

    try {
      const seed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.spinRoulette({
        bets: buildBets(),
        wheel,
        clientSeed: seed,
      });
      stopIdleAnimation();

      if (!life.isMounted() || epoch !== spinEpoch.current) return;

      if (!resp?.ok) {
        landed = true;
        retireWillChange();
        setSpinning(false);
        setBusy(false);
        inFlight.current = false;
        handleErr(resp?.error ?? 'spin_failed', resp?.detail);
        return;
      }

      const liveWheel = wheelRotationRef.current;
      const liveBall = ballRotationRef.current;
      const targetRot = computeTarget(resp.result.number as SlotNum, liveWheel);
      const dur = reducedFx ? 1200 : 4200;
      const fromRot = liveWheel;
      const fromBall = liveBall;
      // Ball must finish exactly at the top pointer: drop the current partial
      // turn, then add whole reverse turns so it settles on a multiple of 360.
      const ballRemainder = ((fromBall % 360) + 360) % 360;
      const ballTarget = fromBall - ballRemainder - 360 * (reducedFx ? 1 : 4);
      let landElapsed = 0;
      let landLastFrame = performance.now();
      let landRaf: number | null = null;
      let stopLandVisibility = () => {};

      const settle = () => {
        if (!life.isMounted() || epoch !== spinEpoch.current || landed) return;
        landed = true;
        life.cancelRaf(landRaf);
        landRaf = null;
        stopLandVisibility();
        retireWillChange();
        setWheelVisuals(targetRot, ballTarget);
        const sr: SpinResult = {
          number: resp.result.number,
          color: resp.result.color,
          bets: resp.bets ?? [],
          totalBet: resp.totalBet ?? totalBet,
          totalPayout: resp.totalPayout ?? 0,
          net: resp.net ?? 0,
        };
        setResult(sr);
        play('reelStop');
        if (sr.net > 0) play('win');
        else if (sr.net < 0) play('lose');
        const wins = new Set<string>();
        const halfBacks = new Set<string>();
        sr.bets.forEach((b) => {
          if (b.won) wins.add(keyFor(b.type, b.selection));
          if (b.halfBack) halfBacks.add(keyFor(b.type, b.selection));
        });
        setWinKeys(wins);
        setHalfBackKeys(halfBacks);
        if (sr.net > 0) {
          setCelebrate(true);
          life.timeout(() => setCelebrate(false), reducedFx ? 900 : 2400);
        }
        setSpinning(false);
        setBusy(false);
        inFlight.current = false;
        // Keep an immutable copy of the settled felt so won/lost colouring
        // survives clearing the spent chips.
        setSettledChips(chips.map((c) => ({ ...c })));
        setPlacements([]);
        // Spin is disabled with an empty felt: land the remote on the chip
        // denomination so the next wager starts under the D-pad.
        setFocusId(`denom-${denomRef.current}`);
      };

      const scheduleLand = () => {
        if (!landed && !life.isHidden() && landRaf === null) landRaf = life.raf(land);
      };
      const land = (t: number) => {
        landRaf = null;
        if (landed || life.isHidden()) return;
        landElapsed += Math.max(0, t - landLastFrame);
        landLastFrame = t;
        const p = Math.min(1, landElapsed / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        setWheelVisuals(fromRot + (targetRot - fromRot) * eased, fromBall + (ballTarget - fromBall) * eased);
        if (p < 1) scheduleLand();
        else settle();
      };
      stopLandVisibility = life.onVisibilityChange((hidden) => {
        if (hidden) {
          life.cancelRaf(landRaf);
          landRaf = null;
        } else {
          landLastFrame = performance.now();
          scheduleLand();
        }
      });
      scheduleLand();
    } catch {
      stopIdleAnimation();
      if (!life.isMounted() || epoch !== spinEpoch.current) return;
      retireWillChange();
      setSpinning(false);
      setBusy(false);
      inFlight.current = false;
      setError(t('games.roulette.errUnreachable'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSpin, wheel, chips, totalBet, setWheelVisuals, reducedFx, life, play, retireWillChange]);

  // OK/Select: exactly one activation per press, repeats swallowed until keyup.
  useTvActivate(activateFocused);

  /**
   * Shared wager-safe Back guard: a spin in flight keeps the player on the
   * table, and only a settled/idle table can leave.
   */
  const { requestBack } = useGameBack({
    isBusy: () => spinning || busy || inFlight.current,
    onBlocked: () => {
      setBackNote(t('games.shared.finishSpinFirst'));
      life.timeout(() => setBackNote(null), 2600);
    },
    onExit: onBack,
  });

  /**
   * D-pad + per-cell chip decrement. Back is owned by the shared guard above,
   * and a global modal owns input outright. Every arrow is consumed while the
   * table is on screen — even at the edge of the board — so the native WebView
   * cannot spatially navigate off the single data-tv-focused marker.
   */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isGlobalModalOpen()) return;
      if (isBackKey(e)) return;
      if (e.key === 'Backspace' || e.key === '-' || e.key === 'Subtract') {
        const bet = cellBets.current.get(focusId);
        if (bet) { e.preventDefault(); decrementChipOn(bet.type, bet.selection); return; }
      }
      const dir = visualArrowDir(e);
      if (!dir) return;
      e.preventDefault();
      moveFocus(dir);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [focusId, moveFocus, decrementChipOn]);

  // If total bet exceeds balance, move focus to Undo so the fix is under the remote.
  useEffect(() => {
    if (!spinning && balance !== null && totalBet > balance && chips.length > 0) {
      setFocusId('undo');
    }
  }, [totalBet, balance, spinning, chips.length]);

  // Switching wheel starts a fresh wager: drop '00' chips, the old result and
  // its settled snapshot, then re-home focus.
  useEffect(() => {
    setResult(null);
    setWinKeys(new Set());
    setHalfBackKeys(new Set());
    setSettledChips([]);
    if (wheel !== 'european') return;
    setPlacements((prev) => prev.filter((p) => !(p.type === 'straight' && p.selection === '00')));
    setFocusId((current) => (current === 'num-00' ? 'num-0' : current));
  }, [wheel]);

  // Draw wheel from the rendered TV slot. Resize only redraws the static
  // bitmap; the bounded spin itself remains transform-only.
  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const order = wheel === 'american' ? AM_ORDER : EU_ORDER;
    const dpr = Math.min(window.devicePixelRatio || 1, reducedFx ? 1 : 2);
    const measured = wheelMeasureRef.current?.clientWidth
      || wheelMeasureRef.current?.getBoundingClientRect().width
      || 0;
    const size = Math.max(210, Math.round(measured || 340));
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2, cy = size / 2;
    const rCase = size / 2 - Math.max(3, size * 0.01);
    const rOuter = rCase - size * 0.065;
    const rInner = rOuter - Math.max(32, size * 0.145);
    const n = order.length;
    const seg = (Math.PI * 2) / n;
    const startOffset = -Math.PI / 2 - seg / 2;

    const caseGrad = ctx.createRadialGradient(cx - size * 0.12, cy - size * 0.16, size * 0.03, cx, cy, rCase);
    caseGrad.addColorStop(0, '#fff1b0');
    caseGrad.addColorStop(0.28, '#c9942e');
    caseGrad.addColorStop(0.58, '#51300b');
    caseGrad.addColorStop(0.76, '#e1b74e');
    caseGrad.addColorStop(1, '#241504');
    ctx.beginPath();
    ctx.arc(cx, cy, rCase, 0, Math.PI * 2);
    ctx.fillStyle = caseGrad;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, rOuter + size * 0.022, 0, Math.PI * 2);
    ctx.fillStyle = '#130c08';
    ctx.fill();

    for (let i = 0; i < n; i++) {
      const a0 = startOffset + i * seg;
      const a1 = a0 + seg;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a0) * rInner, cy + Math.sin(a0) * rInner);
      ctx.arc(cx, cy, rOuter, a0, a1);
      ctx.arc(cx, cy, rInner, a1, a0, true);
      ctx.closePath();
      const col = colorOf(order[i]);
      const pocketGrad = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
      if (col === 'red') {
        pocketGrad.addColorStop(0, '#5c0c1d');
        pocketGrad.addColorStop(0.62, '#c3223d');
        pocketGrad.addColorStop(1, '#681022');
      } else if (col === 'black') {
        pocketGrad.addColorStop(0, '#111b27');
        pocketGrad.addColorStop(0.62, '#25364a');
        pocketGrad.addColorStop(1, '#080d13');
      } else {
        pocketGrad.addColorStop(0, '#075c3c');
        pocketGrad.addColorStop(0.62, '#15945f');
        pocketGrad.addColorStop(1, '#06402b');
      }
      ctx.fillStyle = pocketGrad;
      ctx.fill();
      ctx.lineWidth = Math.max(1, size * 0.004);
      ctx.strokeStyle = 'rgba(255,221,139,0.66)';
      ctx.stroke();
      const mid = a0 + seg / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * (rOuter - Math.max(13, size * 0.048)), cy + Math.sin(mid) * (rOuter - Math.max(13, size * 0.048)));
      ctx.rotate(mid + Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.max(9, Math.round(size * 0.033))}px Montserrat, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(order[i]), 0, 0);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(4, size * 0.014);
    ctx.strokeStyle = '#f6d579';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, rInner - size * 0.018, 0, Math.PI * 2);
    const bowl = ctx.createRadialGradient(cx - size * 0.09, cy - size * 0.1, size * 0.02, cx, cy, rInner);
    bowl.addColorStop(0, '#f8df91');
    bowl.addColorStop(0.16, '#ad7622');
    bowl.addColorStop(0.25, '#17253a');
    bowl.addColorStop(0.7, '#071424');
    bowl.addColorStop(1, '#98661d');
    ctx.fillStyle = bowl;
    ctx.fill();
    ctx.strokeStyle = '#d8aa43';
    ctx.lineWidth = Math.max(2, size * 0.009);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.1, 0, Math.PI * 2);
    const hub = ctx.createRadialGradient(cx - size * 0.025, cy - size * 0.03, 1, cx, cy, size * 0.1);
    hub.addColorStop(0, '#fff0af');
    hub.addColorStop(0.5, '#d09a31');
    hub.addColorStop(1, '#53300a');
    ctx.fillStyle = hub;
    ctx.fill();
    ctx.lineWidth = Math.max(2, size * 0.008);
    ctx.strokeStyle = '#f5d36e';
    ctx.stroke();
  }, [wheel, reducedFx]);

  useEffect(() => {
    drawWheel();
    const target = wheelMeasureRef.current;
    let observer: ResizeObserver | null = null;
    let queued = 0;
    const redraw = () => {
      window.cancelAnimationFrame(queued);
      queued = window.requestAnimationFrame(drawWheel);
    };
    if (target && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(redraw);
      observer.observe(target);
    }
    window.addEventListener('resize', redraw);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', redraw);
      window.cancelAnimationFrame(queued);
    };
  }, [drawWheel]);

  // ----- Render helpers -----
  /** After a settle the spent chips are gone, so the board shows the snapshot. */
  const boardChips = chips.length > 0 ? chips : settledChips;
  const chipAt = (type: BetType, selection: BetSelection): PlacedChip | undefined =>
    boardChips.find((c) => c.key === keyFor(type, selection));
  const winFor = (type: BetType, selection: BetSelection) => winKeys.has(keyFor(type, selection));
  const halfBackFor = (type: BetType, selection: BetSelection) => halfBackKeys.has(keyFor(type, selection));

  /**
   * Plain render function (NOT a component created during render): it returns
   * the stable module-level RouletteCell, so memoization actually holds and
   * cells never unmount while moving focus or placing chips.
   */
  const cell = (props: Omit<RouletteCellProps, 'placed' | 'won' | 'lost' | 'spinning' | 'focused' | 'register' | 'onFocus' | 'onPlace'>) => {
    const placed = chipAt(props.type, props.selection);
    const won = !!placed && !!result && winFor(props.type, props.selection);
    const halfBack = !!placed && !!result && halfBackFor(props.type, props.selection);
    return (
      <RouletteCell
        {...props}
        key={props.id}
        placed={placed}
        won={won}
        halfBack={halfBack}
        lost={!!placed && !!result && !won && !halfBack}
        spinning={spinning}
        focused={focusId === props.id}
        register={registerCell}
        onFocus={setFocusId}
        onPlace={placeChipOn}
      />
    );
  };

  const gridNumbers = useMemo(() => {
    const rows: number[][] = [];
    for (let r = 0; r < 3; r++) {
      const row: number[] = [];
      for (let c = 0; c < 12; c++) row.push(c * 3 + (3 - r));
      rows.push(row);
    }
    return rows;
  }, []);

  return (
    <main className="snow-casino snow-casino--ruby tv-game-shell snow-wheels-game snow-roulette-game" data-game-accent="ruby">
      <div className="snow-casino__aurora" aria-hidden="true" /><div className="snow-casino__vignette" aria-hidden="true" />
      <div className="tv-game-body snow-game-body">
        <GameTopBar
          ref={registerFocus('back')}
          onBack={requestBack}
          backLabel={t('games.roulette.back')}
          balance={balance}
          status={status}
          title={t('games.roulette.placeYourBets')}
          phase={spinning ? t('games.roulette.spinning') : `${wheel === 'european' ? t('games.roulette.wheelEuropean') : t('games.roulette.wheelAmerican')} · ${totalBet.toLocaleString()}`}
          backFocused={focusId === 'back'}
          onBackFocus={() => setFocusId('back')}
          reducedFx={reducedFx}
          onToggleFx={toggleReducedFx}
          fxRef={registerFocus('fx')}
          fxFocused={focusId === 'fx'}
          onFxFocus={() => setFocusId('fx')}
        />

        {/* Landscape TV surface: sculpted wheel left, readable felt and console right. */}
        <div className="snow-rl-layout">
          <aside className="snow-rl-side">
            <header className="snow-rl-side__header">
              <span aria-hidden="true"><Gem /></span>
              <div><small>{t('games.roulette.wheel')}</small><strong>SMC ROULETTE</strong></div>
            </header>

            <div className="snow-rl-wheel-shell">
              <div className="snow-rl-wheel-wrap">
                <span className="snow-rl-pointer" aria-hidden="true"><i /></span>
                <div ref={wheelMeasureRef} className="snow-rl-wheel">
                <div ref={wheelVisualRef} className="snow-rl-wheel-visual"><canvas ref={canvasRef} className="block" /></div>
                <div ref={ballVisualRef} className="snow-rl-ball-track" aria-hidden="true"><span className="snow-rl-ball" /></div>
                  <span className="snow-rl-wheel-hub" aria-hidden="true"><Gem /><b>SMC</b></span>
                </div>
              </div>
              <div className="snow-rl-wheel-caption" aria-hidden="true"><span /> <b>SNOW CASINO</b> <span /></div>
            </div>

            {result ? (
              <div className={`snow-rl-callout snow-rl-callout--${result.color}`} role="status" aria-live="polite">
                <span className="snow-rl-callout__icon" aria-hidden="true"><Trophy /></span>
                <strong>{result.number}</strong>
                <span><small>{t('games.roulette.payoutChips', { amount: result.totalPayout.toLocaleString() })}</small>
                <em className={result.net > 0 ? 'is-up' : result.net < 0 ? 'is-down' : ''}>{result.net > 0 ? '+' : ''}{result.net.toLocaleString()}</em>
                </span>
              </div>
            ) : (
              <div className="snow-rl-callout snow-rl-callout--idle" aria-hidden="true">
                <span className="snow-rl-callout__icon"><CircleDot /></span>
                <span><small>{t('games.roulette.placeYourBets')}</small><em>{wheel === 'european' ? t('games.roulette.wheelEuropean') : t('games.roulette.wheelAmerican')}</em></span>
              </div>
            )}

            <div className="snow-rl-wheelkind">
              <span className="snow-rl-label">{t('games.roulette.wheel')}</span>
              <div className="snow-rl-wheelkind__row">
                {(['european', 'american'] as WheelKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    ref={registerFocus(`wheel-${k}`)}
                    onFocus={() => setFocusId(`wheel-${k}`)}
                    onClick={() => { if (!spinning) setWheel(k); }}
                    aria-disabled={spinning ? 'true' : undefined}
                    aria-pressed={wheel === k}
                    data-tv-focused={focusId === `wheel-${k}` ? 'true' : 'false'}
                    className={`snow-rl-toggle ${wheel === k ? 'is-active' : ''}`}
                  >
                    {k === 'european' ? t('games.roulette.wheelEuropean') : t('games.roulette.wheelAmerican')}
                  </button>
                ))}
              </div>
              <p className={`snow-rl-friendly-rule${wheel === 'european' ? ' is-active' : ''}`}>
                {wheel === 'european'
                  ? 'SNOW RULE · half back on even-money bets when 0 lands · 98.65% return'
                  : 'Classic double-zero wheel · 94.74% return'}
              </p>
            </div>
          </aside>

          <section className="snow-rl-main">
            <header className="snow-rl-table-head">
              <div className="snow-rl-table-head__title">
                <span aria-hidden="true"><CircleDot /></span>
                <div><small>{wheel === 'european' ? t('games.roulette.wheelEuropean') : t('games.roulette.wheelAmerican')}</small><strong>{t('games.roulette.placeYourBets')}</strong></div>
              </div>
              <div className="snow-rl-table-head__wager">
                <Coins aria-hidden="true" /><span><small>{t('games.roulette.totalBet')}</small><strong>{totalBet.toLocaleString()}</strong></span>
              </div>
            </header>
            <div className="snow-rl-felt">
              <div className="snow-rl-felt__brand" aria-hidden="true"><Gem /><span>SMC</span></div>
              <div className="snow-rl-board">
                <div className="snow-rl-zeros">
                  {wheel === 'american' ? (
                    <>
                      {cell({ id: 'num-0', type: 'straight', selection: 0, color: 'green', className: 'snow-rl-zero', children: '0' })}
                      {cell({ id: 'num-00', type: 'straight', selection: '00', color: 'green', className: 'snow-rl-zero', children: '00' })}
                    </>
                  ) : (
                    cell({ id: 'num-0', type: 'straight', selection: 0, color: 'green', className: 'snow-rl-zero snow-rl-zero--tall', children: '0' })
                  )}
                </div>

                <div className="snow-rl-numbers">
                  {gridNumbers.flatMap((row) => row.map((n) => cell({
                    id: `num-${n}`,
                    type: 'straight',
                    selection: n,
                    color: isRed(n) ? 'red' : 'black',
                    className: 'snow-rl-num',
                    label: String(n),
                    children: n,
                  })))}
                </div>

                <div className="snow-rl-cols">
                  {[3, 2, 1].map((col) => cell({
                    id: `col-${col}`,
                    type: 'column',
                    selection: col,
                    color: 'neutral',
                    className: 'snow-rl-col',
                    children: t('games.roulette.columnPayout'),
                  }))}
                </div>
              </div>

              <div className="snow-rl-dozens">
                {[1, 2, 3].map((d) => cell({
                  id: `dozen-${d}`,
                  type: 'dozen',
                  selection: d,
                  color: 'neutral',
                  className: 'snow-rl-outside',
                  children: d === 1 ? t('games.roulette.dozenFirst') : d === 2 ? t('games.roulette.dozenSecond') : t('games.roulette.dozenThird'),
                }))}
              </div>

              <div className="snow-rl-evens">
                {cell({ id: 'bet-low', type: 'low', selection: null, color: 'neutral', className: 'snow-rl-outside', children: t('games.roulette.betLow') })}
                {cell({ id: 'bet-even', type: 'even', selection: null, color: 'neutral', className: 'snow-rl-outside', children: t('games.roulette.betEven') })}
                {cell({ id: 'bet-red', type: 'red', selection: null, color: 'red', className: 'snow-rl-outside', children: t('games.roulette.betRed') })}
                {cell({ id: 'bet-black', type: 'black', selection: null, color: 'black', className: 'snow-rl-outside', children: t('games.roulette.betBlack') })}
                {cell({ id: 'bet-odd', type: 'odd', selection: null, color: 'neutral', className: 'snow-rl-outside', children: t('games.roulette.betOdd') })}
                {cell({ id: 'bet-high', type: 'high', selection: null, color: 'neutral', className: 'snow-rl-outside', children: t('games.roulette.betHigh') })}
              </div>
            </div>

            <div className="snow-rl-console">
              <div className="snow-rl-controls">
                <div className="snow-rl-denoms">
                  <span className="snow-rl-label"><Coins aria-hidden="true" /> {t('games.roulette.chipInHand')}</span>
                  <div className="snow-rl-denoms__row">
                    {DENOMS.map((d) => (
                      <button
                        key={d}
                        type="button"
                        ref={registerFocus(`denom-${d}`)}
                        onFocus={() => setFocusId(`denom-${d}`)}
                        onClick={() => { if (!spinning) setDenom(d); }}
                        aria-disabled={spinning ? 'true' : undefined}
                        aria-pressed={denom === d}
                        data-tv-focused={focusId === `denom-${d}` ? 'true' : 'false'}
                        className={`snow-rl-denom ${denom === d ? 'is-active' : ''}`}
                      >
                        <span>{d}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="snow-rl-total">
                  <small>{t('games.roulette.totalBet')}</small>
                  <strong>{totalBet.toLocaleString()}</strong>
                </div>

                <div className="snow-rl-actions">
                  <Button
                    ref={registerFocus('undo')}
                    onFocus={() => setFocusId('undo')}
                    onClick={undoLast}
                    aria-disabled={spinning || placements.length === 0 ? 'true' : undefined}
                    data-tv-focused={focusId === 'undo' ? 'true' : 'false'}
                    variant="navy"
                    className="snow-game-action"
                  >
                    <Undo2 aria-hidden="true" /> {t('games.roulette.undo')}
                  </Button>
                  <Button
                    ref={registerFocus('clear')}
                    onFocus={() => setFocusId('clear')}
                    onClick={clearBets}
                    aria-disabled={spinning || chips.length === 0 ? 'true' : undefined}
                    data-tv-focused={focusId === 'clear' ? 'true' : 'false'}
                    variant="navy"
                    className="snow-game-action"
                  >
                    <Trash2 aria-hidden="true" /> {t('games.roulette.clearBets')}
                  </Button>
                  <Button
                    ref={registerFocus('spin')}
                    onFocus={() => setFocusId('spin')}
                    onClick={() => { if (canSpin) void doSpin(); }}
                    aria-disabled={canSpin ? undefined : 'true'}
                    data-tv-focused={focusId === 'spin' ? 'true' : 'false'}
                    className="snow-game-action snow-rl-spin"
                  >
                    {spinning ? <><Loader2 className="animate-spin" /> {t('games.roulette.spinning')}</> : <><RotateCw aria-hidden="true" /> {t('games.roulette.spin')}</>}
                  </Button>
                </div>
              </div>

              <div className="snow-rl-console__status">
                {balance !== null && totalBet > balance && chips.length > 0 && (
                  <p className="snow-rl-note">{t('games.roulette.betExceedsBalance')}</p>
                )}
                {balance === null && <p className="snow-rl-note">{t('games.roulette.loadingChips')}</p>}
                {error && <p className="snow-rl-error" role="status">{error}</p>}
                {backNote && <p className="snow-rl-note" role="status">{backNote}</p>}
              </div>
            </div>
          </section>
        </div>
      </div>
      <GameFxCanvas burstKey={celebrate && result ? String(result.number) : null} reduced={reducedFx} />
    </main>
  );
};

export default Roulette;
