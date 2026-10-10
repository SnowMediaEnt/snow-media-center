// A tapped button keeps the typing box's focus (Tronix aa7b541): the phone's
// keyboard stays up and the form does not jump under the finger; the click
// still reaches the button.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { keepTypingFocus } from './keepTypingFocus';

describe('keepTypingFocus', () => {
  it('a press on a button while a box is being typed in keeps the box focused; the click still lands', () => {
    const onClick = vi.fn();
    const { getByRole, getByLabelText } = render(
      <form onMouseDown={keepTypingFocus}>
        <input aria-label="user" />
        <button type="button" onClick={onClick}>Sign in</button>
      </form>,
    );
    const box = getByLabelText('user') as HTMLInputElement;
    box.focus();
    const btn = getByRole('button');
    const down = fireEvent.mouseDown(btn);
    expect(down).toBe(false); // default prevented: the button does not take focus
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
    expect(document.activeElement).toBe(box);
  });

  it('nothing is being typed: a press is left alone', () => {
    const { getByRole } = render(<form onMouseDown={keepTypingFocus}><button type="button">OK</button></form>);
    expect(fireEvent.mouseDown(getByRole('button'))).toBe(true);
  });
});
