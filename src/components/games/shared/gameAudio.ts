import { useCallback, useEffect, useState } from 'react';

export const GAME_AUDIO_STORAGE_KEY = 'snow-games-muted-v1';
export const MAX_GAME_AUDIO_VOICES = 8;

export type GameAudioCue =
  | 'select'
  | 'card'
  | 'reelStop'
  | 'win'
  | 'lose'
  | 'bonus'
  | 'plinkoPeg'
  | 'plinkoLand'
  | 'diceRoll'
  | 'diceLand'
  | 'triviaCorrect'
  | 'triviaWrong';

export interface GameAudioOptions {
  /** Per-cue trim. Values above one are intentionally clamped. */
  volume?: number;
}

export interface GameAudioGesture {
  /** Browser-generated input events are trusted; programmatic events are not. */
  readonly isTrusted: boolean;
}

export interface GameAudioControls {
  muted: boolean;
  play: (cue: GameAudioCue, options?: GameAudioOptions) => boolean;
  unlock: (gesture: GameAudioGesture) => Promise<boolean>;
  setMuted: (muted: boolean, gesture?: GameAudioGesture) => void;
  toggleMuted: (gesture?: GameAudioGesture) => void;
}

type WebkitWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

interface ActiveVoice {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  remaining: number;
  finished: boolean;
}

interface ToneSpec {
  type: OscillatorType;
  duration: number;
  gain: number;
  frequencies: ReadonlyArray<readonly [offsetSeconds: number, hertz: number]>;
  delay?: number;
}

interface NoiseSpec {
  duration: number;
  gain: number;
  delay?: number;
}

let context: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let gestureArmed = false;
let muted = readStoredMuted();
let bridgeUsers = 0;
let bridgeAttached = false;
let engineListenersAttached = false;
let lastPlinkoPegAt = -Infinity;

const activeVoices = new Set<ActiveVoice>();
const muteSubscribers = new Set<(nextMuted: boolean) => void>();

function readStoredMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(GAME_AUDIO_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function documentIsHidden(): boolean {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'hidden' || document.hidden;
}

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const audioWindow = window as WebkitWindow;
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

function persistMuted(nextMuted: boolean): void {
  try {
    window.localStorage.setItem(GAME_AUDIO_STORAGE_KEY, String(nextMuted));
  } catch {
    // Private browsing and locked-down TV WebViews can deny localStorage.
  }
}

function publishMuted(nextMuted: boolean): void {
  if (muted === nextMuted) return;
  muted = nextMuted;
  muteSubscribers.forEach((subscriber) => subscriber(nextMuted));
}

function safelySuspend(audioContext = context): void {
  if (!audioContext || audioContext.state !== 'running') return;
  try {
    void audioContext.suspend().catch(() => undefined);
  } catch {
    // Some older WebViews throw synchronously while the app is backgrounding.
  }
}

function finishVoice(voice: ActiveVoice, stopSources: boolean): void {
  if (voice.finished) return;
  voice.finished = true;
  activeVoices.delete(voice);

  if (stopSources) {
    voice.sources.forEach((source) => {
      try { source.stop(); } catch { /* already stopped */ }
    });
  }

  voice.nodes.forEach((node) => {
    try { node.disconnect(); } catch { /* already disconnected */ }
  });
  voice.sources.length = 0;
  voice.nodes.length = 0;
}

function stopAllVoices(): void {
  Array.from(activeVoices).forEach((voice) => finishVoice(voice, true));
}

function handleVisibilityChange(): void {
  if (!documentIsHidden()) return;
  gestureArmed = false;
  stopAllVoices();
  safelySuspend();
}

function handleStorage(event: StorageEvent): void {
  if (event.key !== GAME_AUDIO_STORAGE_KEY) return;
  const nextMuted = event.newValue === 'true';
  publishMuted(nextMuted);
  if (nextMuted) {
    gestureArmed = false;
    stopAllVoices();
    safelySuspend();
  }
}

function attachEngineListeners(): void {
  if (engineListenersAttached || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('storage', handleStorage);
  engineListenersAttached = true;
}

function detachEngineListeners(): void {
  if (!engineListenersAttached || typeof document === 'undefined') return;
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('storage', handleStorage);
  engineListenersAttached = false;
}

function ensureContext(): AudioContext | null {
  if (context && context.state !== 'closed') return context;
  const ContextConstructor = getAudioContextConstructor();
  if (!ContextConstructor) return null;

  try {
    context = new ContextConstructor();
    masterGain = context.createGain();
    masterGain.gain.value = 0.28;
    masterGain.connect(context.destination);
    noiseBuffer = null;
    return context;
  } catch {
    context = null;
    masterGain = null;
    return null;
  }
}

/**
 * Unlock audio from a browser-trusted pointer, touch, mouse or key event.
 * Merely calling playGameSound never creates or resumes an AudioContext.
 */
export async function unlockGameAudioFromGesture(gesture: GameAudioGesture): Promise<boolean> {
  if (!gesture?.isTrusted || muted || documentIsHidden()) return false;
  attachEngineListeners();

  const audioContext = ensureContext();
  if (!audioContext) return false;
  gestureArmed = true;

  if (audioContext.state === 'suspended') {
    try {
      await audioContext.resume();
    } catch {
      gestureArmed = false;
      return false;
    }
  }

  return audioContext.state !== 'closed';
}

function handleGesture(event: Event): void {
  void unlockGameAudioFromGesture(event);
}

function attachGestureBridge(): void {
  if (bridgeAttached || typeof document === 'undefined') return;
  // Boolean capture arguments work on older Android WebViews that predate
  // full AddEventListenerOptions support.
  document.addEventListener('pointerdown', handleGesture, true);
  document.addEventListener('touchstart', handleGesture, true);
  document.addEventListener('mousedown', handleGesture, true);
  document.addEventListener('keydown', handleGesture, true);
  bridgeAttached = true;
}

function detachGestureBridge(): void {
  if (!bridgeAttached || typeof document === 'undefined') return;
  document.removeEventListener('pointerdown', handleGesture, true);
  document.removeEventListener('touchstart', handleGesture, true);
  document.removeEventListener('mousedown', handleGesture, true);
  document.removeEventListener('keydown', handleGesture, true);
  bridgeAttached = false;
}

function retainGestureBridge(): () => void {
  bridgeUsers += 1;
  attachEngineListeners();
  attachGestureBridge();
  return () => {
    bridgeUsers = Math.max(0, bridgeUsers - 1);
    if (bridgeUsers === 0) detachGestureBridge();
  };
}

function beginVoice(): ActiveVoice | null {
  const audioContext = context;
  if (!audioContext || !masterGain) return null;

  if (activeVoices.size >= MAX_GAME_AUDIO_VOICES) {
    const oldest = activeVoices.values().next().value as ActiveVoice | undefined;
    if (oldest) finishVoice(oldest, true);
  }

  const voice: ActiveVoice = { sources: [], nodes: [], remaining: 0, finished: false };
  activeVoices.add(voice);
  return voice;
}

function addSource(voice: ActiveVoice, source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
  voice.sources.push(source);
  voice.nodes.push(source, ...nodes);
  voice.remaining += 1;
  source.onended = () => {
    if (voice.finished) return;
    voice.remaining -= 1;
    if (voice.remaining <= 0) finishVoice(voice, false);
  };
}

function addTone(voice: ActiveVoice, spec: ToneSpec, volume: number): void {
  const audioContext = context;
  if (!audioContext || !masterGain || spec.frequencies.length === 0) return;

  const start = audioContext.currentTime + (spec.delay ?? 0);
  const end = start + spec.duration;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = spec.type;

  const firstFrequency = spec.frequencies[0][1];
  oscillator.frequency.setValueAtTime(firstFrequency, start);
  spec.frequencies.slice(1).forEach(([offset, frequency]) => {
    oscillator.frequency.linearRampToValueAtTime(frequency, start + offset);
  });

  const peak = Math.max(0.0001, Math.min(0.22, spec.gain * volume));
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peak, start + Math.min(0.012, spec.duration * 0.25));
  gain.gain.linearRampToValueAtTime(0.0001, end);

  oscillator.connect(gain);
  gain.connect(masterGain);
  addSource(voice, oscillator, [gain]);
  oscillator.start(start);
  oscillator.stop(end + 0.005);
}

function getNoiseBuffer(audioContext: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const frameCount = Math.max(1, Math.floor(audioContext.sampleRate * 0.22));
  const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) {
    // Taper the shared buffer so abrupt source stops never click.
    const envelope = 1 - (index / samples.length);
    samples[index] = ((Math.random() * 2) - 1) * envelope;
  }
  noiseBuffer = buffer;
  return buffer;
}

