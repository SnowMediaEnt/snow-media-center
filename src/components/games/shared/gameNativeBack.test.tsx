import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gameOwnsHardwareBack, useGameBack } from './gameBack';
import { activateFocused, useTvActivate } from './tvActivate';

/**
 * On a real Fire TV / Android TV APK, Back arrives on Capacitor's
 * App.backButton listener, NOT as a DOM keydown. These are mocked integration
 * tests of that path — they are not a substitute for running a signed APK on a
 * device with a physical remote.
 */
const nativeListeners: Array<() => void> = [];
const removeSpy = vi.fn();

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_event: string, cb: () => void) => {
      nativeListeners.push(cb);
      return { remove: removeSpy };
    }),
  },
}));

interface HarnessProps {
  onExit: () => void;
  detailsOpen?: boolean;
  closeDetails?: () => void;
  busy?: boolean;
  onBlocked?: () => void;
}

const Harness = ({ onExit, detailsOpen = false, closeDetails, busy = false, onBlocked }: HarnessProps) => {
  const { requestBack } = useGameBack({
    isDetailsOpen: () => detailsOpen,
    closeDetails,
    isBusy: () => busy,
    onBlocked,
    onExit,
  });
  return <button type="button" onClick={requestBack}>back</button>;
};

/** Renders and waits for the async native listener registration to settle. */
const mountGame = async (props: HarnessProps) => {
  const view = render(<Harness {...props} />);
  await act(async () => { await Promise.resolve(); });
  return view;
};

const pressNativeBack = () => act(() => { nativeListeners.forEach((cb) => cb()); });

const openModal = () => {
  const modal = document.createElement('div');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('data-test-modal', 'true');
  document.body.appendChild(modal);
  return modal;
};

beforeEach(() => {
  nativeListeners.length = 0;
  removeSpy.mockClear();
});

afterEach(() => {
  document.querySelectorAll('[data-test-modal="true"]').forEach((n) => n.remove());
});

describe('native hardware Back inside a casino game', () => {
  it('exits exactly once in a safe phase', async () => {
    const onExit = vi.fn();
    await mountGame({ onExit });
    await pressNativeBack();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('closes fairness details first and stays on the game', async () => {
    const onExit = vi.fn();
    const closeDetails = vi.fn();
    await mountGame({ onExit, detailsOpen: true, closeDetails });
    await pressNativeBack();
    expect(closeDetails).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('never abandons a committed hand or spin', async () => {
    const onExit = vi.fn();
    const onBlocked = vi.fn();
    await mountGame({ onExit, busy: true, onBlocked });
    await pressNativeBack();
    await pressNativeBack();
    expect(onExit).not.toHaveBeenCalled();
    expect(onBlocked).toHaveBeenCalled();
  });

  it('counts one press when a device delivers BOTH the native event and a DOM key', async () => {
    const onExit = vi.fn();
    await mountGame({ onExit });
    await pressNativeBack();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('releases the press latch so a later native press still works', async () => {
    vi.useFakeTimers();
    try {
      const onExit = vi.fn();
      const view = render(<Harness onExit={onExit} />);
      await act(async () => { await Promise.resolve(); });
      await pressNativeBack();
      expect(onExit).toHaveBeenCalledTimes(1);
      act(() => { vi.advanceTimersByTime(500); });
      await pressNativeBack();
      expect(onExit).toHaveBeenCalledTimes(2);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('yields the press while a global modal is open', async () => {
    const onExit = vi.fn();
    const onBlocked = vi.fn();
    await mountGame({ onExit, onBlocked });
    openModal();
    await pressNativeBack();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onExit).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('owns hardware Back only while mounted, and removes its native listener', async () => {
    const onExit = vi.fn();
    const { unmount } = await mountGame({ onExit });
    expect(gameOwnsHardwareBack()).toBe(true);
    unmount();
    expect(gameOwnsHardwareBack()).toBe(false);
    expect(removeSpy).toHaveBeenCalled();
    await pressNativeBack();
    expect(onExit).not.toHaveBeenCalled();
  });
});

describe('OK/Select yields to a global modal', () => {
  const ActivateHarness = ({ onActivate }: { onActivate: (el: HTMLElement | null) => void }) => {
    useTvActivate(onActivate);
    return (
      <button type="button" data-tv-focused="true">spin</button>
    );
  };

  it('does not activate the control behind an open modal', () => {
    const onActivate = vi.fn();
    render(<ActivateHarness onActivate={onActivate} />);
    openModal();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('activates the focused control exactly once when nothing covers the game', () => {
    const onActivate = vi.fn();
    render(<ActivateHarness onActivate={onActivate} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    fireEvent.keyUp(window, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('activateFocused ignores an aria-disabled target', () => {
    const onPress = vi.fn();
    const { getByRole } = render(
      <button type="button" data-tv-focused="true" aria-disabled="true" onClick={onPress}>spin</button>,
    );
    activateFocused(getByRole('button'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
