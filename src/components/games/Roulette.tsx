import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Loader2, Check, Trash2 } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import { GameTopBar } from './shared/GameUI';
import { GameFxCanvas } from './shared/GameFxCanvas';
import { useGameLifecycle } from './shared/gameLifecycle';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { isBackKey, useGameBack } from './shared/gameBack';
import { arrowDir, isGlobalModalOpen } from './shared/gameInput';

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
interface FairInfo { serverSeedHash: string; serverSeed: string; clientSeed: string; nonce: number }
interface SpinResult {
  number: SlotNum;
  color: 'red' | 'black' | 'green';
  bets: { type: BetType; selection: BetSelection; amount: number; won: boolean; payout: number }[];
  totalBet: number;
  totalPayout: number;
  net: number;
}

const keyFor = (type: BetType, selection: BetSelection) =>
  `${type}:${selection === null || selection === undefined ? '_' : Array.isArray(selection) ? selection.join(',') : String(selection)}`;

interface RouletteCellProps {
  id: string; label?: string; type: BetType; selection: BetSelection;
  color: 'red' | 'black' | 'green' | 'neutral'; className?: string;
  children?: React.ReactNode; placed?: PlacedChip; won?: boolean; lost?: boolean;
  spinning: boolean; focused: boolean;
  register: (id: string, el: HTMLButtonElement | null, bet: { type: BetType; selection: BetSelection }) => void;
  onFocus: (id: string) => void; onPlace: (type: BetType, selection: BetSelection) => void;
}

/**
 * Module-scope, memoized betting cell. It is rendered directly (never wrapped
 * in a component created during render) so D-pad moves and chip placements
 * only re-render the affected cells instead of remounting the whole board.
 */
