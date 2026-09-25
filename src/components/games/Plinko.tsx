/* eslint-disable react-refresh/only-export-components -- pure motion math is exported for deterministic tests. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Coins, Gauge, Minus, Plus, RotateCcw, Snowflake, Sparkles, Target, Trophy, Zap } from 'lucide-react';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/button';
import { GameFxCanvas } from './shared/GameFxCanvas';
import { GameShell, SnowCoinBalance } from './shared/GameUI';
import { useGameBack } from './shared/gameBack';
import { isGlobalModalOpen, visualArrowDir } from './shared/gameInput';
import { useGameLifecycle } from './shared/gameLifecycle';
import { moveInRows, rehome, type FocusRows } from './shared/focusRows';
import { activateFocused, useTvActivate } from './shared/tvActivate';
import { useReducedGameFx } from './shared/useReducedGameFx';
import { useGameAudio } from './shared/gameAudio';
import { useAuth } from '@/hooks/useAuth';
import { useGameSocket } from '@/hooks/useGameSocket';
import { gameSocket } from '@/lib/gameSocket';
import { readSavedBet, saveSelectedBet } from './shared/gameBets';
import { PLINKO_CENTER_LANE, PLINKO_ROWS, PLINKO_SLOTS, plinkoSlotCenter, plinkoSlotFromPath, type PlinkoBoard } from './plinkoBoards';
import { createPlinkoPuck, stepPlinkoPuck, physicsMultipliers, PLINKO_PHYSICS_VERSION } from './plinkoPhysics.js';
import '@/styles/games-plinko.css';

interface PlinkoProps {
  onBack: () => void;
}

type Risk = 'chill' | 'classic' | 'wild';
type FocusId = 'back' | 'fx' | 'tower' | 'wide' | Risk | 'betDown' | 'betUp' | 'drop' | 'reset';

const ROWS = PLINKO_ROWS;
const STARTING_POINTS = 100;
const SLOT_COUNT = PLINKO_SLOTS;
const PLAYFIELD_LEFT = 2.5;
const PLAYFIELD_WIDTH = 95;
const STEP_X = PLAYFIELD_WIDTH / SLOT_COUNT;
const PEG_START_Y = 16.5;
const PEG_STEP_Y = 6.3;
const BEST_DROP_KEY = 'snow-plinko-best-drop-v1';
const ARCADE_BETS = [10, 25, 50, 100];
const BET_STORAGE_KEY = 'snow-plinko-bet-v1';
const SECRET_STORAGE_PREFIX = 'snow-plinko-client-secret-v1:';

const sha256 = async (input: string): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const newClientSeed = () => toHex(crypto.getRandomValues(new Uint8Array(32)));
const physicsSeedFromSecrets = async (serverSeed: string, clientSeed: string) => {
  const bytes = await sha256(`${serverSeed}:${clientSeed}`);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, false);
};

export interface PlinkoMotionPoint {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  offset: number;
  easing: 'gravity' | 'rebound';
  impact?: boolean;
}

export interface PlinkoMotion {
  points: PlinkoMotionPoint[];
  finalSlot: number;
}

export const PLINKO_RISK_MODES: Array<{
  id: Risk;
  label: string;
  note: string;
  multipliers: number[];
}> = [
  {
    id: 'chill',
    label: 'Chill',
    note: 'Soft landings',
    multipliers: physicsMultipliers('tower', 'chill'),
  },
  {
    id: 'classic',
    label: 'Classic',
    note: 'Balanced board',
    multipliers: physicsMultipliers('tower', 'classic'),
  },
  {
    id: 'wild',
    label: 'Wild',
    note: 'Huge edge scores',
    multipliers: physicsMultipliers('tower', 'wild'),
  },
];

const formatMultiplier = (value: number) => `${Number(value.toFixed(2))}×`;

const slotCenter = plinkoSlotCenter;

/** Alternating full-width rows leave the puck room to pass between pegs. */
export const PLINKO_PEGS = Array.from({ length: ROWS }, (_, row) => {
  const offset = row % 2 === 0 ? STEP_X / 2 : 0;
  const count = row % 2 === 0 ? SLOT_COUNT : SLOT_COUNT + 1;
  return Array.from({ length: count }, (_, column) => ({
    key: `${row}-${column}`,
    row,
    x: PLAYFIELD_LEFT + offset + column * STEP_X,
    y: PEG_START_Y + row * PEG_STEP_Y,
  }));
}).flat();

