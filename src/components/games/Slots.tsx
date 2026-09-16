import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Loader2, Minus, Plus, Volume2, VolumeX } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import { GAME_ACTION_CLASS, GamePanel, GameShell, GameTopBar } from './shared/GameUI';
import { GameFxCanvas } from './shared/GameFxCanvas';
import { useGameLifecycle } from './shared/gameLifecycle';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { useGameBack } from './shared/gameBack';
import { isGlobalModalOpen, visualArrowDir } from './shared/gameInput';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { firstUsable, moveInRows, rehome, type FocusDir, type FocusRows } from './shared/focusRows';
import { useGameAudio } from './shared/gameAudio';
import { TV_BETS, readSavedBet, saveSelectedBet } from './shared/gameBets';
import {
  CYCLE_CELLS, MIN_TRAVEL_CELLS, REELS, RENDER_CELLS, ROWS,
  buildCells, computeSettleTarget, cyclePx, gridToColumns, pickLandingIndex,
  validateGrid, visibleSymbolsAt, winningCellsFor, withLanding,
} from './shared/slotsReel';
import p1img from '@/assets/slots/dreamstreams.png';
import p2img from '@/assets/slots/vibez.png';
import p3img from '@/assets/slots/snowmedia.png';
import p4img from '@/assets/slots/smc.png';
import '@/styles/games-machines.css';

interface SlotsProps {
  onBack: () => void;
}

const BETS: number[] = [...TV_BETS];
const BET_STORAGE_KEY = 'snow-slots-bet-v1';

const SYMBOL_IMAGES: Record<string, string | undefined> = { p1: p1img, p2: p2img, p3: p3img, p4: p4img };
const LOW_LETTER: Record<string, string> = { la: 'A', lk: 'K', lq: 'Q', lj: 'J' };
const PREMIUM_SYMBOLS = [
  { key: 'p1', label: 'Dream Streams' },
  { key: 'p2', label: 'Vibez TV' },
  { key: 'p3', label: 'Snow Media' },
  { key: 'p4', label: 'SMC' },
] as const;

/** Rendered nodes per reel: 12 recycled cells plus 3 seamless wrap clones. */
export const SLOTS_RENDER_CELLS = RENDER_CELLS;

const cellHeightFor = (w: number, h: number) => (
  w >= 2500 && h >= 1600 ? 312 : h <= 760 ? 78 : h >= 1000 ? 156 : 96
);

interface SpinResult {
  grid: string[][]; // [row][reel]
  wins: { symbol: string; count: number; ways: number; payout: number }[];
  scatterCount: number;
  totalPayout: number;
  net: number;
  bet: number;
  freeSpin: boolean;
  freeSpinsRemaining: number;
  multiplier: number;
  triggeredFreeSpins: number;
  basePayout: number;
  collectorPayout: number;
  collectors: CollectorState;
}

type CollectorColor = 'red' | 'blue' | 'yellow';
interface CollectorMeter {
  progress: number;
  threshold: number;
  hit: boolean;
  triggered: boolean;
  multiplier: number;
  payout: number;
  sources: { reel: number; row: number }[];
}
type CollectorState = Record<CollectorColor, CollectorMeter>;

const COLLECTOR_COLORS: CollectorColor[] = ['red', 'blue', 'yellow'];
const COLLECTOR_DEFAULTS: CollectorState = {
  red: { progress: 0, threshold: 15, hit: false, triggered: false, multiplier: 0, payout: 0, sources: [] },
  blue: { progress: 0, threshold: 24, hit: false, triggered: false, multiplier: 0, payout: 0, sources: [] },
  yellow: { progress: 0, threshold: 34, hit: false, triggered: false, multiplier: 0, payout: 0, sources: [] },
};

const readCollectors = (value: unknown, fallback: CollectorState = COLLECTOR_DEFAULTS): CollectorState => {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(COLLECTOR_COLORS.map((color) => {
    const raw = source[color] && typeof source[color] === 'object'
      ? source[color] as Record<string, unknown>
      : {};
    const threshold = Number(raw.threshold);
    const safeThreshold = Number.isInteger(threshold) && threshold > 0 ? threshold : fallback[color].threshold;
    const progress = Number(raw.progress);
    return [color, {
      progress: Number.isInteger(progress) ? Math.max(0, Math.min(safeThreshold - 1, progress)) : fallback[color].progress,
      threshold: safeThreshold,
      hit: raw.hit === true,
      triggered: raw.triggered === true,
      multiplier: Number.isFinite(Number(raw.multiplier)) ? Math.max(0, Number(raw.multiplier)) : 0,
      payout: Number.isFinite(Number(raw.payout)) ? Math.max(0, Number(raw.payout)) : 0,
      sources: Array.isArray(raw.sources) ? raw.sources.flatMap((source) => {
        if (!source || typeof source !== 'object') return [];
        const reel = Number((source as Record<string, unknown>).reel);
        const row = Number((source as Record<string, unknown>).row);
        return Number.isInteger(reel) && reel >= 0 && reel < REELS && Number.isInteger(row) && row >= 0 && row < ROWS
          ? [{ reel, row }]
          : [];
      }) : [],
    }];
  })) as CollectorState;
};

