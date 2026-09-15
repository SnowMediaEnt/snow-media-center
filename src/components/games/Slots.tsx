import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Loader2, Minus, Plus } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { gameSocket } from '@/lib/gameSocket';
import { FairnessPanel, GAME_ACTION_CLASS, GamePanel, GameShell, GameTopBar } from './shared/GameUI';
import { GameFxCanvas } from './shared/GameFxCanvas';
import { useGameLifecycle } from './shared/gameLifecycle';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { useGameBack } from './shared/gameBack';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { firstUsable, moveInRows, rehome, type FocusDir, type FocusRows } from './shared/focusRows';
import {
  CYCLE_CELLS, MIN_TRAVEL_CELLS, REELS, RENDER_CELLS, ROWS,
  buildCells, computeSettleTarget, cyclePx, gridToColumns, pickLandingIndex,
  validateGrid, visibleSymbolsAt, winningCellsFor, withLanding,
} from './shared/slotsReel';
import type { GameFairInfo } from './shared/gameTypes';
import p1img from '@/assets/slots/dreamstreams.png';
import p2img from '@/assets/slots/vibez.png';
import p3img from '@/assets/slots/snowmedia.png';
import p4img from '@/assets/slots/smc.png';

interface SlotsProps {
  onBack: () => void;
}

const BETS = [10, 25, 50, 100];

const SYMBOL_IMAGES: Record<string, string | undefined> = { p1: p1img, p2: p2img, p3: p3img, p4: p4img };
const LOW_LETTER: Record<string, string> = { la: 'A', lk: 'K', lq: 'Q', lj: 'J' };

/** Rendered nodes per reel: 12 recycled cells plus 3 seamless wrap clones. */
export const SLOTS_RENDER_CELLS = RENDER_CELLS;

const cellHeightFor = (h: number) => (h <= 760 ? 62 : h >= 1000 ? 92 : 74);

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
}

/** Branded token — no emoji anywhere in the primary symbol set. */
function SlotSymbol({ symbolKey, size = 46 }: { symbolKey: string; size?: number }) {
  const img = SYMBOL_IMAGES[symbolKey];
  if (img) {
    return <img src={img} alt="" style={{ width: size, height: size, objectFit: 'contain' }} draggable={false} />;
  }
  if (symbolKey === 'wild') {
    return <span className="snow-slot-token snow-slot-token--wild" style={{ width: size * 1.35, height: size }}>WILD</span>;
  }
  if (symbolKey === 'scatter') {
    return <span className="snow-slot-token snow-slot-token--bonus" style={{ width: size * 1.35, height: size }}>BONUS</span>;
  }
  return (
    <span className="snow-slot-token snow-slot-token--low" style={{ width: size * 0.8, height: size }}>
      {LOW_LETTER[symbolKey] ?? symbolKey.toUpperCase()}
    </span>
  );
}

type FocusId = 'back' | 'fx' | 'betMinus' | 'betPlus' | 'spin' | 'fair';
type ReelMode = 'idle' | 'spin' | 'settle';
interface SettlePlan { from: number; target: number; start: number; duration: number }