/** Legacy motion builder retained for old visual regression tests; live drops
 * now use the fixed-step collision simulation in plinkoPhysics.js. */
export const buildPlinkoMotion = (path: readonly boolean[], visualSeed = 0, startLane = PLINKO_CENTER_LANE): PlinkoMotion => {
  let noiseState = (visualSeed || 0x9e3779b9) >>> 0;
  const noise = () => {
    noiseState ^= noiseState << 13;
    noiseState ^= noiseState >>> 17;
    noiseState ^= noiseState << 5;
    return (noiseState >>> 0) / 0x100000000;
  };
  const rowWeights = path.map((_, index) => Math.max(.75, 1.08 - index * .03 + (noise() - .5) * .08));
  const landingWeight = .85;
  const totalWeight = rowWeights.reduce((total, weight) => total + weight, landingWeight);
  const points: PlinkoMotionPoint[] = [{
    x: slotCenter(startLane),
    y: 5,
    rotation: 0,
    scale: 1,
    offset: 0,
    easing: 'gravity',
  }];
  let halfLane = startLane * 2;
  let elapsed = 0;

  path.forEach((right, row) => {
    const weight = rowWeights[row];
    const pegX = slotCenter(startLane) + (halfLane - startLane * 2) * STEP_X / 2;
    const pegY = PEG_START_Y + row * PEG_STEP_Y;
    const energy = noise();
    elapsed += weight * .54;
    points.push({
      x: pegX,
      y: pegY - 2.65,
      rotation: right ? -8 : 8,
      scale: .84,
      offset: elapsed / totalWeight,
      easing: 'gravity',
      impact: true,
    });

    const direction = right ? 1 : -1;
    elapsed += weight * .16;
    points.push({
      x: pegX + direction * (1.15 + energy * .65),
      y: pegY - 3.25 - energy * .7,
      rotation: direction * (13 + energy * 10),
      scale: 1.06 + energy * .045,
      offset: elapsed / totalWeight,
      easing: 'rebound',
    });

    halfLane += direction;
    elapsed += weight * .30;
    points.push({
      x: slotCenter(startLane) + (halfLane - startLane * 2) * STEP_X / 2,
      y: pegY + 1.05,
      rotation: direction * 9,
      scale: 1,
      offset: elapsed / totalWeight,
      easing: 'gravity',
    });
  });

  const finalSlot = plinkoSlotFromPath(path, startLane);
  points.push({
    x: slotCenter(finalSlot),
    y: 89,
    rotation: 0,
    scale: 1,
    offset: 1,
    easing: 'gravity',
  });

  return { points, finalSlot };
};

