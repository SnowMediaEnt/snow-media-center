/* eslint-disable react-refresh/only-export-components -- pure game rules are exported for deterministic tests. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dices, LockKeyhole, RotateCcw, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GAME_ACTION_CLASS, GameShell, GameTopBar } from './shared/GameUI';
import { useGameLifecycle } from './shared/gameLifecycle';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { useGameBack } from './shared/gameBack';
import { isGlobalModalOpen, visualArrowDir } from './shared/gameInput';
import { moveInRows, rehome, type FocusRows } from './shared/focusRows';
import { useGameAudio } from './shared/gameAudio';
import '@/styles/games-dice.css';

interface DiceLoungeProps {
  onBack: () => void;
}

export type DieValue = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type DiceCategoryKey =
  | 'ready'
  | 'five-kind'
  | 'large-straight'
  | 'small-straight'
  | 'four-kind'
  | 'full-house'
  | 'three-kind'
  | 'two-pair'
  | 'pair'
  | 'high-roll';

export interface DiceScore {
  key: DiceCategoryKey;
  label: string;
  score: number;
  detail: string;
}

const MAX_ROLLS = 3;
const FULL_ROLL_MS = 760;
const EMPTY_DICE: DieValue[] = [0, 0, 0, 0, 0];
const EMPTY_HOLDS = [false, false, false, false, false];

export const DICE_SCORE_RULES: ReadonlyArray<{ key: DiceCategoryKey; label: string; value: string }> = [
  { key: 'five-kind', label: 'Five of a Kind', value: '50' },
  { key: 'large-straight', label: 'Large Straight', value: '40' },
  { key: 'small-straight', label: 'Small Straight', value: '30' },
  { key: 'full-house', label: 'Full House', value: '25' },
  { key: 'four-kind', label: 'Four of a Kind', value: 'Dice total' },
  { key: 'three-kind', label: 'Three of a Kind', value: 'Dice total' },
  { key: 'two-pair', label: 'Two Pair', value: 'Pairs total' },
  { key: 'pair', label: 'Pair', value: 'Pair total' },
];

const isFace = (value: number): value is Exclude<DieValue, 0> =>
  Number.isInteger(value) && value >= 1 && value <= 6;

const secureFace = (): Exclude<DieValue, 0> => {
  try {
    const draw = new Uint32Array(1);
    crypto.getRandomValues(draw);
    return ((draw[0] % 6) + 1) as Exclude<DieValue, 0>;
  } catch {
    return (Math.floor(Math.random() * 6) + 1) as Exclude<DieValue, 0>;
  }
};

/** Pure roll helper: held dice never move and every open die receives one face. */
export const rollDice = (
  current: readonly DieValue[],
  held: readonly boolean[],
  nextFace: () => Exclude<DieValue, 0> = secureFace,
): DieValue[] => Array.from({ length: 5 }, (_, index) => (
  held[index] && isFace(current[index]) ? current[index] : nextFace()
));

/** Best poker-dice category for the visible five dice. */
export const scoreDice = (dice: readonly number[]): DiceScore => {
  if (dice.length !== 5 || dice.some((value) => !isFace(value))) {
    return { key: 'ready', label: 'Ready to Roll', score: 0, detail: 'Roll all five dice to start the round.' };
  }

  const total = dice.reduce((sum, value) => sum + value, 0);
  const counts = new Map<number, number>();
  dice.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const groupSizes = groups.map(([, count]) => count);
  const unique = [...counts.keys()].sort((a, b) => a - b);
  const hasRun = (run: readonly number[]) => run.every((value) => counts.has(value));

  if (groupSizes[0] === 5) {
    return { key: 'five-kind', label: 'Five of a Kind', score: 50, detail: 'Lounge jackpot — every die matches.' };
  }
  if (unique.length === 5 && unique[4] - unique[0] === 4) {
    return { key: 'large-straight', label: 'Large Straight', score: 40, detail: 'Five in sequence.' };
  }
  if (groupSizes[0] === 4) {
    return { key: 'four-kind', label: 'Four of a Kind', score: total, detail: `Four matching dice · ${total} points.` };
  }
  if (groupSizes[0] === 3 && groupSizes[1] === 2) {
    return { key: 'full-house', label: 'Full House', score: 25, detail: 'A triple and a pair.' };
  }
  if (hasRun([1, 2, 3, 4]) || hasRun([2, 3, 4, 5]) || hasRun([3, 4, 5, 6])) {
    return { key: 'small-straight', label: 'Small Straight', score: 30, detail: 'Four in sequence.' };
  }
  if (groupSizes[0] === 3) {
    return { key: 'three-kind', label: 'Three of a Kind', score: total, detail: `Three matching dice · ${total} points.` };
  }

  const pairs = groups.filter(([, count]) => count === 2).map(([value]) => value);
  if (pairs.length >= 2) {
    const pairScore = (pairs[0] + pairs[1]) * 2;
    return { key: 'two-pair', label: 'Two Pair', score: pairScore, detail: `Two matched pairs · ${pairScore} points.` };
  }
  if (pairs.length === 1) {
    const pairScore = pairs[0] * 2;
    return { key: 'pair', label: 'Pair', score: pairScore, detail: `One matched pair · ${pairScore} points.` };
  }
  return { key: 'high-roll', label: 'High Roll', score: total, detail: `No combination · ${total} points.` };
};

