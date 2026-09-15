import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useGameBack } from './gameBack';

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

const backDown = (init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(window, { key: 'Escape', ...init });
const backUp = (init: Partial<KeyboardEventInit> = {}) => fireEvent.keyUp(window, { key: 'Escape', ...init });

describe('shared wager-safe Back guard', () => {
  it('exits exactly once per physical press in a safe phase', () => {
    const onExit = vi.fn();
    render(<Harness onExit={onExit} />);
    backDown();
    backUp();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('swallows key repeats while Back is held', () => {
    const onExit = vi.fn();
    render(<Harness onExit={onExit} />);
    backDown();
    backDown({ repeat: true });
    backDown();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('recognises Android keyCode 4, GoBack and non-editable Backspace', () => {
    const onExit = vi.fn();
    render(<Harness onExit={onExit} />);
    backDown({ key: 'Unidentified', keyCode: 4 });
    backUp({ key: 'Unidentified', keyCode: 4 });
    backDown({ key: 'GoBack' });
    backUp({ key: 'GoBack' });
    backDown({ key: 'Backspace' });
    backUp({ key: 'Backspace' });
    expect(onExit).toHaveBeenCalledTimes(3);
  });

  it('leaves Backspace alone while the player is typing', () => {
    const onExit = vi.fn();
    render(<Harness onExit={onExit} />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onExit).not.toHaveBeenCalled();
    input.remove();
  });

  it('closes fairness details first and does not exit', () => {
    const onExit = vi.fn();
    const closeDetails = vi.fn();
    render(<Harness onExit={onExit} detailsOpen closeDetails={closeDetails} />);
    backDown();
    expect(closeDetails).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('keeps a committed round mounted and shows the blocked note', () => {
    const onExit = vi.fn();
    const onBlocked = vi.fn();
    render(<Harness onExit={onExit} busy onBlocked={onBlocked} />);
    backDown();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('stops any second same-window Back listener from acting on the press', () => {
    const outer = vi.fn();
    const onExit = vi.fn();
    render(<Harness onExit={onExit} />);
    window.addEventListener('keydown', outer, true);
    backDown();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outer, true);
  });

  it('the visible Back button takes the same decision as the remote', () => {
    const onExit = vi.fn();
    const onBlocked = vi.fn();
    const { getByRole } = render(<Harness onExit={onExit} busy onBlocked={onBlocked} />);
    fireEvent.click(getByRole('button'));
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('recovers after a lost keyup when the system steals focus', () => {
    const onExit = vi.fn();
    render(<Harness onExit={onExit} />);
    backDown(); // keyup never arrives
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.blur(window);
    backDown();
    expect(onExit).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new Event('visibilitychange'));
    backDown();
    expect(onExit).toHaveBeenCalledTimes(3);
  });

  it('stops listening after unmount', () => {
    const onExit = vi.fn();
    const { unmount } = render(<Harness onExit={onExit} />);
    unmount();
    backDown();
    expect(onExit).not.toHaveBeenCalled();
  });
});
