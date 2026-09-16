import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { activateFocused, useTvActivate } from './tvActivate';

const Harness = ({ onHit, disabled = false }: { onHit: () => void; disabled?: boolean }) => {
  useTvActivate(activateFocused);
  return (
    <button type="button" autoFocus aria-disabled={disabled ? 'true' : undefined} onClick={onHit}>
      spin
    </button>
  );
};

/** Remote OK arrives as Enter / Space / Select / DPAD_CENTER(23) and repeats while held. */
const okDown = (init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyDown(window, { key: 'Enter', ...init });
const okUp = (init: Partial<KeyboardEventInit> = {}) =>
  fireEvent.keyUp(window, { key: 'Enter', ...init });

describe('TV one-activation guard', () => {
  it('activates the focused control exactly once per physical press', () => {
    const onHit = vi.fn();
    render(<Harness onHit={onHit} />);
    screen.getByRole('button').focus();
    okDown();
    okUp();
    expect(onHit).toHaveBeenCalledTimes(1);
  });

  it('activates the visible TV cursor when stale DOM focus is still on Back', () => {
    const onBack = vi.fn();
    const onNext = vi.fn();
    render(
      <>
        <button type="button" data-focus-id="back" data-tv-focused="false" onClick={onBack}>Back</button>
        <button type="button" data-tv-focused="true" onClick={onNext}>Next Round</button>
        <Harness onHit={() => {}} />
      </>,
    );
    const back = screen.getByRole('button', { name: 'Back' });
    const next = screen.getByRole('button', { name: 'Next Round' });
    back.focus();

    okDown();
    okUp();

    expect(onBack).not.toHaveBeenCalled();
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(next);
  });

  it('falls back to DOM focus if more than one managed cursor is present', () => {
    const onBack = vi.fn();
    const onFirst = vi.fn();
    const onSecond = vi.fn();
    render(
      <>
        <button type="button" onClick={onBack}>Back</button>
        <button type="button" data-tv-focused="true" onClick={onFirst}>First</button>
        <button type="button" data-tv-focused="true" onClick={onSecond}>Second</button>
        <Harness onHit={() => {}} />
      </>,
    );
    screen.getByRole('button', { name: 'Back' }).focus();

    okDown();
    okUp();

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onFirst).not.toHaveBeenCalled();
    expect(onSecond).not.toHaveBeenCalled();
  });

  it('swallows every repeat while OK is held down', () => {
    const onHit = vi.fn();
    render(<Harness onHit={onHit} />);
    screen.getByRole('button').focus();
    okDown();
    okDown({ repeat: true });
    okDown({ repeat: true });
    okDown();
    expect(onHit).toHaveBeenCalledTimes(1);
    okUp();
    okDown();
    expect(onHit).toHaveBeenCalledTimes(2);
  });

  it('accepts Space, Select and DPAD_CENTER as the same OK press', () => {
    const onHit = vi.fn();
    render(<Harness onHit={onHit} />);
    screen.getByRole('button').focus();
    okDown({ key: ' ' });
    okUp({ key: ' ' });
    okDown({ key: 'Select' });
    okUp({ key: 'Select' });
    okDown({ key: 'Unidentified', keyCode: 23 });
    okUp({ key: 'Unidentified', keyCode: 23 });
    expect(onHit).toHaveBeenCalledTimes(3);
  });

  it('never activates an aria-disabled control', () => {
    const onHit = vi.fn();
    render(<Harness onHit={onHit} disabled />);
    screen.getByRole('button').focus();
    okDown();
    okUp();
    expect(onHit).not.toHaveBeenCalled();
  });

  it('ignores arrow keys and leaves Back to the app shell', () => {
    const onHit = vi.fn();
    render(<Harness onHit={onHit} />);
    screen.getByRole('button').focus();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 4 });
    expect(onHit).not.toHaveBeenCalled();
  });

  it('stops listening after unmount', () => {
    const onHit = vi.fn();
    const { unmount } = render(<Harness onHit={onHit} />);
    const button = screen.getByRole('button');
    button.focus();
    unmount();
    const detached = document.createElement('div');
    document.body.appendChild(detached);
    detached.appendChild(button);
    button.focus();
    okDown();
    expect(onHit).not.toHaveBeenCalled();
    detached.remove();
  });

  it('stops a second same-window Select listener from doubling the press', () => {
    const onHit = vi.fn();
    render(<Harness onHit={onHit} />);
    screen.getByRole('button').focus();
    const rival = vi.fn();
    window.addEventListener('keydown', rival, true);
    okDown();
    expect(onHit).toHaveBeenCalledTimes(1);
    expect(rival).not.toHaveBeenCalled();
    window.removeEventListener('keydown', rival, true);
  });

  it('recovers from a lost keyup when the app is backgrounded', () => {
    const onHit = vi.fn();
    render(<Harness onHit={onHit} />);
    screen.getByRole('button').focus();
    okDown(); // keyup is swallowed by the system keyboard / launcher
    expect(onHit).toHaveBeenCalledTimes(1);
    fireEvent.blur(window);
    okDown();
    expect(onHit).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new Event('visibilitychange'));
    okDown();
    expect(onHit).toHaveBeenCalledTimes(3);
  });

  it('never leaves OK dead after a mouse click on the same control', () => {
    const onHit = vi.fn();
    render(<Harness onHit={onHit} />);
    const button = screen.getByRole('button');
    button.focus();
    fireEvent.click(button); // pointer path fires once on its own
    expect(onHit).toHaveBeenCalledTimes(1);
    okDown();
    okUp();
    expect(onHit).toHaveBeenCalledTimes(2);
  });
});
