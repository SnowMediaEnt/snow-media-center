import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disposeGameAudio,
  GAME_AUDIO_STORAGE_KEY,
  getGameAudioMuted,
  MAX_GAME_AUDIO_VOICES,
  playGameSound,
  setGameAudioMuted,
  subscribeGameAudioMuted,
  toggleGameAudioMuted,
  unlockGameAudioFromGesture,
  useGameAudio,
  type GameAudioCue,
} from './gameAudio';

class MockAudioParam {
  value = 0;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
}

class MockAudioNode {
  connect = vi.fn(() => this);
  disconnect = vi.fn();
}

class MockScheduledSource extends MockAudioNode {
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}

class MockOscillator extends MockScheduledSource {
  type: OscillatorType = 'sine';
  frequency = new MockAudioParam();
}

class MockBufferSource extends MockScheduledSource {
  buffer: AudioBuffer | null = null;
}

class MockGain extends MockAudioNode {
  gain = new MockAudioParam();
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];

  state: AudioContextState = 'suspended';
  currentTime = 1;
  sampleRate = 8_000;
  destination = new MockAudioNode();
  oscillators: MockOscillator[] = [];
  bufferSources: MockBufferSource[] = [];
  gains: MockGain[] = [];
  createBuffer = vi.fn((_channels: number, frames: number) => ({
    getChannelData: () => new Float32Array(frames),
  }));
  resume = vi.fn(async () => { this.state = 'running'; });
  suspend = vi.fn(async () => { this.state = 'suspended'; });
  close = vi.fn(async () => { this.state = 'closed'; });

  constructor() {
    MockAudioContext.instances.push(this);
  }

  createGain() {
    const gain = new MockGain();
    this.gains.push(gain);
    return gain;
  }

  createOscillator() {
    const oscillator = new MockOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createBufferSource() {
    const source = new MockBufferSource();
    this.bufferSources.push(source);
    return source;
  }
}

const trustedGesture = { isTrusted: true };
const syntheticGesture = { isTrusted: false };
const originalAudioContext = window.AudioContext;
const originalWebkitAudioContext = (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');

function installAudioContextMock(): void {
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    writable: true,
    value: MockAudioContext,
  });
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  Object.defineProperty(document, 'hidden', { configurable: true, value: state === 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(async () => {
  await disposeGameAudio();
  window.localStorage.clear();
  setGameAudioMuted(false);
  MockAudioContext.instances = [];
  installAudioContextMock();
  setVisibility('visible');
});

afterEach(async () => {
  await disposeGameAudio();
  window.localStorage.clear();
  if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
  if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden);
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    writable: true,
    value: originalAudioContext,
  });
  Object.defineProperty(window, 'webkitAudioContext', {
    configurable: true,
    writable: true,
    value: originalWebkitAudioContext,
  });
});

