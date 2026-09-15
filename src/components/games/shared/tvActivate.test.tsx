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
    document.body.appendChild(button);
    button.focus();
    okDown();
    expect(onHit).not.toHaveBeenCalled();
  });
});