const PIPS: Record<Exclude<DieValue, 0>, ReadonlyArray<readonly [number, number]>> = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [2, 1], [3, 1], [1, 3], [2, 3], [3, 3]],
};

const CUBE_FACES: ReadonlyArray<{
  value: Exclude<DieValue, 0>;
  side: 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';
}> = [
  { value: 1, side: 'front' },
  { value: 6, side: 'back' },
  { value: 3, side: 'right' },
  { value: 4, side: 'left' },
  { value: 2, side: 'top' },
  { value: 5, side: 'bottom' },
];

const LoungeMark = () => (
  <svg className="snow-dice-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
    <path d="M32 7v50M10.4 19.5l43.2 25M10.4 44.5l43.2-25" />
    <path d="m26 12 6 6 6-6M26 52l6-6 6 6M13 25l8-2-2-8M51 39l-8 2 2 8M13 39l8 2-2 8M51 25l-8-2 2-8" />
  </svg>
);

const DiePips = ({ value }: { value: Exclude<DieValue, 0> }) => (
  <>{PIPS[value].map(([row, column], pipIndex) => (
    <i
      key={`${row}-${column}-${pipIndex}`}
      className="snow-die__pip"
      style={{ gridRow: row, gridColumn: column }}
    />
  ))}</>
);

const Die = ({ value, index, held, focused, rolling, canHold, use3d, buttonRef, onFocus, onToggle }: {
  value: DieValue;
  index: number;
  held: boolean;
  focused: boolean;
  rolling: boolean;
  canHold: boolean;
  use3d: boolean;
  buttonRef: (element: HTMLButtonElement | null) => void;
  onFocus: () => void;
  onToggle: () => void;
}) => {
  const label = rolling
    ? `Die ${index + 1}, rolling`
    : value === 0
    ? `Die ${index + 1}, waiting for the first roll`
    : `Die ${index + 1}, ${value}${held ? ', held' : ', open'}`;
  const render3d = use3d && value > 0;
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`snow-die${render3d ? ' has-3d' : ''}${held ? ' is-held' : ''}${rolling ? ' is-rolling' : ''}${value === 0 ? ' is-empty' : ''}${canHold ? ' is-holdable' : ''}`}
      aria-label={canHold && value > 0 ? `${label}. ${held ? 'Unhold' : 'Hold'} this die.` : label}
      aria-pressed={value > 0 ? held : undefined}
      aria-disabled={!canHold ? 'true' : undefined}
      data-tv-focused={focused ? 'true' : 'false'}
      data-face={value || undefined}
      data-renderer={render3d ? '3d' : '2d'}
      tabIndex={canHold ? 0 : -1}
      onFocus={() => { if (canHold) onFocus(); }}
      onClick={() => { if (canHold) onToggle(); }}
    >
      <span className="snow-die__hold" aria-hidden="true">
        <LockKeyhole />
        {held ? 'HELD' : 'HOLD'}
      </span>
      {render3d && (
        <span className="snow-die__cube" aria-hidden="true">
          {CUBE_FACES.map((face) => (
            <span
              key={face.side}
              className={`snow-die__cube-face snow-die__cube-face--${face.side}`}
              data-cube-face={face.value}
            >
              <DiePips value={face.value} />
            </span>
          ))}
        </span>
      )}
      <span className="snow-die__face" aria-hidden="true">
        {isFace(value) ? <DiePips value={value} /> : <LoungeMark />}
      </span>
      <span className="snow-die__number" aria-hidden="true">{index + 1}</span>
    </button>
  );
};

