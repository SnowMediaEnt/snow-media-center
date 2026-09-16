import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gauge, RotateCcw, Snowflake, Sparkles, Target, Trophy, Zap } from 'lucide-react';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/button';
import { GameFxCanvas } from './shared/GameFxCanvas';
import { GameShell } from './shared/GameUI';
import { useGameBack } from './shared/gameBack';
import { isGlobalModalOpen, visualArrowDir } from './shared/gameInput';
import { useGameLifecycle } from './shared/gameLifecycle';
import { moveInRows, rehome, type FocusRows } from './shared/focusRows';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { useReducedGameFx } from './shared/useReducedGameFx';
import '@/styles/games-plinko.css';

interface PlinkoProps {
  onBack: () => void;
}

type Risk = 'chill' | 'classic' | 'wild';
type FocusId = 'back' | 'fx' | Risk | 'drop' | 'reset';

const ROWS = 10;
const STARTING_POINTS = 100;
const STEP_X = 7;
const BEST_DROP_KEY = 'snow-plinko-best-drop-v1';

const RISK_MODES: Array<{
  id: Risk;
  label: string;
  note: string;
  multipliers: number[];
}> = [
  {
    id: 'chill',
    label: 'Chill',
    note: 'Soft landings',
    multipliers: [4, 2, 1.5, 1.2, 1, 0.8, 1, 1.2, 1.5, 2, 4],
  },
  {
    id: 'classic',
    label: 'Classic',
    note: 'Balanced board',
    multipliers: [10, 4, 2, 1.2, 0.6, 0.4, 0.6, 1.2, 2, 4, 10],
  },
  {
    id: 'wild',
    label: 'Wild',
    note: 'Huge edge scores',
    multipliers: [25, 10, 4, 1, 0.4, 0.2, 0.4, 1, 4, 10, 25],
  },
];