function addNoise(voice: ActiveVoice, spec: NoiseSpec, volume: number): void {
  const audioContext = context;
  if (!audioContext || !masterGain) return;

  const start = audioContext.currentTime + (spec.delay ?? 0);
  const end = start + Math.min(0.22, spec.duration);
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = getNoiseBuffer(audioContext);

  const peak = Math.max(0.0001, Math.min(0.18, spec.gain * volume));
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peak, start + Math.min(0.008, spec.duration * 0.2));
  gain.gain.linearRampToValueAtTime(0.0001, end);

  source.connect(gain);
  gain.connect(masterGain);
  addSource(voice, source, [gain]);
  source.start(start);
  source.stop(end + 0.005);
}

function buildCue(voice: ActiveVoice, cue: GameAudioCue, volume: number): void {
  switch (cue) {
    case 'select':
      addTone(voice, { type: 'sine', duration: 0.065, gain: 0.1, frequencies: [[0, 520], [0.06, 690]] }, volume);
      break;
    case 'card':
      addNoise(voice, { duration: 0.052, gain: 0.07 }, volume);
      break;
    case 'reelStop':
      addTone(voice, { type: 'triangle', duration: 0.085, gain: 0.12, frequencies: [[0, 190], [0.08, 118]] }, volume);
      break;
    case 'win':
      addTone(voice, { type: 'sine', duration: 0.42, gain: 0.13, frequencies: [[0, 523], [0.13, 659], [0.27, 784], [0.4, 1047]] }, volume);
      break;
    case 'lose':
      addTone(voice, { type: 'triangle', duration: 0.28, gain: 0.1, frequencies: [[0, 294], [0.27, 147]] }, volume);
      break;
    case 'bonus':
      addTone(voice, { type: 'sine', duration: 0.62, gain: 0.14, frequencies: [[0, 440], [0.15, 659], [0.3, 880], [0.46, 1175], [0.6, 1320]] }, volume);
      addNoise(voice, { duration: 0.16, gain: 0.035, delay: 0.45 }, volume);
      break;
    case 'plinkoPeg':
      addTone(voice, { type: 'sine', duration: 0.035, gain: 0.06, frequencies: [[0, 980], [0.03, 740]] }, volume);
      break;
    case 'plinkoLand':
      addTone(voice, { type: 'triangle', duration: 0.18, gain: 0.13, frequencies: [[0, 220], [0.17, 330]] }, volume);
      addNoise(voice, { duration: 0.06, gain: 0.04 }, volume);
      break;
    case 'diceRoll':
      addNoise(voice, { duration: 0.2, gain: 0.07 }, volume);
      break;
    case 'diceLand':
      addTone(voice, { type: 'triangle', duration: 0.11, gain: 0.13, frequencies: [[0, 145], [0.1, 95]] }, volume);
      break;
    case 'triviaCorrect':
      addTone(voice, { type: 'sine', duration: 0.34, gain: 0.12, frequencies: [[0, 523], [0.16, 659], [0.32, 784]] }, volume);
      break;
    case 'triviaWrong':
      addTone(voice, { type: 'triangle', duration: 0.26, gain: 0.1, frequencies: [[0, 247], [0.25, 165]] }, volume);
      break;
  }
}