describe('game audio engine', () => {
  it('never creates WebAudio for programmatic input or an ordinary play call', async () => {
    expect(playGameSound('select')).toBe(false);
    expect(await unlockGameAudioFromGesture(syntheticGesture)).toBe(false);
    expect(MockAudioContext.instances).toHaveLength(0);
  });

  it('lazily creates and resumes one singleton from trusted user input', async () => {
    expect(await unlockGameAudioFromGesture(trustedGesture)).toBe(true);
    expect(await unlockGameAudioFromGesture(trustedGesture)).toBe(true);

    expect(MockAudioContext.instances).toHaveLength(1);
    expect(MockAudioContext.instances[0].resume).toHaveBeenCalledTimes(1);
    expect(playGameSound('select')).toBe(true);
  });

  it('falls back to webkitAudioContext for older Android WebViews', async () => {
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitAudioContext', {
      configurable: true,
      value: MockAudioContext,
    });

    expect(await unlockGameAudioFromGesture(trustedGesture)).toBe(true);
    expect(MockAudioContext.instances).toHaveLength(1);
  });

  it('supports every cue and builds the shared noise buffer only once', async () => {
    await unlockGameAudioFromGesture(trustedGesture);
    const cues: GameAudioCue[] = [
      'select', 'card', 'reelStop', 'win', 'lose', 'bonus',
      'plinkoPeg', 'plinkoLand', 'diceRoll', 'diceLand',
      'triviaCorrect', 'triviaWrong',
    ];

    cues.forEach((cue) => expect(playGameSound(cue)).toBe(true));

    const audioContext = MockAudioContext.instances[0];
    expect(audioContext.createBuffer).toHaveBeenCalledTimes(1);
    expect(audioContext.oscillators.length).toBeGreaterThan(0);
    expect(audioContext.bufferSources.length).toBeGreaterThan(0);
  });

  it('caps live cue voices and retires the oldest before adding another', async () => {
    await unlockGameAudioFromGesture(trustedGesture);
    for (let index = 0; index < MAX_GAME_AUDIO_VOICES + 1; index += 1) {
      expect(playGameSound('select')).toBe(true);
    }

    const firstSource = MockAudioContext.instances[0].oscillators[0];
    // Once for its scheduled end, then once immediately when evicted.
    expect(firstSource.stop).toHaveBeenCalledTimes(2);
  });

  it('persists mute, publishes changes and silences live cues immediately', async () => {
    await unlockGameAudioFromGesture(trustedGesture);
    expect(playGameSound('win')).toBe(true);
    const subscriber = vi.fn();
    const unsubscribe = subscribeGameAudioMuted(subscriber);

    setGameAudioMuted(true);

    expect(getGameAudioMuted()).toBe(true);
    expect(window.localStorage.getItem(GAME_AUDIO_STORAGE_KEY)).toBe('true');
    expect(subscriber).toHaveBeenCalledWith(true);
    expect(playGameSound('select')).toBe(false);
    expect(MockAudioContext.instances[0].suspend).toHaveBeenCalledTimes(1);

    toggleGameAudioMuted(trustedGesture);
    await waitFor(() => expect(MockAudioContext.instances[0].resume).toHaveBeenCalledTimes(2));
    expect(getGameAudioMuted()).toBe(false);
    unsubscribe();
  });

  it('stops and suspends when hidden, then requires another real gesture', async () => {
    await unlockGameAudioFromGesture(trustedGesture);
    expect(playGameSound('bonus')).toBe(true);

    setVisibility('hidden');
    expect(MockAudioContext.instances[0].suspend).toHaveBeenCalledTimes(1);
    expect(playGameSound('select')).toBe(false);

    setVisibility('visible');
    expect(playGameSound('select')).toBe(false);
    await unlockGameAudioFromGesture(trustedGesture);
    expect(playGameSound('select')).toBe(true);
  });

  it('disconnects nodes, closes the context and can start cleanly again', async () => {
    await unlockGameAudioFromGesture(trustedGesture);
    playGameSound('diceLand');
    const firstContext = MockAudioContext.instances[0];

    await disposeGameAudio();
    expect(firstContext.close).toHaveBeenCalledTimes(1);
    expect(firstContext.gains.every((gain) => gain.disconnect.mock.calls.length > 0)).toBe(true);

    await unlockGameAudioFromGesture(trustedGesture);
    expect(MockAudioContext.instances).toHaveLength(2);
  });
});

const HookHarness = () => {
  const audio = useGameAudio();
  return (
    <>
      <output>{audio.muted ? 'muted' : 'sound on'}</output>
      <button type="button" onClick={() => audio.toggleMuted()}>toggle</button>
    </>
  );
};

describe('useGameAudio', () => {
  it('shares the mute preference and removes its gesture bridge on unmount', async () => {
    const { unmount } = render(<HookHarness />);
    expect(screen.getByText('sound on')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    expect(screen.getByText('muted')).toBeTruthy();

    unmount();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(MockAudioContext.instances).toHaveLength(0);
  });
});