const Slots = ({ onBack }: SlotsProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { balance, status } = useGameSocket();
  const life = useGameLifecycle();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  useTvActivate(activateFocused);

  const [cellHeight, setCellHeight] = useState(() => cellHeightFor(typeof window === 'undefined' ? 900 : window.innerHeight));
  const [bet, setBet] = useState<number>(10);
  const [spinning, setSpinning] = useState(false);
  const [reelCells, setReelCells] = useState<string[][]>(() => Array.from({ length: REELS }, () => buildCells()));
  const [landedWindows, setLandedWindows] = useState<string[][] | null>(null);
  const [winningCells, setWinningCells] = useState<boolean[][]>(() =>
    Array.from({ length: REELS }, () => Array(ROWS).fill(false)),
  );
  const [result, setResult] = useState<SpinResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fair, setFair] = useState<GameFairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);
  /** ONE tokenized celebration: a win and a free-spin award share one overlay. */
  const [callout, setCallout] = useState<{ token: number; payout: number; freeSpins: number } | null>(null);
  const [freeSpinsRemaining, setFreeSpinsRemaining] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [focus, setFocus] = useState<FocusId>('spin');

  const inFlight = useRef(false);
  const spinBtnRef = useRef<HTMLButtonElement>(null);
  const backBtnRef = useRef<HTMLButtonElement>(null);
  const fxBtnRef = useRef<HTMLButtonElement>(null);
  const minusBtnRef = useRef<HTMLButtonElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const fairBtnRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    const onResize = () => setCellHeight(cellHeightFor(window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const inFreeSpins = freeSpinsRemaining > 0;
  const canBet = inFreeSpins || bet <= (balance ?? 0);
  const betIdx = BETS.indexOf(bet);
  const spinUsable = !spinning && !!user && (inFreeSpins || canBet);
  const betStepUsable = !spinning && !inFreeSpins;

  /** Rows contain ONLY targets that are usable right now. */
  const focusRows = useMemo<FocusRows>(() => [
    ['back', 'fx'],
    [
      ...(betStepUsable && betIdx > 0 ? ['betMinus'] : []),
      ...(betStepUsable && betIdx < BETS.length - 1 ? ['betPlus'] : []),
      ...(spinUsable ? ['spin'] : []),
    ],
    ['fair'],
  ], [betStepUsable, betIdx, spinUsable]);

  // Re-home whenever a phase or availability change makes the target unusable.
  useEffect(() => {
    setFocus((current) => (rehome(focusRows, current) as FocusId) ?? 'back');
  }, [focusRows]);

  useEffect(() => {
    const target =
      focus === 'spin' ? spinBtnRef.current
        : focus === 'back' ? backBtnRef.current
          : focus === 'fx' ? fxBtnRef.current
            : focus === 'betMinus' ? minusBtnRef.current
              : focus === 'betPlus' ? plusBtnRef.current
                : fairBtnRef.current;
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [focus]);

  const paint = useCallback((reel: number) => {
    const el = stripRefs.current[reel];
    if (!el) return;
    const cellH = cellHeightRef.current;
    const pos = posRef.current[reel];
    el.style.transform = `translateY(${-(((pos % cyclePx(cellH)) + cyclePx(cellH)) % cyclePx(cellH))}px)`;
    // Cumulative travel, exposed for tests and never read by the render path.
    el.dataset.travel = String(Math.round(pos));
  }, []);

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
    setWinningCells(settled.totalPayout > 0 ? winningCellsFor(columns, settled.wins) : Array.from({ length: REELS }, () => Array(ROWS).fill(false)));
    setSpinning(false);
    inFlight.current = false;

    if (settled.totalPayout > 0 || settled.triggeredFreeSpins > 0) {
      const token = calloutTokenRef.current + 1;
      calloutTokenRef.current = token;
      if (calloutTimerRef.current !== null) life.clearTimer(calloutTimerRef.current);
      setCallout({ token, payout: settled.totalPayout, freeSpins: settled.triggeredFreeSpins });
      calloutTimerRef.current = life.timeout(() => {
        // Back-to-back results each get their full duration: only the newest
        // token is allowed to clear the overlay.
        if (calloutTokenRef.current === token) setCallout(null);
      }, reducedRef.current ? 1200 : 2400);
    }
  }, [life]);

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
        const p = Math.min(1, (time - plan.start) / plan.duration);
        const eased = 1 - Math.pow(1 - p, 3);
        posRef.current[reel] = plan.from + (plan.target - plan.from) * eased;
        if (!life.isHidden()) paint(reel);
        if (p >= 1) {
          posRef.current[reel] = plan.target;
          paint(reel);
          planRef.current[reel] = null;
          modeRef.current[reel] = 'idle';
          promote(reel, false);
          if (reel === REELS - 1) finished = true;
        } else {
          active = true;
        }
      }
    }

    if (active) loopRef.current = life.raf(loop);
    else lastFrameRef.current = 0;
    if (finished) commitResult();
  }, [life, paint, promote, commitResult]);

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
    setFair(null);
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
        };
        pendingRef.current = { epoch, settled, columns };
        if (resp.fair) setFair(resp.fair);

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
              start: performance.now(),
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
  }, [spinning, user, canBet, bet, inFreeSpins, balance, life, stopMotion, ensureLoop, promote]);

  // A spin in flight or still stopping owns Back: no committed wager is dropped.
  const motionActive = () => modeRef.current.some((mode) => mode !== 'idle');
  const { requestBack } = useGameBack({
    isDetailsOpen: () => showFair,
    closeDetails: () => setShowFair(false),
    isBusy: () => spinning || inFlight.current || motionActive(),
    onBlocked: () => {
      setNotice(t('games.shared.finishSpinFirst'));
      life.timeout(() => setNotice(null), 2600);
    },
    onExit: onBack,
  });

  // D-pad movement only; OK/Select activation lives in useTvActivate.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const dir: FocusDir | null =
        e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right'
          : e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : null;
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
    <GameShell accent="plum">
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

      <div className="snow-slot-stage">
        <div className="snow-slot-cabinet">
          <span className="snow-slot-marquee">{t('games.slots.marquee')}</span>

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
                          <SlotSymbol symbolKey={key} size={Math.round(cellHeight * 0.62)} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            <span className="snow-slot-payline" style={{ top: cellHeight + 6 }} aria-hidden="true" />
            <span className="snow-slot-payline" style={{ top: cellHeight * 2 + 6 }} aria-hidden="true" />

            {callout && (
              <div className="snow-slot-overlay" data-callout-token={callout.token}>
                <div className="snow-slot-callout" role="status" aria-live="polite">
                  {callout.payout > 0 && t('games.slots.winChips', { amount: callout.payout.toLocaleString() })}
                  {callout.freeSpins > 0 && (
                    <small>
                      {t('games.slots.freeSpinsCallout')} · {t('games.slots.freeSpinsAwarded', { count: callout.freeSpins })}
                    </small>
                  )}
                </div>
                {callout.payout > 0 && <GameFxCanvas burstKey={callout.token} reduced={reducedFx} />}
              </div>
            )}
          </div>

          <div className="snow-slot-controls">
            <div className="snow-slot-bet">
              <span className="snow-rl-label">{t('games.slots.bet')}</span>
              <Button
                ref={minusBtnRef}
                type="button"
                variant="navy"
                size="icon"
                onFocus={() => setFocus('betMinus')}
                onClick={() => changeBet(-1)}
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
              {spinning ? <><Loader2 className="animate-spin" /> {t('games.slots.spinning')}</> : inFreeSpins ? t('games.slots.spinFree') : t('games.slots.spin')}
            </Button>
          </div>

          {errorMsg && <p className="snow-game-error">{errorMsg}</p>}
          {notice && <p className="snow-game-note" role="status">{notice}</p>}
          {!errorMsg && balance !== null && !canBet && user && !inFreeSpins && (
            <p className="snow-game-note">{t('games.slots.notEnoughChipsDailySpin')}</p>
          )}
        </div>

        <div className="snow-slot-info">
          <GamePanel>
            <b>{t('games.slots.paytable')}</b>
            <ul>
              {(['p1', 'p2', 'p3', 'p4'] as const).map((k) => (
                <li key={k}><span>{k.toUpperCase()}</span><span>{t('games.slots.topPayer')}</span></li>
              ))}
            </ul>
          </GamePanel>
          <GamePanel>
            <b>{t('games.slots.winsThisSpin')}</b>
            <ul>
              {result && result.wins.length > 0 ? result.wins.slice(0, 4).map((w, i) => (
                <li key={i}>
                  <span>{t('games.slots.winSymbolCount', { count: w.count, symbol: w.symbol.toUpperCase() })}</span>
                  <span>+{w.payout.toLocaleString()}</span>
                </li>
              )) : <li><span>{t('games.slots.paytableNote')}</span></li>}
              {result && result.scatterCount > 0 && (
                <li><span>{t('games.slots.scatters', { count: result.scatterCount })}</span></li>
              )}
              {result && result.totalPayout > 0 && (
                <li><span>{result.freeSpin && multiplier > 1
                  ? t('games.slots.totalPayoutMultiplier', { amount: result.totalPayout.toLocaleString(), multiplier })
                  : t('games.slots.totalPayout', { amount: result.totalPayout.toLocaleString() })}</span></li>
              )}
            </ul>
          </GamePanel>
        </div>
      </div>

      <FairnessPanel
        ref={fairBtnRef}
        fair={fair}
        open={showFair}
        onToggle={() => setShowFair((v) => !v)}
        focused={focus === 'fair'}
        onFocus={() => setFocus('fair')}
        labels={{ title: t('games.slots.provablyFair'), note: t('games.slots.spinToRevealSeed') }}
      />
    </GameShell>
  );
};

export default Slots;