export const RouletteCell = memo(({ id, label, type, selection, color, className = '', children, placed, won, lost, spinning, focused, register, onFocus, onPlace }: RouletteCellProps) => {
  const bg = color === 'red' ? 'snow-rl-cell--red' : color === 'black' ? 'snow-rl-cell--black' : color === 'green' ? 'snow-rl-cell--green' : 'snow-rl-cell--neutral';
  return (
    <button
      type="button"
      ref={(el) => register(id, el, { type, selection })}
      onFocus={() => onFocus(id)}
      onClick={() => { if (!spinning) onPlace(type, selection); }}
      aria-disabled={spinning ? 'true' : undefined}
      data-tv-focused={focused ? 'true' : 'false'}
      className={`snow-rl-cell ${bg} ${className} ${won ? 'is-won' : ''} ${lost ? 'is-lost' : ''}`}
      aria-label={label || String(selection)}
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

  const [wheel, setWheel] = useState<WheelKind>('european');
  const [denom, setDenom] = useState<number>(10);
  // Single source of truth: every chip physically placed, newest last.
  const [placements, setPlacements] = useState<ChipPlacement[]>([]);
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [serverSeedHash, setServerSeedHash] = useState<string>('');
  const [result, setResult] = useState<SpinResult | null>(null);
  const [winKeys, setWinKeys] = useState<Set<string>>(new Set());
  const [celebrate, setCelebrate] = useState(false);
  const [fair, setFair] = useState<FairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);
  const [verifyOk, setVerifyOk] = useState<boolean | null>(null);
  const [backNote, setBackNote] = useState<string | null>(null);
  /**
   * Immutable copy of the chips that were on the felt when the wheel settled.
   * Live placements are cleared on settle (the wager is spent), so the board
   * colours won/lost cells from this snapshot until the next wager.
   */
  const [settledChips, setSettledChips] = useState<PlacedChip[]>([]);

  // Wheel animation
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
    setFair(null);
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
    setBusy(true);
    setSpinning(true);
    setError(null);
    setResult(null);
    setWinKeys(new Set());
    setFair(null);
    setShowFair(false);
    setVerifyOk(null);
    setServerSeedHash('');
    if (wheelVisualRef.current) wheelVisualRef.current.style.willChange = 'transform';
    if (ballVisualRef.current) ballVisualRef.current.style.willChange = 'transform';

    const startRot = wheelRotationRef.current;
    let animStart = performance.now();
    let pausedAt: number | null = null;
    let elapsedBase = 0;
    let idleRaf: number | null = null;
    let resolved = false;
    let landed = false;

    const animateIdle = (t: number) => {
      if (landed || resolved) return;
      if (life.isHidden()) {
        // Pause visual work only; the spin request is untouched.
        if (pausedAt === null) { pausedAt = t; elapsedBase += t - animStart; }
        idleRaf = life.raf(animateIdle);
        return;
      }
      if (pausedAt !== null) { animStart = t; pausedAt = null; }
      const elapsed = elapsedBase + (t - animStart);
      setWheelVisuals(startRot + elapsed * (reducedFx ? 0.35 : 0.6), -elapsed * (reducedFx ? 0.5 : 0.9));
      idleRaf = life.raf(animateIdle);
    };
    idleRaf = life.raf(animateIdle);

    try {
      const seed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.spinRoulette({
        bets: buildBets(),
        wheel,
        clientSeed: seed,
      });
      resolved = true;
      life.cancelRaf(idleRaf);

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
      let landStart = performance.now();
      const dur = reducedFx ? 1200 : 4200;
      const fromRot = liveWheel;
      const fromBall = liveBall;
      // Ball must finish exactly at the top pointer: drop the current partial
      // turn, then add whole reverse turns so it settles on a multiple of 360.
      const ballRemainder = ((fromBall % 360) + 360) % 360;
      const ballTarget = fromBall - ballRemainder - 360 * (reducedFx ? 1 : 4);
      let landPaused: number | null = null;
      let landElapsed = 0;

      const settle = () => {
        landed = true;
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
        const wins = new Set<string>();
        sr.bets.forEach((b) => { if (b.won) wins.add(keyFor(b.type, b.selection)); });
        setWinKeys(wins);
        if (sr.net > 0) {
          setCelebrate(true);
          life.timeout(() => setCelebrate(false), reducedFx ? 900 : 2400);
        }
        if (resp.fair) {
          setFair(resp.fair);
          setServerSeedHash(resp.fair.serverSeedHash);
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

      const land = (t: number) => {
        if (life.isHidden()) {
          if (landPaused === null) { landPaused = t; landElapsed += t - landStart; }
          life.raf(land);
          return;
        }
        if (landPaused !== null) { landStart = t; landPaused = null; }
        const p = Math.min(1, (landElapsed + (t - landStart)) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        setWheelVisuals(fromRot + (targetRot - fromRot) * eased, fromBall + (ballTarget - fromBall) * eased);
        if (p < 1) life.raf(land);
        else settle();
      };
      life.raf(land);
    } catch {
      life.cancelRaf(idleRaf);
      retireWillChange();
      setSpinning(false);
      setBusy(false);
      inFlight.current = false;
      setError(t('games.roulette.errUnreachable'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSpin, wheel, chips, totalBet, setWheelVisuals, reducedFx, life, retireWillChange]);

  // OK/Select: exactly one activation per press, repeats swallowed until keyup.
  useTvActivate(activateFocused);

  /**
   * Shared wager-safe Back guard: fairness closes first, a spin in flight keeps
   * the player on the table, and only a settled/idle table can leave.
   */
  const { requestBack } = useGameBack({
    isDetailsOpen: () => showFair,
    closeDetails: () => setShowFair(false),
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
      const dir = arrowDir(e);
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
    setSettledChips([]);
    if (wheel !== 'european') return;
    setPlacements((prev) => prev.filter((p) => !(p.type === 'straight' && p.selection === '00')));
    setFocusId((current) => (current === 'num-00' ? 'num-0' : current));
  }, [wheel]);

  // Draw wheel, sized from the rendered container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const order = wheel === 'american' ? AM_ORDER : EU_ORDER;
    const dpr = Math.min(window.devicePixelRatio || 1, reducedFx ? 1 : 2);
    const measured = canvas.parentElement?.getBoundingClientRect().width ?? 0;
    const size = Math.max(180, Math.round(measured || 300));
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2, cy = size / 2;
    const rOuter = size / 2 - 6;
    const rInner = rOuter - Math.max(26, size * 0.12);
    const n = order.length;
    const seg = (Math.PI * 2) / n;
    const startOffset = -Math.PI / 2 - seg / 2;
    for (let i = 0; i < n; i++) {
      const a0 = startOffset + i * seg;
      const a1 = a0 + seg;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a0) * rInner, cy + Math.sin(a0) * rInner);
      ctx.arc(cx, cy, rOuter, a0, a1);
      ctx.arc(cx, cy, rInner, a1, a0, true);
      ctx.closePath();
      const col = colorOf(order[i]);
      ctx.fillStyle = col === 'red' ? '#b91c1c' : col === 'black' ? '#0a0a0a' : '#15803d';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(251,191,36,0.4)';
      ctx.stroke();
      const mid = a0 + seg / 2;
      ctx.save();
      ctx.translate(cx + Math.cos(mid) * (rOuter - Math.max(11, size * 0.045)), cy + Math.sin(mid) * (rOuter - Math.max(11, size * 0.045)));
      ctx.rotate(mid + Math.PI / 2);
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${Math.max(8, Math.round(size * 0.031))}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(order[i]), 0, 0);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#fbbf24';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, rInner - 6, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(cx - 10, cy - 10, 4, cx, cy, rInner);
    grad.addColorStop(0, '#fde68a');
    grad.addColorStop(1, '#78350f');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [wheel, reducedFx]);

  // SHA-256 verify
  useEffect(() => {
    if (!showFair || !fair) return;
    let cancelled = false;
    (async () => {
      try {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fair.serverSeed));
        const hex = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
        if (!cancelled) setVerifyOk(hex.toLowerCase() === (fair.serverSeedHash || '').toLowerCase());
      } catch { if (!cancelled) setVerifyOk(false); }
    })();
    return () => { cancelled = true; };
  }, [showFair, fair]);

  // ----- Render helpers -----
  /** After a settle the spent chips are gone, so the board shows the snapshot. */
  const boardChips = chips.length > 0 ? chips : settledChips;
  const chipAt = (type: BetType, selection: BetSelection): PlacedChip | undefined =>
    boardChips.find((c) => c.key === keyFor(type, selection));
  const winFor = (type: BetType, selection: BetSelection) => winKeys.has(keyFor(type, selection));

  /**
   * Plain render function (NOT a component created during render): it returns
   * the stable module-level RouletteCell, so memoization actually holds and
   * cells never unmount while moving focus or placing chips.
   */
  const cell = (props: Omit<RouletteCellProps, 'placed' | 'won' | 'lost' | 'spinning' | 'focused' | 'register' | 'onFocus' | 'onPlace'>) => {
    const placed = chipAt(props.type, props.selection);
    const won = !!placed && !!result && winFor(props.type, props.selection);
    return (
      <RouletteCell
        {...props}
        key={props.id}
        placed={placed}
        won={won}
        lost={!!placed && !!result && !won}
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
    <main className="snow-casino snow-casino--ruby tv-game-shell" data-game-accent="ruby">
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

        {/* Landscape TV surface: wheel + summary left, board + controls right */}
        <div className="snow-rl-layout">
          <aside className="snow-rl-side">
            <div className="snow-rl-wheel-wrap">
              <span className="snow-rl-pointer" aria-hidden="true" />
              <div className="snow-rl-wheel">
                <div ref={wheelVisualRef} className="snow-rl-wheel-visual"><canvas ref={canvasRef} className="block" /></div>
                <div ref={ballVisualRef} className="snow-rl-ball-track" aria-hidden="true"><span className="snow-rl-ball" /></div>
              </div>
            </div>

            {result && (
              <div className={`snow-rl-callout snow-rl-callout--${result.color}`} role="status" aria-live="polite">
                <strong>{result.number}</strong>
                <span>{t('games.roulette.payoutChips', { amount: result.totalPayout.toLocaleString() })}</span>
                <em className={result.net > 0 ? 'is-up' : result.net < 0 ? 'is-down' : ''}>{result.net > 0 ? '+' : ''}{result.net.toLocaleString()}</em>
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
            </div>
          </aside>

          <section className="snow-rl-main">
            <div className="snow-rl-felt">
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

            <div className="snow-rl-controls">
              <div className="snow-rl-denoms">
                <span className="snow-rl-label">{t('games.roulette.chipInHand')}</span>
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
                      {d}
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
                  {t('games.roulette.undo')}
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
                  <Trash2 className="w-4 h-4 mr-2" /> {t('games.roulette.clearBets')}
                </Button>
                <Button
                  ref={registerFocus('spin')}
                  onFocus={() => setFocusId('spin')}
                  onClick={() => { if (canSpin) void doSpin(); }}
                  aria-disabled={canSpin ? undefined : 'true'}
                  data-tv-focused={focusId === 'spin' ? 'true' : 'false'}
                  className="snow-game-action snow-rl-spin"
                >
                  {spinning ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> {t('games.roulette.spinning')}</> : t('games.roulette.spin')}
                </Button>
              </div>
            </div>

            {balance !== null && totalBet > balance && chips.length > 0 && (
              <p className="snow-rl-note">{t('games.roulette.betExceedsBalance')}</p>
            )}
            {balance === null && <p className="snow-rl-note">{t('games.roulette.loadingChips')}</p>}
            {error && <p className="snow-rl-error" role="status">{error}</p>}
            {backNote && <p className="snow-rl-note" role="status">{backNote}</p>}

            {fair && (
              <div className="snow-fairness">
                <button
                  type="button"
                  ref={registerFocus('fair-toggle')}
                  onFocus={() => setFocusId('fair-toggle')}
                  onClick={() => setShowFair((s) => !s)}
                  data-tv-focused={focusId === 'fair-toggle' ? 'true' : 'false'}
                  className="snow-fairness__toggle"
                >
                  {t('games.roulette.provablyFair')}
                </button>
                {showFair && (
                  <div className="snow-fairness__details" role="dialog" aria-label={t('games.roulette.provablyFair')}>
                    <p><b>{t('games.roulette.fairServerSeedHash')}</b> {fair.serverSeedHash}</p>
                    <p><b>{t('games.roulette.fairServerSeed')}</b> {fair.serverSeed}</p>
                    <p><b>{t('games.roulette.fairClientSeed')}</b> {fair.clientSeed}</p>
                    <p><b>{t('games.roulette.fairNonce')}</b> {fair.nonce}</p>
                    <p>
                      <b>{t('games.roulette.fairVerifyLabel')}</b>{' '}
                      {verifyOk === null ? t('games.roulette.fairChecking') : verifyOk
                        ? <span className="snow-fairness__ok"><Check className="w-3 h-3" /> {t('games.roulette.fairMatches')}</span>
                        : t('games.roulette.fairMismatch')}
                    </p>
                  </div>
                )}
              </div>
            )}
            {serverSeedHash && !fair && <p className="snow-rl-seed">{t('games.roulette.seedHash', { hash: serverSeedHash })}</p>}
          </section>
        </div>
      </div>
      <GameFxCanvas burstKey={celebrate && result ? String(result.number) : null} reduced={reducedFx} />
    </main>
  );
};

export default Roulette;
