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
import { useReducedGameFx } from './shared/useReducedGameFx';
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
const REEL_KEYS = ['p1', 'p2', 'p3', 'p4', 'la', 'lk', 'lq', 'lj', 'wild', 'scatter'];
const LOW_LETTER: Record<string, string> = { la: 'A', lk: 'K', lq: 'Q', lj: 'J' };

const ROWS = 3;
const REELS = 5;

/* A short, reusable strip — 14 nodes per reel instead of 36. The server result
   always sits at RESULT_INDEX..RESULT_INDEX+2, which is exactly the visible
   window once the reel settles, and there is a bounded lead (9) and tail (2)
   so the travel never runs past either end of the array. */
const STRIP_LENGTH = 14;
const RESULT_INDEX = 9;
const SPIN_INDEX = 11; // furthest offset that still fills the 3-row window

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

const randomKey = () => REEL_KEYS[Math.floor(Math.random() * REEL_KEYS.length)];

/** Strip whose result window holds the three given symbols. */
export const buildStrip = (top: string, mid: string, bot: string): string[] => {
  const out = Array.from({ length: STRIP_LENGTH }, randomKey);
  out[RESULT_INDEX] = top;
  out[RESULT_INDEX + 1] = mid;
  out[RESULT_INDEX + 2] = bot;
  return out;
};

/** The three symbols a settled reel actually shows. */
export const visibleWindow = (strip: string[]): string[] => strip.slice(RESULT_INDEX, RESULT_INDEX + ROWS);

export const SLOTS_STRIP_LENGTH = STRIP_LENGTH;

/** Branded token — no emoji anywhere in the primary symbol set. */
function SlotSymbol({ symbolKey, size = 46 }: { symbolKey: string; size?: number }) {
  const key = REEL_KEYS.includes(symbolKey) ? symbolKey : 'p1';
  const img = SYMBOL_IMAGES[key];
  if (img) {
    return <img src={img} alt="" style={{ width: size, height: size, objectFit: 'contain' }} draggable={false} />;
  }
  if (key === 'wild') {
    return <span className="snow-slot-token snow-slot-token--wild" style={{ width: size * 1.35, height: size }}>WILD</span>;
  }
  if (key === 'scatter') {
    return <span className="snow-slot-token snow-slot-token--bonus" style={{ width: size * 1.35, height: size }}>BONUS</span>;
  }
  return (
    <span className="snow-slot-token snow-slot-token--low" style={{ width: size * 0.8, height: size }}>
      {LOW_LETTER[key] ?? key.toUpperCase()}
    </span>
  );
}