function CollectorSigil({ color }: { color: CollectorColor }) {
  if (color === 'red') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <path d="M32 31C17 27 14 14 25 12c3-10 17-8 18 3 11 2 9 16-2 18 3 12-12 18-18 8-11 2-15-11-6-17 2 5 7 8 15 7Z" />
        <path d="M32 23c-7-7-14 5-5 9-8 7 4 15 9 6 8 5 14-7 5-11 2-9-11-12-9-4Z" />
        <path d="M32 38v15m0-8-8-5m8 8 8-6" />
      </svg>
    );
  }
  if (color === 'blue') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <path d="M32 5v54M9 18l46 28M9 46l46-28M32 5l-6 8m6-8 6 8M32 59l-6-8m6 8 6-8M9 18l10 1m-10-1 4 9M55 46l-10-1m10 1-4-9M9 46l10-1m-10 1 4-9M55 18l-10 1m10-1-4 9" />
        <circle cx="32" cy="32" r="7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M11 21 23 34l9-22 9 22 12-13-5 29H16l-5-29Z" />
      <path d="M17 43h30M20 51h24" />
      <circle cx="11" cy="19" r="3" /><circle cx="32" cy="10" r="3" /><circle cx="53" cy="19" r="3" />
    </svg>
  );
}

/** Branded token — no emoji anywhere in the primary symbol set. */
function SlotSymbol({ symbolKey, size = 46 }: { symbolKey: string; size?: number }) {
  const img = SYMBOL_IMAGES[symbolKey];
  if (img) {
    return <img className={`snow-slot-brand snow-slot-brand--${symbolKey}`} src={img} alt="" style={{ width: size, height: size, objectFit: 'contain' }} draggable={false} />;
  }
  if (symbolKey === 'wild') {
    return <span className="snow-slot-token snow-slot-token--wild" style={{ width: size * 1.35, height: size }}>WILD</span>;
  }
  if (symbolKey === 'scatter') {
    return <span className="snow-slot-token snow-slot-token--bonus" style={{ width: size * 1.35, height: size }}>BONUS</span>;
  }
  if (symbolKey.startsWith('relic_')) {
    const color = symbolKey.slice(6) as CollectorColor;
    return (
      <span className={`snow-slot-relic-token snow-slot-relic-token--${color}`} style={{ width: size * 1.2, height: size }}>
        <CollectorSigil color={color} />
        <b>{color === 'red' ? 'ROSE' : color === 'blue' ? 'CRYSTAL' : 'CROWN'}</b>
      </span>
    );
  }
  return (
    <span className="snow-slot-token snow-slot-token--low" style={{ width: size * 0.8, height: size }}>
      {LOW_LETTER[symbolKey] ?? symbolKey.toUpperCase()}
    </span>
  );
}

function FrostCollector({
  color, meter, active, triggered,
}: {
  color: CollectorColor;
  meter: CollectorMeter;
  active: boolean;
  triggered: boolean;
}) {
  const { t } = useTranslation();
  const ratio = meter.threshold > 0 ? meter.progress / meter.threshold : 0;
  // Keep the exact counter private. The lantern communicates momentum through
  // a deliberately capped visual fill, so a bonus always remains a surprise.
  const fill = meter.progress === 0 ? 5 : Math.min(90, Math.round(8 + ratio * 82));
  const near = meter.progress >= meter.threshold - 2;
  const heat = near ? 'near' : ratio >= 0.62 ? 'hot' : ratio >= 0.28 ? 'warm' : 'cold';
  const state = triggered
    ? t('games.slots.collector.bursting')
    : t(`games.slots.collector.${heat}`);
  return (
    <div
      className={`snow-slot-collector snow-slot-collector--${color} is-${heat}${active ? ' is-fed' : ''}${triggered ? ' is-triggered' : ''}`}
      style={{ '--collector-fill': `${fill}%` } as CSSProperties}
      data-testid={`slot-collector-${color}`}
      data-heat={heat}
      aria-label={t(`games.slots.collector.${color}Aria`, { state })}
    >
      <span className="snow-slot-collector__aurora" aria-hidden="true" />
      <span className="snow-slot-collector__relic" aria-hidden="true">
        <i />
        <CollectorSigil color={color} />
      </span>
      <span className="snow-slot-collector__snow" aria-hidden="true" />
      <span className="snow-slot-collector__copy">
        <b>{t(`games.slots.collector.${color}`)}</b>
        <strong>{state}</strong>
        <em>{t(`games.slots.collector.${color}Prize`)}</em>
      </span>
    </div>
  );
}

type FocusId = 'back' | 'sound' | 'fx' | 'betMinus' | 'betPlus' | 'spin';
type ReelMode = 'idle' | 'spin' | 'settle';
interface SettlePlan { from: number; target: number; start: number; duration: number }