const formatMultiplier = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}×`;

/** A single random word supplies every bounce; there is no server or wager. */
const randomWord = (): number => {
  try {
    const words = new Uint32Array(1);
    crypto.getRandomValues(words);
    return words[0];
  } catch {
    return Math.floor(Math.random() * 0x100000000);
  }
};

const readBestDrop = (): number => {
  try {
    const value = Number(localStorage.getItem(BEST_DROP_KEY));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
};

const Plinko = ({ onBack }: PlinkoProps) => {
  const life = useGameLifecycle();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  useTvActivate(activateFocused);

  const [risk, setRisk] = useState<Risk>('classic');
  const [dropping, setDropping] = useState(false);
  const [puck, setPuck] = useState({ x: 50, y: 5, visible: false });
  const [landing, setLanding] = useState<number | null>(null);
  const [lastAward, setLastAward] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [drops, setDrops] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestDrop, setBestDrop] = useState(readBestDrop);
  const [impact, setImpact] = useState(false);
  const [burstKey, setBurstKey] = useState<number | null>(null);
  const [backNote, setBackNote] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusId>('drop');

  const backRef = useRef<HTMLButtonElement>(null);
  const fxRef = useRef<HTMLButtonElement>(null);
  const chillRef = useRef<HTMLButtonElement>(null);
  const classicRef = useRef<HTMLButtonElement>(null);
  const wildRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLButtonElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const dropEpoch = useRef(0);

  const activeMode = RISK_MODES.find((mode) => mode.id === risk) ?? RISK_MODES[1];
  const canReset = !dropping && (score > 0 || drops > 0);
  const focusRows = useMemo<FocusRows>(() => [
    ['back', 'fx'],
    ...(dropping ? [] : [['chill', 'classic', 'wild']]),
    ['drop', ...(canReset ? ['reset'] : [])],
  ], [dropping, canReset]);

  const refFor = useCallback((id: FocusId): HTMLButtonElement | null => {
    if (id === 'back') return backRef.current;
    if (id === 'fx') return fxRef.current;
    if (id === 'chill') return chillRef.current;
    if (id === 'classic') return classicRef.current;
    if (id === 'wild') return wildRef.current;
    if (id === 'reset') return resetRef.current;
    return dropRef.current;
  }, []);

  // Re-home to a usable control after a phase change, then keep DOM and the
  // visible TV cursor on the same target.
  useEffect(() => {
    const next = (rehome(focusRows, focus) as FocusId | null) ?? 'back';
    if (next !== focus) {
      setFocus(next);
      return;
    }
    refFor(next)?.focus({ preventScroll: true });
  }, [focus, focusRows, refFor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isGlobalModalOpen()) return;
      const direction = visualArrowDir(event);
      if (!direction) return;
      event.preventDefault();
      setFocus((current) => (moveInRows(focusRows, current, direction) as FocusId | null) ?? current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusRows]);

  const { requestBack } = useGameBack({
    isBusy: () => dropping,
    onBlocked: () => {
      setBackNote('Let the puck land first');
      life.timeout(() => setBackNote(null), 2200);
    },
    onExit: onBack,
  });

  const finishDrop = useCallback((slot: number, mode: typeof RISK_MODES[number], epoch: number) => {
    if (!life.isMounted() || epoch !== dropEpoch.current) return;
    const multiplier = mode.multipliers[slot];
    const award = Math.round(STARTING_POINTS * multiplier);
    setLanding(slot);
    setLastAward(award);
    setScore((current) => current + award);
    setDrops((current) => current + 1);
    setStreak((current) => (multiplier >= 1.2 ? current + 1 : 0));
    setDropping(false);
    setImpact(true);
    life.timeout(() => setImpact(false), reducedFx ? 180 : 650);

    if (award > bestDrop) {
      setBestDrop(award);
      try { localStorage.setItem(BEST_DROP_KEY, String(award)); } catch { /* storage unavailable */ }
    }
    if (multiplier >= 4) setBurstKey((current) => (current ?? 0) + 1);
  }, [bestDrop, life, reducedFx]);

  const dropPuck = useCallback(() => {
    if (dropping) return;
    const mode = activeMode;
    const word = randomWord();
    const path = Array.from({ length: ROWS }, (_, index) => ((word >>> index) & 1) === 1);
    const finalSlot = path.reduce((total, right) => total + (right ? 1 : 0), 0);
    const epoch = ++dropEpoch.current;
    const stepMs = reducedFx ? 42 : 130;
    let rights = 0;

    setLanding(null);
    setLastAward(null);
    setBackNote(null);
    setImpact(false);
    setDropping(true);
    setPuck({ x: 50, y: 5, visible: true });

    const advance = (row: number) => {
      if (!life.isMounted() || epoch !== dropEpoch.current) return;
      if (row >= ROWS) {
        setPuck({ x: 50 + (finalSlot - ROWS / 2) * STEP_X, y: 85, visible: true });
        life.timeout(() => finishDrop(finalSlot, mode, epoch), reducedFx ? 70 : 210);
        return;
      }
      if (path[row]) rights += 1;
      setPuck({
        x: 50 + (rights - (row + 1) / 2) * STEP_X,
        y: 15 + row * 6.15,
        visible: true,
      });
      life.timeout(() => advance(row + 1), stepMs);
    };

    life.timeout(() => advance(0), reducedFx ? 20 : 80);
  }, [activeMode, dropping, finishDrop, life, reducedFx]);

  const resetSession = useCallback(() => {
    if (dropping) return;
    setScore(0);
    setDrops(0);
    setStreak(0);
    setLanding(null);
    setLastAward(null);
    setPuck({ x: 50, y: 5, visible: false });
  }, [dropping]);

  const pegs = useMemo(() => Array.from({ length: ROWS }, (_, row) => (
    Array.from({ length: row + 1 }, (_, column) => ({
      key: `${row}-${column}`,
      x: 50 + (column - row / 2) * STEP_X,
      y: 15 + row * 6.15,
    }))
  )).flat(), []);

  return (
    <GameShell accent="ice" className={`snow-plinko${dropping ? ' is-dropping' : ''}${impact ? ' is-impact' : ''}`}>
      <header className="snow-plinko-topbar">
        <BackButton
          ref={backRef}
          onClick={requestBack}
          label="Back to the Lounge"
          focused={focus === 'back'}
          onFocus={() => setFocus('back')}
          className="snow-plinko-back"
        />

        <div className="snow-plinko-heading">
          <span className="snow-plinko-heading__mark" aria-hidden="true"><Snowflake /></span>
          <div><h1>Snow Plinko</h1><p>Free play · score only · no coins</p></div>
        </div>

        <div className="snow-plinko-topbar__right">
          <Button
            ref={fxRef}
            type="button"
            variant="navy"
            size="sm"
            onClick={toggleReducedFx}
            onFocus={() => setFocus('fx')}
            aria-pressed={reducedFx}
            data-tv-focused={focus === 'fx' ? 'true' : 'false'}
            className="snow-plinko-fx"
          >
            <Sparkles aria-hidden="true" /> {reducedFx ? 'FX Low' : 'FX Full'}
          </Button>
          <div className="snow-plinko-score-badge" aria-label={`Session score ${score.toLocaleString()}`}>
            <Trophy aria-hidden="true" />
            <span><small>Session score</small><strong>{score.toLocaleString()}</strong></span>
          </div>
        </div>
      </header>

      <section className="snow-plinko-stage" aria-label="Snow Plinko game board">
        <div className="snow-plinko-machine">
          <div className="snow-plinko-marquee" aria-hidden="true">
            <span><Snowflake /></span>
            <div><strong>Snow Plinko</strong><small>Drop · bounce · score</small></div>
            <i /><i /><i /><i /><i />
          </div>

          <div className="snow-plinko-board">
            <div className="snow-plinko-board__aurora" aria-hidden="true" />
            <div className="snow-plinko-gate" aria-hidden="true"><span /><Snowflake /><span /></div>
            <div className="snow-plinko-pegs" aria-hidden="true">
              {pegs.map((peg) => (
                <span key={peg.key} style={{ left: `${peg.x}%`, top: `${peg.y}%` }} />
              ))}
            </div>
            <div
              className="snow-plinko-puck"
              data-visible={puck.visible ? 'true' : 'false'}
              style={{ left: `${puck.x}%`, top: `${puck.y}%` }}
              aria-hidden="true"
            >
              <Snowflake />
            </div>

            <div className="snow-plinko-buckets" aria-label={`${activeMode.label} score multipliers`}>
              {activeMode.multipliers.map((multiplier, index) => (
                <div
                  key={`${risk}-${index}`}
                  className={`snow-plinko-bucket${landing === index ? ' is-winner' : ''}${multiplier >= 4 ? ' is-hot' : ''}`}
                  data-slot={index}
                >
                  <span>{formatMultiplier(multiplier)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="snow-plinko-machine__footer">
            <span>SMC ARCADE</span>
            <p>{lastAward === null ? 'Every drop starts with 100 points' : `Last drop  +${lastAward.toLocaleString()} points`}</p>
            <span>JUST FOR FUN</span>
          </div>
        </div>

        <aside className="snow-plinko-console">
          <div className="snow-plinko-console__head">
            <span aria-hidden="true"><Target /></span>
            <div><small>Choose your board</small><strong>Risk mode</strong></div>
            <Gauge aria-hidden="true" />
          </div>

          <div className="snow-plinko-modes" role="group" aria-label="Risk mode">
            {RISK_MODES.map((mode) => {
              const ref = mode.id === 'chill' ? chillRef : mode.id === 'classic' ? classicRef : wildRef;
              return (
                <Button
                  key={mode.id}
                  ref={ref}
                  type="button"
                  variant="navy"
                  aria-pressed={risk === mode.id}
                  aria-disabled={dropping ? 'true' : undefined}
                  data-tv-focused={focus === mode.id ? 'true' : 'false'}
                  onFocus={() => { if (!dropping) setFocus(mode.id); }}
                  onClick={() => { if (!dropping) setRisk(mode.id); }}
                  className={`snow-plinko-mode snow-plinko-mode--${mode.id}${risk === mode.id ? ' is-active' : ''}`}
                >
                  <span><b>{mode.label}</b><small>{mode.note}</small></span>
                  <em>{formatMultiplier(Math.max(...mode.multipliers))}</em>
                </Button>
              );
            })}
          </div>

          <div className="snow-plinko-stats">
            <div><small>Best drop</small><strong>{bestDrop.toLocaleString()}</strong></div>
            <div><small>Drops</small><strong>{drops}</strong></div>
            <div><small>Hot streak</small><strong>{streak}</strong></div>
          </div>

          <div className={`snow-plinko-callout${lastAward !== null ? ' has-result' : ''}`} role="status" aria-live="polite">
            {dropping ? (
              <><span className="snow-plinko-callout__icon" aria-hidden="true"><Snowflake /></span><div><small>Puck in motion</small><strong>Watch it bounce</strong></div></>
            ) : lastAward !== null ? (
              <><span className="snow-plinko-callout__icon" aria-hidden="true"><Trophy /></span><div><small>Nice landing</small><strong>+{lastAward.toLocaleString()} points</strong></div></>
            ) : (
              <><span className="snow-plinko-callout__icon" aria-hidden="true"><Zap /></span><div><small>{activeMode.label} board ready</small><strong>Press OK to drop</strong></div></>
            )}
          </div>

          <div
            className="snow-plinko-board-high"
            aria-label={`Board high score ${Math.round(STARTING_POINTS * Math.max(...activeMode.multipliers)).toLocaleString()} points`}
          >
            <span aria-hidden="true"><Target /></span>
            <div>
              <small>Board high score</small>
              <strong>+{Math.round(STARTING_POINTS * Math.max(...activeMode.multipliers)).toLocaleString()}</strong>
              <em>Find the glowing edge lanes</em>
            </div>
          </div>

          {backNote && <p className="snow-plinko-note" role="status">{backNote}</p>}

          <div className="snow-plinko-actions">
            <Button
              ref={dropRef}
              type="button"
              variant="gold"
              aria-label={dropping ? 'Puck dropping' : 'Drop puck'}
              aria-disabled={dropping ? 'true' : undefined}
              data-busy={dropping ? 'true' : undefined}
              data-tv-focused={focus === 'drop' ? 'true' : 'false'}
              onFocus={() => setFocus('drop')}
              onClick={dropPuck}
              className="snow-plinko-drop"
            >
              <span className="snow-plinko-drop__disc" aria-hidden="true"><Snowflake /></span>
              <span><b>{dropping ? 'Dropping…' : 'Drop puck'}</b><small>100 starting points</small></span>
            </Button>
            {canReset && (
              <Button
                ref={resetRef}
                type="button"
                variant="navy"
                aria-label="Reset session score"
                data-tv-focused={focus === 'reset' ? 'true' : 'false'}
                onFocus={() => setFocus('reset')}
                onClick={resetSession}
                className="snow-plinko-reset"
              >
                <RotateCcw aria-hidden="true" /> Reset
              </Button>
            )}
          </div>

          <p className="snow-plinko-disclaimer">No purchases · no prizes · score resets on refresh</p>
        </aside>
      </section>

      <GameFxCanvas burstKey={burstKey} reduced={reducedFx} />
    </GameShell>
  );
};

export default Plinko;