/** Play a short cue only after audio has been unlocked by real user input. */
export function playGameSound(cue: GameAudioCue, options: GameAudioOptions = {}): boolean {
  const audioContext = context;
  if (
    muted
    || documentIsHidden()
    || !gestureArmed
    || !audioContext
    || audioContext.state === 'closed'
    || !masterGain
  ) return false;

  if (cue === 'plinkoPeg') {
    const now = Date.now();
    if (now - lastPlinkoPegAt < 22) return false;
    lastPlinkoPegAt = now;
  }

  const volume = Math.max(0, Math.min(1, options.volume ?? 1));
  if (volume === 0) return false;

  const voice = beginVoice();
  if (!voice) return false;
  try {
    buildCue(voice, cue, volume);
    if (voice.remaining === 0) {
      finishVoice(voice, false);
      return false;
    }
    return true;
  } catch {
    finishVoice(voice, true);
    return false;
  }
}

export function getGameAudioMuted(): boolean {
  return muted;
}

export function subscribeGameAudioMuted(subscriber: (nextMuted: boolean) => void): () => void {
  muteSubscribers.add(subscriber);
  return () => { muteSubscribers.delete(subscriber); };
}

export function setGameAudioMuted(nextMuted: boolean, gesture?: GameAudioGesture): void {
  persistMuted(nextMuted);
  publishMuted(nextMuted);

  if (nextMuted) {
    gestureArmed = false;
    stopAllVoices();
    safelySuspend();
    return;
  }

  if (gesture?.isTrusted) void unlockGameAudioFromGesture(gesture);
}

export function toggleGameAudioMuted(gesture?: GameAudioGesture): void {
  setGameAudioMuted(!muted, gesture);
}

/**
 * Close the singleton and release every listener/node. This is intended for
 * app teardown and tests; normal game navigation can keep the tiny engine.
 */
export async function disposeGameAudio(): Promise<void> {
  detachGestureBridge();
  detachEngineListeners();
  bridgeUsers = 0;
  gestureArmed = false;
  lastPlinkoPegAt = -Infinity;
  stopAllVoices();

  const audioContext = context;
  const gain = masterGain;
  context = null;
  masterGain = null;
  noiseBuffer = null;

  if (gain) {
    try { gain.disconnect(); } catch { /* already disconnected */ }
  }
  if (audioContext && audioContext.state !== 'closed') {
    try { await audioContext.close(); } catch { /* WebView is already gone */ }
  }
}

/** Shared React facade for games and the lounge mute control. */
export function useGameAudio(): GameAudioControls {
  const [isMuted, setIsMuted] = useState(getGameAudioMuted);

  useEffect(() => {
    const releaseBridge = retainGestureBridge();
    const unsubscribe = subscribeGameAudioMuted(setIsMuted);
    return () => {
      unsubscribe();
      releaseBridge();
    };
  }, []);

  const play = useCallback((cue: GameAudioCue, options?: GameAudioOptions) => (
    playGameSound(cue, options)
  ), []);
  const unlock = useCallback((gesture: GameAudioGesture) => unlockGameAudioFromGesture(gesture), []);
  const setMuted = useCallback((nextMuted: boolean, gesture?: GameAudioGesture) => {
    setGameAudioMuted(nextMuted, gesture);
  }, []);
  const toggleMuted = useCallback((gesture?: GameAudioGesture) => {
    toggleGameAudioMuted(gesture);
  }, []);

  return { muted: isMuted, play, unlock, setMuted, toggleMuted };
}