type Phase = 'ready' | 'rolling' | 'choosing' | 'settled';
type FocusId = 'back' | 'fx' | 'roll' | 'bank' | 'next' | `die-${number}`;

const DiceLounge = ({ onBack }: DiceLoungeProps) => {
  const life = useGameLifecycle();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  const { play } = useGameAudio();
  useTvActivate(activateFocused);

  const [dice, setDice] = useState<DieValue[]>(EMPTY_DICE);
  const [rollingDice, setRollingDice] = useState<DieValue[] | null>(null);
  const [holds, setHolds] = useState<boolean[]>(EMPTY_HOLDS);
  const [phase, setPhase] = useState<Phase>('ready');
  const [rollsUsed, setRollsUsed] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [roundsPlayed, setRoundsPlayed] = useState(0);
  const [bankedResult, setBankedResult] = useState<DiceScore | null>(null);
  const [focus, setFocus] = useState<FocusId>('roll');
  const [backNote, setBackNote] = useState<string | null>(null);

  const rollingRef = useRef(false);
  const bankLockRef = useRef(false);
  const backRef = useRef<HTMLButtonElement>(null);
  const fxRef = useRef<HTMLButtonElement>(null);
  const rollRef = useRef<HTMLButtonElement>(null);
  const bankRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const dieRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const currentResult = useMemo(() => scoreDice(dice), [dice]);
  const canHold = phase === 'choosing' && rollsUsed > 0 && rollsUsed < MAX_ROLLS;
  const hasOpenDie = holds.some((held) => !held);
  const rollVisible = phase === 'ready' || phase === 'rolling' || (phase === 'choosing' && rollsUsed < MAX_ROLLS);
  const rollUsable = phase === 'ready' || (phase === 'choosing' && rollsUsed < MAX_ROLLS && hasOpenDie);

  const focusRows = useMemo<FocusRows>(() => {
    const top = ['back', 'fx'];
    if (phase === 'settled') return [top, ['next']];
    if (phase === 'rolling') return [top, ['roll']];
    const diceRow = canHold ? dice.map((_, index) => `die-${index}`) : [];
    const actions = [
      ...(rollUsable ? ['roll'] : []),
      ...(phase === 'choosing' ? ['bank'] : []),
    ];
    return [top, diceRow, actions];
  }, [phase, canHold, dice, rollUsable]);

  useEffect(() => {
    setFocus((current) => (rehome(focusRows, current) as FocusId) ?? 'back');
  }, [focusRows]);

  useEffect(() => {
    const target = focus === 'back' ? backRef.current
      : focus === 'fx' ? fxRef.current
        : focus === 'roll' ? rollRef.current
          : focus === 'bank' ? bankRef.current
            : focus === 'next' ? nextRef.current
              : dieRefs.current[Number(focus.slice(4))];
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  }, [focus]);

  const handleRoll = useCallback(() => {
    if (rollingRef.current || !rollUsable) return;
    rollingRef.current = true;
    const next = rollDice(dice, holds);
    const nextRoll = rollsUsed + 1;
    setBackNote(null);
    setPhase('rolling');
    setRollingDice(next);
    setFocus('roll');
    play('diceRoll');
    life.timeout(() => {
      if (!life.isMounted()) return;
      setDice(next);
      setRollingDice(null);
      setRollsUsed(nextRoll);
      setPhase('choosing');
      rollingRef.current = false;
      setFocus(nextRoll < MAX_ROLLS ? 'die-0' : 'bank');
      play('diceLand');
    }, reducedFx ? 150 : FULL_ROLL_MS);
  }, [dice, holds, life, play, reducedFx, rollUsable, rollsUsed]);

  const toggleHold = useCallback((index: number) => {
    if (!canHold || rollingRef.current) return;
    setHolds((current) => current.map((held, i) => (i === index ? !held : held)));
  }, [canHold]);

  const bankRound = useCallback(() => {
    if (phase !== 'choosing' || bankLockRef.current || currentResult.key === 'ready') return;
    bankLockRef.current = true;
    setBankedResult(currentResult);
    setTotalScore((score) => score + currentResult.score);
    setBestScore((score) => Math.max(score, currentResult.score));
    setRoundsPlayed((rounds) => rounds + 1);
    setPhase('settled');
    setFocus('next');
    play(currentResult.key === 'five-kind' || currentResult.key === 'large-straight' ? 'bonus' : 'win');
  }, [currentResult, phase, play]);

  const nextRound = useCallback(() => {
    if (phase !== 'settled') return;
    setDice([...EMPTY_DICE]);
    setRollingDice(null);
    setHolds([...EMPTY_HOLDS]);
    setRollsUsed(0);
    setBankedResult(null);
    bankLockRef.current = false;
    setPhase('ready');
    setFocus('roll');
  }, [phase]);

  const { requestBack } = useGameBack({
    isBusy: () => phase === 'rolling' || rollingRef.current,
    onBlocked: () => {
      setBackNote('The dice are still rolling.');
      life.timeout(() => setBackNote(null), 1800);
    },
    onExit: onBack,
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isGlobalModalOpen()) return;
      const direction = visualArrowDir(event);
      if (!direction) return;
      event.preventDefault();
      const next = moveInRows(focusRows, focus, direction);
      if (next) setFocus(next as FocusId);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focus, focusRows]);

  const rollLabel = phase === 'rolling'
    ? 'ROLLING…'
    : rollsUsed === 0
      ? 'ROLL ALL DICE'
      : rollsUsed === 1
        ? 'ROLL 2 OF 3'
        : 'FINAL ROLL';
  const result = phase === 'settled' && bankedResult ? bankedResult : currentResult;
  const visibleRound = phase === 'settled' ? Math.max(1, roundsPlayed) : roundsPlayed + 1;

  return (
    <GameShell accent="cobalt" className="snow-dice-game">
      <GameTopBar
        ref={backRef}
        onBack={requestBack}
        backLabel="Back"
        balance={null}
        showBalance={false}
        title="Dice Lounge"
        phase="Free play · no coins used"
        backFocused={focus === 'back'}
        onBackFocus={() => setFocus('back')}
        reducedFx={reducedFx}
        onToggleFx={toggleReducedFx}
        fxRef={fxRef}
        fxFocused={focus === 'fx'}
        onFxFocus={() => setFocus('fx')}
      />

      <div className="snow-dice-stage">
        <div className="snow-dice-layout">
          <section className="snow-dice-table" aria-label="Dice Lounge table">
            <div className="snow-dice-table__rail" aria-hidden="true" />
            <header className="snow-dice-table__header">
              <div className="snow-dice-brand">
                <span className="snow-dice-brand__seal"><LoungeMark /></span>
                <span><small>Snow Casino presents</small><strong>DICE LOUNGE</strong></span>
              </div>
              <div className="snow-dice-session" aria-label="Session score">
                <span><small>ROUND</small><b>{visibleRound}</b></span>
                <span><small>TOTAL</small><b>{totalScore}</b></span>
                <span><small>BEST</small><b>{bestScore}</b></span>
              </div>
            </header>

            <div className="snow-dice-tray">
              <div className="snow-dice-tray__label">
                <span>{phase === 'ready' ? 'THE TABLE IS OPEN' : `ROLL ${Math.min(rollsUsed + (phase === 'rolling' ? 1 : 0), MAX_ROLLS)} OF ${MAX_ROLLS}`}</span>
                <small>{canHold ? 'Select a die to hold it for the next roll' : rollsUsed >= MAX_ROLLS ? 'Three rolls complete — bank this hand' : 'Five dice · three rolls · best hand scores'}</small>
              </div>
              <div className="snow-dice-row" role="group" aria-label="Five dice">
                {dice.map((value, index) => (
                  <Die
                    key={index}
                    value={rollingDice?.[index] ?? value}
                    index={index}
                    held={holds[index]}
                    focused={focus === `die-${index}`}
                    rolling={phase === 'rolling' && !holds[index]}
                    canHold={canHold}
                    use3d={!reducedFx}
                    buttonRef={(element) => { dieRefs.current[index] = element; }}
                    onFocus={() => setFocus(`die-${index}`)}
                    onToggle={() => toggleHold(index)}
                  />
                ))}
              </div>
            </div>

            <div className={`snow-dice-result${phase === 'settled' ? ' is-banked' : ''}`} role="status" aria-live="polite">
              <span className="snow-dice-result__icon" aria-hidden="true">{phase === 'settled' ? '★' : '◆'}</span>
              <span className="snow-dice-result__copy">
                <small>{phase === 'settled' ? 'ROUND BANKED' : rollsUsed === 0 ? 'CURRENT HAND' : 'BEST CATEGORY'}</small>
                <strong>{result.label}</strong>
                <em>{phase === 'settled' ? `+${result.score} points added to your lounge total.` : result.detail}</em>
              </span>
              <b className="snow-dice-result__score">{result.score}<small>PTS</small></b>
            </div>

            <div className="snow-dice-controls">
              {rollVisible && (
                <Button
                  ref={rollRef}
                  type="button"
                  onFocus={() => setFocus('roll')}
                  onClick={() => { if (rollUsable) handleRoll(); }}
                  aria-disabled={!rollUsable ? 'true' : undefined}
                  data-busy={phase === 'rolling' ? 'true' : undefined}
                  data-tv-focused={focus === 'roll' ? 'true' : 'false'}
                  className={`${GAME_ACTION_CLASS} snow-dice-action snow-dice-action--roll`}
                >
                  <Dices aria-hidden="true" />
                  <span>{rollLabel}</span>
                </Button>
              )}
              {phase === 'choosing' && (
                <Button
                  ref={bankRef}
                  type="button"
                  variant="navy"
                  onFocus={() => setFocus('bank')}
                  onClick={bankRound}
                  data-tv-focused={focus === 'bank' ? 'true' : 'false'}
                  className="snow-dice-action snow-dice-action--bank tv-ring"
                >
                  <Trophy aria-hidden="true" />
                  <span>BANK {currentResult.score} POINTS</span>
                </Button>
              )}
              {phase === 'settled' && (
                <Button
                  ref={nextRef}
                  type="button"
                  onFocus={() => setFocus('next')}
                  onClick={nextRound}
                  data-tv-focused={focus === 'next' ? 'true' : 'false'}
                  className={`${GAME_ACTION_CLASS} snow-dice-action snow-dice-action--next`}
                >
                  <RotateCcw aria-hidden="true" />
                  <span>NEXT ROUND</span>
                </Button>
              )}
              <p className="snow-dice-controls__note">No wager. No purchase. Just roll.</p>
            </div>

            {backNote && <p className="snow-dice-back-note" role="status">{backNote}</p>}
          </section>

          <aside className="snow-dice-scorecard" aria-label="Dice Lounge score guide">
            <header>
              <span aria-hidden="true"><Trophy /></span>
              <div><small>HOUSE GUIDE</small><strong>HAND SCORES</strong></div>
            </header>
            <ol>
              {DICE_SCORE_RULES.map((rule, index) => (
                <li key={rule.key} className={result.key === rule.key && rollsUsed > 0 ? 'is-current' : undefined}>
                  <span className="snow-dice-scorecard__rank">{index + 1}</span>
                  <span><b>{rule.label}</b><small>{rule.value}</small></span>
                  {result.key === rule.key && rollsUsed > 0 && <i aria-label="Current category">CURRENT</i>}
                </li>
              ))}
            </ol>
            <div className="snow-dice-scorecard__tip">
              <LockKeyhole aria-hidden="true" />
              <p><b>LOUNGE TIP</b> Hold the dice you like, then reroll only the open dice.</p>
            </div>
          </aside>
        </div>
      </div>
    </GameShell>
  );
};

export default DiceLounge;