type FocusId = 'back' | 'betMinus' | 'betPlus' | 'spin' | 'fair';

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
  const [reelStrips, setReelStrips] = useState<string[][]>(() =>
    Array.from({ length: REELS }, () => buildStrip(randomKey(), randomKey(), randomKey())),
  );
  const [moving, setMoving] = useState<boolean[]>(() => Array(REELS).fill(false));
  const [winningCells, setWinningCells] = useState<boolean[][]>(() =>
    Array.from({ length: REELS }, () => Array(ROWS).fill(false)),
  );
  const [result, setResult] = useState<SpinResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fair, setFair] = useState<GameFairInfo | null>(null);
  const [showFair, setShowFair] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [freeBurst, setFreeBurst] = useState(false);
  const [freeSpinsRemaining, setFreeSpinsRemaining] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [focus, setFocus] = useState<FocusId>('spin');

  const inFlight = useRef(false);
  const spinBtnRef = useRef<HTMLButtonElement>(null);
  const backBtnRef = useRef<HTMLButtonElement>(null);
  const minusBtnRef = useRef<HTMLButtonElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const fairBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onResize = () => setCellHeight(cellHeightFor(window.innerHeight));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (focus === 'spin') spinBtnRef.current?.focus();
    else if (focus === 'back') backBtnRef.current?.focus();
    else if (focus === 'betMinus') minusBtnRef.current?.focus();
    else if (focus === 'betPlus') plusBtnRef.current?.focus();
    else if (focus === 'fair') fairBtnRef.current?.focus();
  }, [focus]);

  const inFreeSpins = freeSpinsRemaining > 0;
  const canBet = inFreeSpins || bet <= (balance ?? 0);
  const betIdx = BETS.indexOf(bet);

  const changeBet = useCallback((dir: 1 | -1) => {
    if (spinning || inFreeSpins) return;
    setBet((current) => {
      const idx = BETS.indexOf(current);
      return BETS[dir === 1 ? Math.min(BETS.length - 1, idx + 1) : Math.max(0, idx - 1)];
    });
  }, [spinning, inFreeSpins]);

  const stopAllReels = useCallback(() => {
    setSpinning(false);
    setMoving(Array(REELS).fill(false));
    inFlight.current = false;
  }, []);

  const handleSpin = useCallback(async () => {
    if (inFlight.current || spinning) return;
    if (!user) { setErrorMsg(t('games.slots.errorSignIn')); return; }
    if (balance === null && !inFreeSpins) { setErrorMsg(t('games.slots.errorLoadingChips')); return; }
    if (!inFreeSpins && !canBet) { setErrorMsg(t('games.slots.errorNotEnoughChips')); return; }
    inFlight.current = true;

    setErrorMsg(null);
    setResult(null);
    setFair(null);
    setWinningCells(Array.from({ length: REELS }, () => Array(ROWS).fill(false)));
    setSpinning(true);
    setReelStrips(Array.from({ length: REELS }, () => buildStrip(randomKey(), randomKey(), randomKey())));
    // Two frames: park each reel at the top of its short strip, then travel.
    setMoving(Array(REELS).fill(false));
    life.raf(() => life.raf(() => setMoving(Array(REELS).fill(true))));

    try {
      const clientSeed = crypto.getRandomValues(new Uint32Array(2)).join('-');
      const resp = await gameSocket.spinSlots(bet, clientSeed);

      if (resp?.ok === true && Array.isArray(resp.grid) && resp.grid.length === ROWS) {
        const grid: string[][] = resp.grid;
        const cols: string[][] = Array.from({ length: REELS }, (_, r) =>
          Array.from({ length: ROWS }, (_, row) => grid[row]?.[r] ?? REEL_KEYS[0]),
        );
        const settled: SpinResult = {
          grid,
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

        const baseDelay = reducedFx ? 380 : 780;
        const stagger = reducedFx ? 90 : 190;
        for (let i = 0; i < REELS; i++) {
          const idx = i;
          life.timeout(() => {
            // Swap in the committed server column and settle onto it.
            setReelStrips((prev) => {
              const next = [...prev];
              next[idx] = buildStrip(cols[idx][0], cols[idx][1], cols[idx][2]);
              return next;
            });
            setMoving((prev) => { const next = [...prev]; next[idx] = false; return next; });

            if (idx === REELS - 1) {
              setResult(settled);
              setFreeSpinsRemaining(settled.freeSpinsRemaining);
              setMultiplier(settled.multiplier || 1);

              const lit: boolean[][] = Array.from({ length: REELS }, () => Array(ROWS).fill(false));
              const winningSymbols = new Set(settled.wins.filter((w) => w.payout > 0).map((w) => w.symbol));
              if (settled.totalPayout > 0 && winningSymbols.size > 0) {
                for (let r = 0; r < REELS; r++) {
                  for (let row = 0; row < ROWS; row++) {
                    const sym = cols[r][row];
                    if (winningSymbols.has(sym) || sym === 'wild') lit[r][row] = true;
                  }
                }
              }
              setWinningCells(lit);
              setSpinning(false);
              if (settled.totalPayout > 0) {
                setCelebrate(true);
                life.timeout(() => setCelebrate(false), reducedFx ? 1100 : 2300);
              }
              if (settled.triggeredFreeSpins > 0) {
                setFreeBurst(true);
                life.timeout(() => setFreeBurst(false), reducedFx ? 1000 : 2100);
              }
              if (resp.fair) setFair(resp.fair);
              inFlight.current = false;
            }
          }, baseDelay + idx * stagger);
        }
      } else if (resp?.ok === false && resp.error === 'insufficient_balance') {
        stopAllReels(); setErrorMsg(t('games.slots.errorNotEnoughChips'));
      } else if (resp?.ok === false && resp.error === 'invalid_bet') {
        stopAllReels(); setErrorMsg(t('games.slots.errorInvalidBet'));
      } else if (resp?.error === 'game_disabled') {
        stopAllReels(); setErrorMsg(t('games.slots.errorGameDisabled'));
      } else {
        stopAllReels(); setErrorMsg(t('games.slots.errorSpinFailed'));
      }
    } catch {
      stopAllReels();
      setErrorMsg(t('games.slots.errorSpinFailed'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning, user, canBet, bet, inFreeSpins, balance, reducedFx, life, stopAllReels]);

  // D-pad focus movement only; OK/Select activation lives in useTvActivate.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        if (focus === 'spin') { e.preventDefault(); setFocus('betPlus'); }
        else if (focus === 'betPlus') { e.preventDefault(); setFocus('betMinus'); }
        else if (focus === 'fair') { e.preventDefault(); setFocus('spin'); }
      } else if (e.key === 'ArrowRight') {
        if (focus === 'betMinus') { e.preventDefault(); setFocus('betPlus'); }
        else if (focus === 'betPlus') { e.preventDefault(); setFocus('spin'); }
        else if (focus === 'spin') { e.preventDefault(); setFocus('fair'); }
        else if (focus === 'back') { e.preventDefault(); setFocus('spin'); }
      } else if (e.key === 'ArrowDown') {
        if (focus === 'back') { e.preventDefault(); setFocus('betMinus'); }
        else { e.preventDefault(); setFocus('fair'); }
      } else if (e.key === 'ArrowUp') {
        if (focus === 'fair') { e.preventDefault(); setFocus('spin'); }
        else if (focus !== 'back') { e.preventDefault(); setFocus('back'); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focus]);

  const reelHeight = cellHeight * ROWS;
  const spinDuration = reducedFx ? 1400 : 2600;
  const settleDuration = reducedFx ? 240 : 440;

  const reels = useMemo(() => Array.from({ length: REELS }, (_, i) => i), []);

  return (
    <GameShell accent="plum">
      <GameTopBar
        ref={backBtnRef}
        onBack={onBack}
        backLabel={t('games.slots.back')}
        balance={balance}
        status={status}
        title={t('games.slots.marquee')}
        phase={inFreeSpins ? t('games.slots.freeSpinsBanner', { remaining: freeSpinsRemaining, multiplier }) : t('games.slots.spinToWin')}
        backFocused={focus === 'back'}
        onBackFocus={() => setFocus('back')}
        reducedFx={reducedFx}
        onToggleFx={toggleReducedFx}
      />

      <div className="snow-slot-stage">
        <div className="snow-slot-cabinet">
          <span className="snow-slot-marquee">{t('games.slots.marquee')}</span>

          <div className="snow-slot-window" style={{ height: reelHeight + 12 }}>
            <div className="snow-slot-reels" style={{ height: reelHeight }}>
              {reels.map((reelIndex) => {
                const strip = reelStrips[reelIndex] ?? [];
                const isMoving = moving[reelIndex];
                const offset = -(isMoving ? SPIN_INDEX : RESULT_INDEX) * cellHeight;
                return (
                  <div key={reelIndex} className="snow-slot-reel" style={{ height: reelHeight }}>
                    <span className="snow-slot-reel__shade" aria-hidden="true" />
                    {!isMoving && winningCells[reelIndex]?.map((lit, row) => (lit ? (
                      <span key={`w-${row}`} className="snow-slot-cell__win" style={{ top: row * cellHeight, height: cellHeight, bottom: 'auto' }} />
                    ) : null))}
                    <div
                      className={`snow-slot-strip${isMoving ? ' is-moving' : ''}`}
                      style={{
                        transform: `translateY(${offset}px)`,
                        transition: `transform ${isMoving ? spinDuration : settleDuration}ms ${isMoving ? 'linear' : 'cubic-bezier(0.16,0.84,0.36,1)'}`,
                        opacity: isMoving ? 0.94 : 1,
                      }}
                    >
                      {strip.map((key, i) => (
                        <div key={i} className="snow-slot-cell" style={{ height: cellHeight }}>
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

            {celebrate && result && result.totalPayout > 0 && (
              <div className="snow-slot-overlay">
                <div className="snow-slot-callout" role="status" aria-live="polite">
                  {t('games.slots.winChips', { amount: result.totalPayout.toLocaleString() })}
                </div>
                <GameFxCanvas burstKey={result.totalPayout} reduced={reducedFx} />
              </div>
            )}
            {freeBurst && result && result.triggeredFreeSpins > 0 && (
              <div className="snow-slot-overlay">
                <div className="snow-slot-callout" role="status" aria-live="polite">
                  {t('games.slots.freeSpinsCallout')}
                  <small>{t('games.slots.freeSpinsAwarded', { count: result.triggeredFreeSpins })}</small>
                </div>
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
                aria-disabled={spinning || inFreeSpins || betIdx === 0 ? 'true' : undefined}
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
                aria-disabled={spinning || inFreeSpins || betIdx === BETS.length - 1 ? 'true' : undefined}
                data-tv-focused={focus === 'betPlus' ? 'true' : 'false'}
              >
                <Plus />
              </Button>
            </div>

            <Button
              ref={spinBtnRef}
              type="button"
              onFocus={() => setFocus('spin')}
              onClick={() => { if (!(spinning || !user || (!inFreeSpins && !canBet))) handleSpin(); }}
              aria-disabled={spinning || !user || (!inFreeSpins && !canBet) ? 'true' : undefined}
              data-busy={spinning ? 'true' : undefined}
              data-tv-focused={focus === 'spin' ? 'true' : 'false'}
              className={`${GAME_ACTION_CLASS} snow-slot-spin`}
            >
              {spinning ? <><Loader2 className="animate-spin" /> {t('games.slots.spinning')}</> : inFreeSpins ? t('games.slots.spinFree') : t('games.slots.spin')}
            </Button>
          </div>

          {errorMsg && <p className="snow-game-error">{errorMsg}</p>}
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