const Slots = ({ onBack }: SlotsProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id;
  const { balance, status } = useGameSocket();
  const life = useGameLifecycle();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  const { muted, play: playSound, toggleMuted } = useGameAudio();
  useTvActivate(activateFocused);

  const [cellHeight, setCellHeight] = useState(() => (
    typeof window === 'undefined' ? cellHeightFor(1600, 900) : cellHeightFor(window.innerWidth, window.innerHeight)
  ));
  const [bet, setBet] = useState<number>(() => readSavedBet(BET_STORAGE_KEY));
  const [spinning, setSpinning] = useState(false);
  const [reelCells, setReelCells] = useState<string[][]>(() => Array.from({ length: REELS }, () => buildCells()));
  const [landedWindows, setLandedWindows] = useState<string[][] | null>(null);
  const [winningCells, setWinningCells] = useState<boolean[][]>(() =>
    Array.from({ length: REELS }, () => Array(ROWS).fill(false)),
  );
  const [result, setResult] = useState<SpinResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** ONE tokenized celebration: a win and a free-spin award share one overlay. */
  const [callout, setCallout] = useState<{
    token: number;
    payout: number;
    freeSpins: number;
    collectorBonuses: { color: CollectorColor; multiplier: number }[];
  } | null>(null);
  const [freeSpinsRemaining, setFreeSpinsRemaining] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [collectors, setCollectors] = useState<CollectorState>(COLLECTOR_DEFAULTS);
  const [collectorFx, setCollectorFx] = useState<{
    token: number;
    hits: CollectorColor[];
    triggers: CollectorColor[];
    sources: Record<CollectorColor, { reel: number; row: number }[]>;
  } | null>(null);
  const [focus, setFocus] = useState<FocusId>('spin');

  useEffect(() => saveSelectedBet(BET_STORAGE_KEY, bet), [bet]);

  const inFlight = useRef(false);
  const spinBtnRef = useRef<HTMLButtonElement>(null);
  const backBtnRef = useRef<HTMLButtonElement>(null);
  const soundBtnRef = useRef<HTMLButtonElement>(null);
  const fxBtnRef = useRef<HTMLButtonElement>(null);
  const minusBtnRef = useRef<HTMLButtonElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);

  // ---- Reel motion: DOM-driven, never React state per frame ----
  const stripRefs = useRef<Array<HTMLDivElement | null>>(Array(REELS).fill(null));
  const posRef = useRef<number[]>(Array(REELS).fill(0));
  const modeRef = useRef<ReelMode[]>(Array(REELS).fill('idle'));
  const planRef = useRef<Array<SettlePlan | null>>(Array(REELS).fill(null));
  const loopRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const cellHeightRef = useRef(cellHeight);
  cellHeightRef.current = cellHeight;
  const reducedRef = useRef(reducedFx);
  reducedRef.current = reducedFx;
  const spinEpochRef = useRef(0);
  const pendingRef = useRef<{ epoch: number; settled: SpinResult; columns: string[][] } | null>(null);
  const calloutTokenRef = useRef(0);
  const calloutTimerRef = useRef<number | null>(null);
  const collectorFxTimerRef = useRef<number | null>(null);
  const collectorStateEpochRef = useRef(0);

  const inFreeSpins = freeSpinsRemaining > 0;
  const canBet = inFreeSpins || bet <= (balance ?? 0);
  const betIdx = BETS.indexOf(bet);
  const spinUsable = !spinning && !!user && (inFreeSpins || canBet);
  const betStepUsable = !spinning && !inFreeSpins;

  /** Rows contain ONLY targets that are usable right now. */
  const focusRows = useMemo<FocusRows>(() => [
    ['back', 'sound', 'fx'],
    [
      ...(betStepUsable && betIdx > 0 ? ['betMinus'] : []),
      ...(betStepUsable && betIdx < BETS.length - 1 ? ['betPlus'] : []),
      ...(spinUsable ? ['spin'] : []),
    ],
  ], [betStepUsable, betIdx, spinUsable]);

  // Re-home whenever a phase or availability change makes the target unusable.
  useEffect(() => {
    setFocus((current) => (rehome(focusRows, current) as FocusId) ?? 'back');
  }, [focusRows]);

  /**
   * Spin is the control the player wants under the remote. When it becomes
   * usable again — chips finished loading, or a spin completed / errored — a
   * player who was pushed onto Back is brought back to Spin. A DELIBERATE move
   * to Reduced FX or the bet steppers is left alone.
   */
  const parkedOnBack = useRef(false);
  useEffect(() => {
    if (!spinUsable) { parkedOnBack.current = focus === 'back'; return; }
    if (parkedOnBack.current && focus === 'back') setFocus('spin');
    parkedOnBack.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinUsable]);

  useEffect(() => {
    const target =
      focus === 'spin' ? spinBtnRef.current
        : focus === 'back' ? backBtnRef.current
          : focus === 'sound' ? soundBtnRef.current
          : focus === 'fx' ? fxBtnRef.current
            : focus === 'betMinus' ? minusBtnRef.current
              : plusBtnRef.current;
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [focus]);

  // Load the actual persisted meter row whenever the player changes bet. Old
  // servers simply fail this optional read and the slots screen still works.
  useEffect(() => {
    const epoch = collectorStateEpochRef.current + 1;
    collectorStateEpochRef.current = epoch;
    setCollectors(readCollectors(null));
    if (!userId || status !== 'connected' || typeof gameSocket.getSlotsState !== 'function') return;
    let cancelled = false;
    void gameSocket.getSlotsState(bet).then((resp) => {
      if (cancelled || epoch !== collectorStateEpochRef.current || resp?.ok !== true) return;
      setCollectors(readCollectors(resp.collectors));
      if (Number.isInteger(resp.freeSpinsRemaining) && resp.freeSpinsRemaining > 0) {
        setFreeSpinsRemaining(resp.freeSpinsRemaining);
        setMultiplier(Number(resp.multiplier) || 1);
      }
    }).catch(() => { /* additive feature: a legacy server remains playable */ });
    return () => { cancelled = true; };
  }, [bet, status, userId]);

  const paint = useCallback((reel: number) => {
    const el = stripRefs.current[reel];
    if (!el) return;
    const cellH = cellHeightRef.current;
    const pos = posRef.current[reel];
    el.style.transform = `translateY(${-(((pos % cyclePx(cellH)) + cyclePx(cellH)) % cyclePx(cellH))}px)`;
    // Cumulative travel, exposed for tests and never read by the render path.
    el.dataset.travel = String(Math.round(pos));
  }, []);

  // Reel offsets are stored in pixels for cheap per-frame transforms. When a
  // TV changes output mode (or the Lovable preview changes height), preserve
  // the same cycle position instead of applying an old 720p offset to 1080p
  // cells and showing half-symbols until the next spin.
  useEffect(() => {
    let queued = 0;
    const onResize = () => {
      const next = cellHeightFor(window.innerWidth, window.innerHeight);
      const previous = cellHeightRef.current;
      if (next === previous) return;
      const ratio = next / previous;
      posRef.current = posRef.current.map((position) => position * ratio);
      planRef.current = planRef.current.map((plan) => plan ? {
        ...plan,
        from: plan.from * ratio,
        target: plan.target * ratio,
      } : null);
      cellHeightRef.current = next;
      setCellHeight(next);
      window.cancelAnimationFrame(queued);
      queued = window.requestAnimationFrame(() => {
        for (let reel = 0; reel < REELS; reel += 1) paint(reel);
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.cancelAnimationFrame(queued);
    };
  }, [paint]);

  const promote = useCallback((reel: number, on: boolean) => {
    const el = stripRefs.current[reel];
    if (el) el.style.willChange = on ? 'transform' : 'auto';
  }, []);

  const commitResult = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending || pending.epoch !== spinEpochRef.current || !life.isMounted()) return;
    const { settled, columns } = pending;
    const cellH = cellHeightRef.current;

    setLandedWindows(columns.map((_, reel) => visibleSymbolsAt(reelCellsRef.current[reel], posRef.current[reel], cellH)));
    setResult(settled);
    setFreeSpinsRemaining(settled.freeSpinsRemaining);
    setMultiplier(settled.multiplier || 1);
    setCollectors(settled.collectors);
    setWinningCells(settled.totalPayout > 0 ? winningCellsFor(columns, settled.wins) : Array.from({ length: REELS }, () => Array(ROWS).fill(false)));
    setSpinning(false);
    inFlight.current = false;

    const collectorHits = COLLECTOR_COLORS.filter((color) => settled.collectors[color].hit);
    const collectorTriggers = COLLECTOR_COLORS.filter((color) => settled.collectors[color].triggered);
    if (collectorHits.length > 0) {
      const token = calloutTokenRef.current + 1;
      calloutTokenRef.current = token;
      setCollectorFx({
        token,
        hits: collectorHits,
        triggers: collectorTriggers,
        sources: Object.fromEntries(COLLECTOR_COLORS.map((color) => [
          color, settled.collectors[color].sources,
        ])) as Record<CollectorColor, { reel: number; row: number }[]>,
      });
      if (collectorFxTimerRef.current !== null) life.clearTimer(collectorFxTimerRef.current);
      collectorFxTimerRef.current = life.timeout(() => setCollectorFx(null), reducedRef.current ? 700 : 1800);
    }

    if (collectorTriggers.length > 0 || settled.triggeredFreeSpins > 0) {
      playSound('bonus');
    } else if (settled.totalPayout > 0) {
      playSound('win');
    } else if (collectorHits.length > 0) {
      playSound('collectorFeed', { volume: 0.76 });
    } else if (collectorHits.length === 0) {
      playSound('lose', { volume: 0.55 });
    }

    if (settled.totalPayout > 0 || settled.triggeredFreeSpins > 0) {
      const token = calloutTokenRef.current + 1;
      calloutTokenRef.current = token;
      if (calloutTimerRef.current !== null) life.clearTimer(calloutTimerRef.current);
      setCallout({
        token,
        payout: settled.totalPayout,
        freeSpins: settled.triggeredFreeSpins,
        collectorBonuses: collectorTriggers.map((color) => ({
          color,
          multiplier: settled.collectors[color].multiplier,
        })),
      });
      calloutTimerRef.current = life.timeout(() => {
        // Back-to-back results each get their full duration: only the newest
        // token is allowed to clear the overlay.
        if (calloutTokenRef.current === token) setCallout(null);
      }, reducedRef.current ? 1200 : 2400);
    }
  }, [life, playSound]);

  // Latest cells, readable from the animation loop without re-subscribing.
  const reelCellsRef = useRef(reelCells);
  reelCellsRef.current = reelCells;

  const loop = useCallback((time: number) => {
    loopRef.current = null;
    if (!life.isMounted()) return;
    if (lastFrameRef.current === 0) lastFrameRef.current = time;
    const dt = Math.min(64, Math.max(0, time - lastFrameRef.current));
    lastFrameRef.current = time;
    const cellH = cellHeightRef.current;
    const speed = (cellH * (reducedRef.current ? 12 : 20)) / 1000; // px per ms, one direction
    let active = false;
    let finished = false;

    for (let reel = 0; reel < REELS; reel += 1) {
      const mode = modeRef.current[reel];
      if (mode === 'spin') {
        posRef.current[reel] += speed * dt;
        if (!life.isHidden()) paint(reel);
        active = true;
      } else if (mode === 'settle') {
        const plan = planRef.current[reel];
        if (!plan) { modeRef.current[reel] = 'idle'; continue; }
        // The clock is taken from the first settle frame, so the animation can
        // never depend on performance.now() sharing rAF's time origin.
        if (plan.start === 0) plan.start = time;
        const p = Math.min(1, Math.max(0, (time - plan.start) / plan.duration));
        const eased = 1 - Math.pow(1 - p, 3);
        posRef.current[reel] = plan.from + (plan.target - plan.from) * eased;
        if (!life.isHidden()) paint(reel);
        if (p >= 1) {
          posRef.current[reel] = plan.target;
          paint(reel);
          planRef.current[reel] = null;
          modeRef.current[reel] = 'idle';
          promote(reel, false);
          playSound('reelStop', { volume: 0.62 });
          if (reel === REELS - 1) finished = true;
        } else {
          active = true;
        }
      }
    }

    if (active) loopRef.current = life.raf(loop);
    else lastFrameRef.current = 0;
    if (finished) commitResult();
  }, [life, paint, promote, playSound, commitResult]);

  const ensureLoop = useCallback(() => {
    if (loopRef.current === null) loopRef.current = life.raf(loop);
  }, [life, loop]);

  const stopMotion = useCallback(() => {
    modeRef.current = Array(REELS).fill('idle');
    planRef.current = Array(REELS).fill(null);
    for (let reel = 0; reel < REELS; reel += 1) promote(reel, false);
    life.cancelRaf(loopRef.current);
    loopRef.current = null;
    lastFrameRef.current = 0;
    setSpinning(false);
    inFlight.current = false;
  }, [life, promote]);

  const changeBet = useCallback((dir: 1 | -1) => {
    if (spinning || inFreeSpins) return;
    setBet((current) => {
      const idx = BETS.indexOf(current);
      return BETS[dir === 1 ? Math.min(BETS.length - 1, idx + 1) : Math.max(0, idx - 1)];
    });
  }, [spinning, inFreeSpins]);

  const handleSpin = useCallback(async () => {
    if (inFlight.current || spinning) return;
    if (!user) { setErrorMsg(t('games.slots.errorSignIn')); return; }
    if (balance === null && !inFreeSpins) { setErrorMsg(t('games.slots.errorLoadingChips')); return; }
    if (!inFreeSpins && !canBet) { setErrorMsg(t('games.slots.errorNotEnoughChips')); return; }
    inFlight.current = true;
    const epoch = spinEpochRef.current + 1;
    spinEpochRef.current = epoch;

    setErrorMsg(null);
    setNotice(null);
    setResult(null);
    setLandedWindows(null);
    collectorStateEpochRef.current += 1;
    setWinningCells(Array.from({ length: REELS }, () => Array(ROWS).fill(false)));
    setSpinning(true);

    // Motion starts on this press, before any network work, and keeps looping
    // seamlessly for as long as the ack takes.
    modeRef.current = Array(REELS).fill('spin');
    planRef.current = Array(REELS).fill(null);
    // Full FX promotes all five layers up front; reduced/low-memory mode waits
    // until the actual deceleration so nothing stays promoted during the wait.
    if (!reducedRef.current) for (let reel = 0; reel < REELS; reel += 1) promote(reel, true);
    ensureLoop();

    try {
      const clientSeed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.spinSlots(bet, clientSeed);
      if (!life.isMounted() || epoch !== spinEpochRef.current) return;

      if (resp?.ok === true && validateGrid(resp.grid)) {
        const columns = gridToColumns(resp.grid);
        const settled: SpinResult = {
          grid: resp.grid,
          wins: Array.isArray(resp.wins) ? resp.wins : [],
          scatterCount: resp.scatterCount ?? 0,
          totalPayout: resp.totalPayout ?? 0,
          net: resp.net ?? 0,
          bet: resp.bet ?? bet,
          freeSpin: !!resp.freeSpin,
          freeSpinsRemaining: resp.freeSpinsRemaining ?? 0,
          multiplier: resp.multiplier ?? 1,
          triggeredFreeSpins: resp.triggeredFreeSpins ?? 0,
          basePayout: resp.basePayout ?? resp.totalPayout ?? 0,
          collectorPayout: resp.collectorPayout ?? 0,
          collectors: readCollectors(resp.collectors, collectors),
        };
        pendingRef.current = { epoch, settled, columns };

        const baseDelay = reducedRef.current ? 160 : 340;
        const stagger = reducedRef.current ? 90 : 170;
        columns.forEach((column, reel) => {
          life.timeout(() => {
            if (!life.isMounted() || epoch !== spinEpochRef.current) return;
            const cellH = cellHeightRef.current;
            const pos = posRef.current[reel];
            // Committed symbols are written six cells ahead of the window, so
            // no visible cell is ever swapped during the stop.
            const landing = pickLandingIndex(pos, cellH);
            setReelCells((prev) => {
              const next = [...prev];
              next[reel] = withLanding(prev[reel], landing, column);
              return next;
            });
            planRef.current[reel] = {
              from: pos,
              target: computeSettleTarget(pos, landing, cellH, MIN_TRAVEL_CELLS),
              start: 0, // stamped on the first settle frame from rAF's own clock
              duration: reducedRef.current ? 620 : 1080,
            };
            modeRef.current[reel] = 'settle';
            if (reducedRef.current) promote(reel, true);
            ensureLoop();
          }, baseDelay + reel * stagger);
        });
      } else if (resp?.ok === false && resp.error === 'insufficient_balance') {
        stopMotion(); setErrorMsg(t('games.slots.errorNotEnoughChips'));
      } else if (resp?.ok === false && resp.error === 'invalid_bet') {
        stopMotion(); setErrorMsg(t('games.slots.errorInvalidBet'));
      } else if (resp?.error === 'game_disabled') {
        stopMotion(); setErrorMsg(t('games.slots.errorGameDisabled'));
      } else {
        stopMotion(); setErrorMsg(t('games.slots.errorSpinFailed'));
      }
    } catch {
      if (!life.isMounted() || epoch !== spinEpochRef.current) return;
      stopMotion();
      setErrorMsg(t('games.slots.errorSpinFailed'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning, user, canBet, bet, inFreeSpins, balance, collectors, life, stopMotion, ensureLoop, promote]);

  // A spin in flight or still stopping owns Back: no committed wager is dropped.
  const motionActive = () => modeRef.current.some((mode) => mode !== 'idle');
  const { requestBack } = useGameBack({
    isBusy: () => spinning || inFlight.current || motionActive(),
    onBlocked: () => {
      setNotice(t('games.shared.finishSpinFirst'));
      life.timeout(() => setNotice(null), 2600);
    },
    onExit: onBack,
  });

  // D-pad movement only; OK/Select activation lives in useTvActivate. A global
  // modal owns input outright, so the machine yields its arrows untouched.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isGlobalModalOpen()) return;
      const dir: FocusDir | null = visualArrowDir(e);
      if (!dir) return;
      e.preventDefault();
      const next = moveInRows(focusRows, focus, dir);
      if (next) setFocus(next as FocusId);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focus, focusRows]);

  const reelHeight = cellHeight * ROWS;
  const reels = useMemo(() => Array.from({ length: REELS }, (_, i) => i), []);

  return (
    <GameShell accent="plum" className="snow-machine-game snow-slots-game">
      <div className="snow-slot-topbar-wrap">
        <GameTopBar
          ref={backBtnRef}
          onBack={requestBack}
          backLabel={t('games.slots.back')}
          balance={balance}
          status={status}
          title={t('games.slots.marquee')}
          phase={inFreeSpins ? t('games.slots.freeSpinsBanner', { remaining: freeSpinsRemaining, multiplier }) : t('games.slots.spinToWin')}
          backFocused={focus === 'back'}
          onBackFocus={() => setFocus('back')}
          reducedFx={reducedFx}
          onToggleFx={toggleReducedFx}
          fxRef={fxBtnRef}
          fxFocused={focus === 'fx'}
          onFxFocus={() => setFocus('fx')}
        />
        <Button
          ref={soundBtnRef}
          type="button"
          variant="navy"
          size="sm"
          onFocus={() => setFocus('sound')}
          onClick={(event) => toggleMuted(event.nativeEvent)}
          aria-label={muted ? t('games.slots.soundTurnOn') : t('games.slots.soundTurnOff')}
          aria-pressed={muted}
          data-tv-focused={focus === 'sound' ? 'true' : 'false'}
          className="snow-slot-sound-toggle"
        >
          {muted ? <VolumeX /> : <Volume2 />}
          <span>{muted ? t('games.slots.soundOff') : t('games.slots.soundOn')}</span>
        </Button>
      </div>

      <div className="snow-slot-stage snow-machine-stage">
        <div className="snow-slot-layout">
          <section className="snow-slot-cabinet" aria-label={t('games.slots.luckySlotsWays')}>
            <div className="snow-slot-crown">
              <span className="snow-slot-crown__gem" aria-hidden="true">◆</span>
              <div>
                <span className="snow-slot-marquee">{t('games.slots.marquee')}</span>
                <small>{t('games.slots.subtitleWildScatter')}</small>
              </div>
              <span className="snow-slot-crown__ways">5 × 3<br /><b>243</b></span>
            </div>

            <div className="snow-slot-collector-bank" aria-label={t('games.slots.collector.bankLabel')}>
              <span className="snow-slot-collector-bank__title">
                <b>{t('games.slots.collector.title')}</b>
                <small>{t('games.slots.collector.subtitle')}</small>
              </span>
              {COLLECTOR_COLORS.map((color) => (
                <FrostCollector
                  key={`${color}-${collectorFx?.token ?? 0}`}
                  color={color}
                  meter={collectors[color]}
                  active={collectorFx?.hits.includes(color) ?? false}
                  triggered={collectorFx?.triggers.includes(color) ?? false}
                />
              ))}
            </div>

            <div className="snow-slot-screen">
              <span className="snow-slot-lamps snow-slot-lamps--left" aria-hidden="true" />
              <span className="snow-slot-lamps snow-slot-lamps--right" aria-hidden="true" />
              <div className="snow-slot-window" style={{ height: reelHeight + 12 }}>
                <div className="snow-slot-reels" style={{ height: reelHeight }}>
                  {reels.map((reelIndex) => {
                    const cells = reelCells[reelIndex] ?? [];
                    return (
                      <div
                        key={reelIndex}
                        className="snow-slot-reel"
                        style={{ height: reelHeight }}
                        data-reel={reelIndex}
                        data-reel-symbols={landedWindows ? landedWindows[reelIndex]?.join(',') : undefined}
                      >
                        <span className="snow-slot-reel__shade" aria-hidden="true" />
                        {landedWindows && winningCells[reelIndex]?.map((lit, row) => (lit ? (
                          <span key={`w-${row}`} className="snow-slot-cell__win" style={{ top: row * cellHeight, height: cellHeight, bottom: 'auto' }} />
                        ) : null))}
                        <div
                          ref={(el) => { stripRefs.current[reelIndex] = el; }}
                          className="snow-slot-strip"
                          data-testid={`slot-strip-${reelIndex}`}
                        >
                          {cells.map((key, i) => (
                            <div key={i} className="snow-slot-cell" style={{ height: cellHeight }} data-cell={i < CYCLE_CELLS ? i : `clone-${i - CYCLE_CELLS}`}>
                              <SlotSymbol symbolKey={key} size={Math.round(cellHeight * 0.7)} />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <span className="snow-slot-payline" style={{ top: cellHeight + 6 }} aria-hidden="true" />
                <span className="snow-slot-payline" style={{ top: cellHeight * 2 + 6 }} aria-hidden="true" />

                {collectorFx && collectorFx.hits.flatMap((color) => (
                  collectorFx.sources[color].map(({ reel, row }, index) => (
                    <span
                      key={`${collectorFx.token}-${color}-${reel}-${row}-${index}`}
                      className={`snow-slot-relic-flight snow-slot-relic-flight--${color}`}
                      style={{
                        '--flight-left': `${(reel + 0.5) * 20}%`,
                        '--flight-top': `${(row + 0.5) * (100 / 3)}%`,
                      } as CSSProperties}
                      aria-hidden="true"
                    ><CollectorSigil color={color} /></span>
                  ))
                ))}

                {callout && (
                  <div className="snow-slot-overlay" data-callout-token={callout.token}>
                    <div className="snow-slot-callout" role="status" aria-live="polite">
                      {callout.payout > 0 && t('games.slots.winChips', { amount: callout.payout.toLocaleString() })}
                      {callout.freeSpins > 0 && (
                        <small>
                          {t('games.slots.freeSpinsCallout')} · {t('games.slots.freeSpinsAwarded', { count: callout.freeSpins })}
                        </small>
                      )}
                      {callout.collectorBonuses.length > 0 && (
                        <small className="snow-slot-callout__trio">
                          {t('games.slots.collector.bonusCallout')} · {callout.collectorBonuses.map(({ color, multiplier }) => (
                            `${t(`games.slots.collector.${color}`)} ${multiplier}×`
                          )).join(' + ')}
                        </small>
                      )}
                    </div>
                    {callout.payout > 0 && <GameFxCanvas burstKey={callout.token} reduced={reducedFx} />}
                  </div>
                )}
              </div>
            </div>

            <div className="snow-slot-controls">
              <div className="snow-slot-meter">
                <small>{t('games.slots.bet')}</small>
                <strong>{bet.toLocaleString()}</strong>
              </div>
              <div className="snow-slot-bet">
                <Button
                  ref={minusBtnRef}
                  type="button"
                  variant="navy"
                  size="icon"
                  onFocus={() => setFocus('betMinus')}
                  onClick={() => changeBet(-1)}
                  aria-label={`${t('games.slots.bet')} −`}
                  aria-disabled={!betStepUsable || betIdx === 0 ? 'true' : undefined}
                  data-tv-focused={focus === 'betMinus' ? 'true' : 'false'}
                >
                  <Minus />
                </Button>
                <span className="snow-slot-bet__value">{bet}</span>
                <Button
                  ref={plusBtnRef}
                  type="button"
                  variant="navy"
                  size="icon"
                  onFocus={() => setFocus('betPlus')}
                  onClick={() => changeBet(1)}
                  aria-label={`${t('games.slots.bet')} +`}
                  aria-disabled={!betStepUsable || betIdx === BETS.length - 1 ? 'true' : undefined}
                  data-tv-focused={focus === 'betPlus' ? 'true' : 'false'}
                >
                  <Plus />
                </Button>
              </div>

              <Button
                ref={spinBtnRef}
                type="button"
                onFocus={() => setFocus('spin')}
                onClick={() => { if (spinUsable) handleSpin(); }}
                aria-disabled={spinUsable ? undefined : 'true'}
                data-busy={spinning ? 'true' : undefined}
                data-tv-focused={focus === 'spin' ? 'true' : 'false'}
                className={`${GAME_ACTION_CLASS} snow-slot-spin`}
              >
                <span className="snow-slot-spin__disc" aria-hidden="true">▶</span>
                <span>{spinning ? <><Loader2 className="animate-spin" /> {t('games.slots.spinning')}</> : inFreeSpins ? t('games.slots.spinFree') : t('games.slots.spin')}</span>
              </Button>

              <div className="snow-slot-meter snow-slot-meter--win">
                <small>{t('games.slots.winsThisSpin')}</small>
                <strong>{(result?.totalPayout ?? 0).toLocaleString()}</strong>
              </div>
            </div>

            {errorMsg && <p className="snow-game-error">{errorMsg}</p>}
            {notice && <p className="snow-game-note" role="status">{notice}</p>}
            {!errorMsg && balance !== null && !canBet && user && !inFreeSpins && (
              <p className="snow-game-note">{t('games.slots.notEnoughChipsDailySpin')}</p>
            )}
          </section>

          <aside className="snow-slot-info" aria-label={t('games.slots.paytable')}>
            <GamePanel className="snow-slot-paytable-panel">
              <div className="snow-machine-panel-title"><span aria-hidden="true">★</span><b>{t('games.slots.paytable')}</b></div>
              <ul className="snow-slot-symbol-list">
                {PREMIUM_SYMBOLS.map(({ key, label }, index) => (
                  <li key={key}>
                    <span className="snow-slot-pay-symbol"><SlotSymbol symbolKey={key} size={44} /></span>
                    <span className="snow-slot-symbol-rank"><b>#{index + 1}</b><small>{label}</small><em>{t('games.slots.topPayer')}</em></span>
                  </li>
                ))}
              </ul>
              <p>{t('games.slots.paytableNote')}</p>
            </GamePanel>
            <GamePanel className="snow-slot-status-panel">
              <div className="snow-machine-panel-title"><span aria-hidden="true">✦</span><b>{t('games.slots.winsThisSpin')}</b></div>
              <ul>
                {result && result.wins.length > 0 ? result.wins.slice(0, 4).map((w, i) => (
                  <li key={i}>
                    <span>{t('games.slots.winSymbolCount', { count: w.count, symbol: w.symbol.toUpperCase() })}</span>
                    <strong>+{w.payout.toLocaleString()}</strong>
                  </li>
                )) : <li className="snow-slot-status-panel__empty"><span>{t('games.slots.spinToWin')}</span><i aria-hidden="true">◆ ◆ ◆</i></li>}
                {result && result.scatterCount > 0 && (
                  <li><span>{t('games.slots.scatters', { count: result.scatterCount })}</span></li>
                )}
                {result && result.collectorPayout > 0 && (
                  <li className="snow-slot-status-panel__collector">
                    <span>{t('games.slots.collector.bonusWin')}</span>
                    <strong>+{result.collectorPayout.toLocaleString()}</strong>
                  </li>
                )}
                {result && result.totalPayout > 0 && (
                  <li className="snow-slot-status-panel__total"><span>{result.freeSpin && multiplier > 1
                    ? t('games.slots.totalPayoutMultiplier', { amount: result.totalPayout.toLocaleString(), multiplier })
                    : t('games.slots.totalPayout', { amount: result.totalPayout.toLocaleString() })}</span></li>
                )}
              </ul>
            </GamePanel>
          </aside>
        </div>
      </div>

      <div className="snow-slot-rules-note">
        <b>{t('games.slots.rulesTitle')}</b>
        <span>{t('games.slots.rulesOdds')}</span>
      </div>
    </GameShell>
  );
};

export default Slots;