const motionTransform = (
  point: Pick<PlinkoMotionPoint, 'x' | 'y' | 'rotation' | 'scale'>,
  width: number,
  height: number,
  originX = 50,
) => {
  const x = ((point.x - originX) / 100) * width;
  const y = ((point.y - 5) / 100) * height;
  return `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${point.rotation}deg) scale(${point.scale})`;
};

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
  const { user } = useAuth();
  const { balance, status } = useGameSocket();
  const life = useGameLifecycle();
  const { reducedFx, toggleReducedFx } = useReducedGameFx();
  const { play } = useGameAudio();
  useTvActivate(activateFocused);

  const [risk, setRisk] = useState<Risk>('classic');
  const [boardMode, setBoardMode] = useState<PlinkoBoard>('tower');
  const [dropLane, setDropLane] = useState(PLINKO_CENTER_LANE);
  const [dropping, setDropping] = useState(false);
  const [puckVisible, setPuckVisible] = useState(false);
  const [landing, setLanding] = useState<number | null>(null);
  const [lastAward, setLastAward] = useState<number | null>(null);
  const [lastCoinAward, setLastCoinAward] = useState<number | null>(null);
  const [bet, setBet] = useState(() => readSavedBet(BET_STORAGE_KEY));
  const [score, setScore] = useState(0);
  const [sessionCoinNet, setSessionCoinNet] = useState(0);
  const [drops, setDrops] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestDrop, setBestDrop] = useState(readBestDrop);
  const [impact, setImpact] = useState(false);
  const [burstKey, setBurstKey] = useState<number | null>(null);
  const [backNote, setBackNote] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusId>('drop');

  const backRef = useRef<HTMLButtonElement>(null);
  const fxRef = useRef<HTMLButtonElement>(null);
  const towerRef = useRef<HTMLButtonElement>(null);
  const wideRef = useRef<HTMLButtonElement>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const dropLaneRef = useRef(PLINKO_CENTER_LANE);
  const chillRef = useRef<HTMLButtonElement>(null);
  const classicRef = useRef<HTMLButtonElement>(null);
  const wildRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLButtonElement>(null);
  const betDownRef = useRef<HTMLButtonElement>(null);
  const betUpRef = useRef<HTMLButtonElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const puckRef = useRef<HTMLDivElement>(null);
  const motionFrame = useRef<number | null>(null);
  const dropEpoch = useRef(0);

  const activeMode = PLINKO_RISK_MODES.find((mode) => mode.id === risk) ?? PLINKO_RISK_MODES[1];
  const multipliers = boardMode === 'wide' ? physicsMultipliers('wide', risk, dropLane) : activeMode.multipliers;
  const betIndex = Math.max(0, ARCADE_BETS.indexOf(bet));
  const canAfford = !user || (balance !== null && balance >= bet);
  const canReset = !dropping && (score > 0 || drops > 0);
  const focusRows = useMemo<FocusRows>(() => [
    ['back', 'fx'],
    ...(!dropping ? [['tower', 'wide']] : []),
    ...(dropping ? [] : [['chill'], ['classic'], ['wild']]),
    ...(!dropping && user ? [['betDown', 'betUp']] : []),
    ['drop', ...(canReset ? ['reset'] : [])],
  ], [dropping, canReset, user]);

  const refFor = useCallback((id: FocusId): HTMLButtonElement | null => {
    if (id === 'back') return backRef.current;
    if (id === 'fx') return fxRef.current;
    if (id === 'tower') return towerRef.current;
    if (id === 'wide') return wideRef.current;
    if (id === 'chill') return chillRef.current;
    if (id === 'classic') return classicRef.current;
    if (id === 'wild') return wildRef.current;
    if (id === 'reset') return resetRef.current;
    if (id === 'betDown') return betDownRef.current;
    if (id === 'betUp') return betUpRef.current;
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

  useEffect(() => saveSelectedBet(BET_STORAGE_KEY, bet), [bet]);

  // Wide's gate sweeps continuously, like an arcade timing game. It changes
  // only a CSS left value per frame; React updates only when it enters a new
  // payout lane, keeping older Fire TV WebViews light.
  useEffect(() => {
    if (boardMode !== 'wide' || dropping) {
      if (gateRef.current && boardMode === 'tower') gateRef.current.style.left = `${slotCenter(PLINKO_CENTER_LANE)}%`;
      return;
    }
    let started: number | null = null;
    let frame: number | null = null;
    let previousLane = -1;
    const sweep = (now: number) => {
      if (started === null) started = now;
      const phase = ((now - started) / 2400) % 2;
      const position = phase <= 1 ? phase : 2 - phase;
      const lane = Math.max(0, Math.min(10, Math.round(position * 10)));
      dropLaneRef.current = lane;
      if (gateRef.current) gateRef.current.style.left = `${slotCenter(0) + position * (slotCenter(10) - slotCenter(0))}%`;
      if (lane !== previousLane) { previousLane = lane; setDropLane(lane); }
      frame = requestAnimationFrame(sweep);
    };
    frame = requestAnimationFrame(sweep);
    return () => { if (frame !== null) cancelAnimationFrame(frame); };
  }, [boardMode, dropping]);

  const finishDrop = useCallback((slot: number, multiplier: number, epoch: number, coinAward: number | null = null, betUsed = bet) => {
    if (!life.isMounted() || epoch !== dropEpoch.current) return;
    const award = Math.round(STARTING_POINTS * multiplier);
    setLanding(slot);
    setLastAward(award);
    setLastCoinAward(coinAward);
    if (coinAward !== null) setSessionCoinNet((current) => current + coinAward - betUsed);
    setScore((current) => current + award);
    setDrops((current) => current + 1);
    setStreak((current) => (multiplier >= 1.2 ? current + 1 : 0));
    setDropping(false);
    setImpact(true);
    play('plinkoLand');
    if (multiplier >= 4) play('bonus', { volume: 0.72 });
    life.timeout(() => setImpact(false), reducedFx ? 180 : 650);

    if (award > bestDrop) {
      setBestDrop(award);
      try { localStorage.setItem(BEST_DROP_KEY, String(award)); } catch { /* storage unavailable */ }
    }
    if (multiplier >= 4) setBurstKey((current) => (current ?? 0) + 1);
  }, [bestDrop, bet, life, play, reducedFx]);

  useEffect(() => () => {
    dropEpoch.current += 1;
    life.cancelRaf(motionFrame.current);
  }, [life]);

  const playPhysics = useCallback((seed: number, lane: number, onLanded: (slot: number) => void) => {
    const puckElement = puckRef.current;
    const boardElement = boardRef.current;
    if (!puckElement || !boardElement) return;
    const puck = createPlinkoPuck(seed, lane);
    const bounds = boardElement.getBoundingClientRect();
    const width = bounds.width || boardElement.clientWidth || 900;
    const height = bounds.height || boardElement.clientHeight || 560;
    const originX = slotCenter(lane);
    puckElement.style.transition = 'none';
    puckElement.style.left = `${originX}%`;
    puckElement.style.transform = motionTransform({ x: puck.x, y: puck.y, rotation: 0, scale: 1 }, width, height, originX);
    let lastSoundStep = -100;
    let started: number | null = null;
    const tick = (now: number) => {
      if (!puckRef.current || !life.isMounted()) return;
      if (started === null) started = now;
      // Fixed simulation steps remain independent of frame rate. Rendering is
      // transform-only; low-FX devices can skip paints without changing odds.
      const targetStep = Math.floor((now - started) * 0.12);
      let impact = false;
      while (!puck.done && puck.step < targetStep) {
        impact = stepPlinkoPuck(puck).impact || impact;
      }
      if (impact && puck.step - lastSoundStep > (reducedFx ? 18 : 9)) {
        lastSoundStep = puck.step;
        play('plinkoPeg', { volume: reducedFx ? .3 : .5 });
      }
      puckRef.current.style.transform = motionTransform({
        x: puck.x, y: puck.y, rotation: reducedFx ? 0 : Math.max(-28, Math.min(28, puck.vx * 1.3)),
        scale: impact && !reducedFx ? .91 : 1,
      }, width, height, originX);
      if (puck.done) {
        motionFrame.current = null;
        onLanded(puck.slot!);
      } else motionFrame.current = life.raf(tick);
    };
    life.cancelRaf(motionFrame.current);
    motionFrame.current = life.raf(tick);
  }, [life, play, reducedFx]);

  const dropPuck = useCallback(async () => {
    if (dropping || !canAfford) return;
    let selectedBoard = boardMode;
    let selectedLane = selectedBoard === 'wide' ? dropLaneRef.current : PLINKO_CENTER_LANE;
    let selectedRisk = activeMode.id;
    let selectedBet = bet;
    const epoch = ++dropEpoch.current;

    setLanding(null);
    setLastAward(null);
    setLastCoinAward(null);
    setBackNote(null);
    setImpact(false);
    setDropping(true);
    let seed = randomWord();
    let roundId: number | null = null;
    let clientSeed: string | null = null;
    const secretStorageKey = user ? `${SECRET_STORAGE_PREFIX}${user.id}` : '';
    if (user) {
      try {
        try { clientSeed = localStorage.getItem(secretStorageKey); } catch { /* storage unavailable */ }
        if (!clientSeed || !/^[0-9a-f]{64}$/.test(clientSeed)) clientSeed = newClientSeed();
        try {
          localStorage.setItem(secretStorageKey, clientSeed);
          if (localStorage.getItem(secretStorageKey) !== clientSeed) throw new Error('secret_not_saved');
        } catch {
          setDropping(false);
          setBackNote('This device cannot safely save a coin drop. Storage must be enabled.');
          return;
        }
        const clientCommit = toHex(await sha256(clientSeed));
        const response = await gameSocket.startPlinko({ bet, risk: selectedRisk, board: selectedBoard, dropLane: selectedLane, clientCommit });
        if (!response?.ok || response.physicsVersion !== PLINKO_PHYSICS_VERSION
          || !/^[0-9a-f]{64}$/.test(response.serverSeed)
          || !['tower', 'wide'].includes(response.board)
          || !['chill', 'classic', 'wild'].includes(response.risk)
          || !Number.isInteger(response.dropLane) || response.dropLane < 0 || response.dropLane > 10
          || !ARCADE_BETS.includes(response.bet) || !Number.isSafeInteger(response.roundId)) {
          setDropping(false);
          setPuckVisible(false);
          setBackNote(response?.error === 'insufficient_balance' ? 'Not enough Snow Coins for this drop.' : response?.error === 'plinko_pending_on_another_device' ? 'An unfinished drop is on another device.' : 'The Plinko server could not start that drop. Try again.');
          return;
        }
        seed = await physicsSeedFromSecrets(response.serverSeed, clientSeed);
        roundId = response.roundId;
        selectedBoard = response.board;
        selectedLane = response.dropLane;
        selectedRisk = response.risk;
        selectedBet = response.bet;
        if (response.resumed) setBackNote('Resuming your unfinished drop.');
        if (response.board !== boardMode) setBoardMode(response.board);
        if (response.risk !== risk) setRisk(response.risk);
        if (response.bet !== bet) setBet(response.bet);
        setDropLane(selectedLane);
      } catch {
        setDropping(false);
        setPuckVisible(false);
        setBackNote('The Plinko server is unavailable. Try again.');
        return;
      }
    }
    if (epoch !== dropEpoch.current || !life.isMounted()) return;
    setPuckVisible(true);
    const payoutTable = physicsMultipliers(selectedBoard, selectedRisk, selectedLane);
    playPhysics(seed, selectedLane, (slot) => {
      void (async () => {
        let coinAward: number | null = null;
        if (user && roundId !== null) {
          try {
            let response;
            try { response = await gameSocket.finishPlinko(roundId, slot, clientSeed!); }
            catch { response = await gameSocket.finishPlinko(roundId, slot, clientSeed!); }
            if (!response?.ok || response.slot !== slot) throw new Error('settlement_failed');
            coinAward = Number(response.payout);
            try { if (localStorage.getItem(secretStorageKey) === clientSeed) localStorage.removeItem(secretStorageKey); } catch { /* storage unavailable */ }
          } catch {
            if (life.isMounted() && epoch === dropEpoch.current) {
              setDropping(false);
              setBackNote('Could not confirm the landing. Your bet is saved; press Drop to resume this same puck.');
            }
            return;
          }
        }
        finishDrop(slot, payoutTable[slot], epoch, coinAward, selectedBet);
      })();
    });
  }, [activeMode, bet, boardMode, canAfford, dropping, finishDrop, life, playPhysics, risk, user]);

  const resetSession = useCallback(() => {
    if (dropping) return;
    setScore(0);
    setSessionCoinNet(0);
    setDrops(0);
    setStreak(0);
    setLanding(null);
    setLastAward(null);
    life.cancelRaf(motionFrame.current);
    motionFrame.current = null;
    if (puckRef.current) {
      puckRef.current.style.transition = 'none';
      puckRef.current.style.transform = 'translate3d(0, 0, 0) rotate(0deg) scale(1)';
    }
    setPuckVisible(false);
  }, [dropping, life]);

  return (
    <GameShell accent="ice" className={`snow-plinko snow-plinko--${boardMode}${dropping ? ' is-dropping' : ''}${impact ? ' is-impact' : ''}`}>
      <header className="snow-plinko-topbar">
        <BackButton
          ref={backRef}
          onClick={requestBack}
          label="Back to the Lounge"
          focused={focus === 'back'}
          data-tv-focused={focus === 'back' ? 'true' : 'false'}
          onFocus={() => setFocus('back')}
          className="snow-plinko-back"
        />

        <div className="snow-plinko-heading">
          <span className="snow-plinko-heading__mark" aria-hidden="true"><Snowflake /></span>
          <div><h1>Snow Plinko</h1><p>{user ? `${bet} Snow Coin drop · physics decides` : 'Guest free play · score only'}</p></div>
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
          {user && <SnowCoinBalance balance={balance} status={status} className="snow-plinko-wallet" />}
          {user ? (
            <div className="snow-plinko-score-badge" aria-label={`Snow Coin net ${sessionCoinNet.toLocaleString()}`}>
              <Coins aria-hidden="true" />
              <span><small>Snow Coin net</small><strong>{sessionCoinNet > 0 ? `+${sessionCoinNet.toLocaleString()}` : sessionCoinNet.toLocaleString()}</strong></span>
            </div>
          ) : (
            <div className="snow-plinko-score-badge" aria-label={`Practice score ${score.toLocaleString()}`}>
              <Trophy aria-hidden="true" />
              <span><small>Practice score</small><strong>{score.toLocaleString()}</strong></span>
            </div>
          )}
        </div>
      </header>

      <section className="snow-plinko-stage" aria-label="Snow Plinko game board">
        <div className="snow-plinko-machine">
          <div className="snow-plinko-marquee">
            <span aria-hidden="true"><Snowflake /></span>
            <div><strong>Snow Plinko</strong><small>Drop · bounce · score</small></div>
            <div className="snow-plinko-board-picker" role="group" aria-label="Board shape">
              {(['tower', 'wide'] as const).map((board) => <Button
                key={board}
                ref={board === 'tower' ? towerRef : wideRef}
                type="button"
                variant="navy"
                size="sm"
                aria-pressed={boardMode === board}
                aria-disabled={dropping ? 'true' : undefined}
                data-tv-focused={focus === board ? 'true' : 'false'}
                onFocus={() => setFocus(board)}
                onClick={() => { if (!dropping) { setBoardMode(board); setLanding(null); setLastAward(null); } }}
              >{board === 'tower' ? 'Tower' : 'Wide'}</Button>)}
            </div>
            {boardMode === 'wide' && <div className="snow-plinko-aim" aria-label="Automatic moving dropper"><span>DROP {dropLane + 1}/{SLOT_COUNT} · PRESS OK TO RELEASE</span></div>}
          </div>

          <div ref={boardRef} className="snow-plinko-board">
            <div className="snow-plinko-board__aurora" aria-hidden="true" />
            <div className="snow-plinko-wall snow-plinko-wall--left" aria-hidden="true" />
            <div className="snow-plinko-wall snow-plinko-wall--right" aria-hidden="true" />
            <div ref={gateRef} className="snow-plinko-gate" aria-hidden="true"><span /><Snowflake /><span /></div>
            <div className="snow-plinko-pegs" aria-hidden="true">
              {PLINKO_PEGS.map((peg) => (
                <span key={peg.key} style={{ left: `${peg.x}%`, top: `${peg.y}%` }} />
              ))}
            </div>
            <div
              ref={puckRef}
              className="snow-plinko-puck"
              style={{ left: `${slotCenter(boardMode === 'wide' ? dropLane : PLINKO_CENTER_LANE)}%` }}
              data-visible={puckVisible ? 'true' : 'false'}
              data-motion={reducedFx ? 'reduced' : 'bouncy'}
              aria-hidden="true"
            >
              <Snowflake />
            </div>

            <div className="snow-plinko-buckets" aria-label={`${activeMode.label} ${boardMode} multipliers for drop ${dropLane + 1}`}>
              {multipliers.map((multiplier, index) => (
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
            {PLINKO_RISK_MODES.map((mode) => {
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
                  <em>{formatMultiplier(Math.max(...(boardMode === 'wide' ? physicsMultipliers('wide', mode.id, dropLane) : mode.multipliers)))}</em>
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
              <><span className="snow-plinko-callout__icon" aria-hidden="true"><Trophy /></span><div><small>Nice landing</small><strong>{lastCoinAward === null ? `+${lastAward.toLocaleString()} points` : `${(lastCoinAward - bet) > 0 ? '+' : ''}${(lastCoinAward - bet).toLocaleString()} Snow Coins net`}</strong></div></>
            ) : (
              <><span className="snow-plinko-callout__icon" aria-hidden="true"><Zap /></span><div><small>{activeMode.label} board ready</small><strong>Press OK to drop</strong></div></>
            )}
          </div>

          <div
            className="snow-plinko-board-high"
            aria-label={`Board high score ${Math.round(STARTING_POINTS * Math.max(...multipliers)).toLocaleString()} points`}
          >
            <span aria-hidden="true"><Target /></span>
            <div>
              <small>Board high score</small>
              <strong>+{Math.round(STARTING_POINTS * Math.max(...multipliers)).toLocaleString()}</strong>
              <em>{boardMode === 'wide' ? 'Time your drop as the gate sweeps' : 'Find the glowing edge lanes'}</em>
            </div>
          </div>

          {backNote && <p className="snow-plinko-note" role="status">{backNote}</p>}

          <div className="snow-plinko-actions">
            {user && (
              <div className="snow-plinko-wager" aria-label={`Wager ${bet} Snow Coins`}>
                <Button ref={betDownRef} type="button" variant="navy" size="icon" aria-label="Lower wager" aria-disabled={betIndex === 0 || dropping ? 'true' : undefined} data-tv-focused={focus === 'betDown' ? 'true' : 'false'} onFocus={() => setFocus('betDown')} onClick={() => { if (betIndex > 0 && !dropping) setBet(ARCADE_BETS[betIndex - 1]); }}><Minus /></Button>
                <span><Coins /><small>BET</small><b>{bet}</b></span>
                <Button ref={betUpRef} type="button" variant="navy" size="icon" aria-label="Raise wager" aria-disabled={betIndex === ARCADE_BETS.length - 1 || dropping ? 'true' : undefined} data-tv-focused={focus === 'betUp' ? 'true' : 'false'} onFocus={() => setFocus('betUp')} onClick={() => { if (betIndex < ARCADE_BETS.length - 1 && !dropping) setBet(ARCADE_BETS[betIndex + 1]); }}><Plus /></Button>
              </div>
            )}
            <Button
              ref={dropRef}
              type="button"
              variant="gold"
              aria-label={dropping ? 'Puck dropping' : 'Drop puck'}
              aria-disabled={dropping || !canAfford ? 'true' : undefined}
              data-busy={dropping ? 'true' : undefined}
              data-tv-focused={focus === 'drop' ? 'true' : 'false'}
              onFocus={() => setFocus('drop')}
              onClick={() => { void dropPuck(); }}
              className="snow-plinko-drop"
            >
              <span className="snow-plinko-drop__disc" aria-hidden="true"><Snowflake /></span>
              <span><b>{dropping ? 'Dropping…' : 'Drop puck'}</b><small>{user ? `${bet} Snow Coins` : 'Free guest drop'}</small></span>
            </Button>
            {canReset && (
              <Button
                ref={resetRef}
                type="button"
                variant="navy"
                aria-label="Reset session totals"
                data-tv-focused={focus === 'reset' ? 'true' : 'false'}
                onFocus={() => setFocus('reset')}
                onClick={resetSession}
                className="snow-plinko-reset"
              >
                <RotateCcw aria-hidden="true" /> Reset
              </Button>
            )}
          </div>

          <p className="snow-plinko-disclaimer">Free entertainment coins only · no purchase required · no cash value</p>
        </aside>
      </section>

      <GameFxCanvas burstKey={burstKey} reduced={reducedFx} />
    </GameShell>
  );
};

export default Plinko;
