import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFieldActionKey, onFieldActionKey } from './fieldEnter';

afterEach(() => cleanup());

const Form = ({ onSubmit }: { onSubmit: () => void }) => (
  <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
    <input data-testid="email" onKeyDown={(e) => { onFieldActionKey(e); }} />
    <input data-testid="pass" type="password" onKeyDown={(e) => { onFieldActionKey(e); }} />
    <button type="button" tabIndex={-1} data-testid="eye">eye</button>
    <input data-testid="ro" readOnly />
    <select data-testid="device"><option>a</option></select>
    <button type="submit" data-testid="go">Go</button>
  </form>
);

describe('fieldEnter', () => {
  it('knows the keyboard action keys', () => {
    expect(isFieldActionKey({ key: 'Enter' })).toBe(true);
    expect(isFieldActionKey({ key: 'Go' })).toBe(true);
    expect(isFieldActionKey({ key: 'Done' })).toBe(true);
    expect(isFieldActionKey({ key: 'Next' })).toBe(true);
    expect(isFieldActionKey({ key: 'Unidentified', keyCode: 13 })).toBe(true);
    expect(isFieldActionKey({ key: 'a', keyCode: 65 })).toBe(false);
    expect(isFieldActionKey({ key: 'Unidentified', keyCode: 23 })).toBe(false);
  });

  it('moves on to the next field, then lands on the submit button without submitting', () => {
    const submitted = vi.fn();
    const { getByTestId } = render(<Form onSubmit={submitted} />);
    const email = getByTestId('email') as HTMLInputElement;
    const pass = getByTestId('pass') as HTMLInputElement;
    fireEvent.input(email, { target: { value: 'a@b.co' } });
    fireEvent.keyDown(email, { key: 'Enter', keyCode: 13 });
    expect(document.activeElement).toBe(pass);
    fireEvent.input(pass, { target: { value: 'secret' } });
    const notPrevented = fireEvent.keyDown(pass, { key: 'Enter', keyCode: 13 });
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(getByTestId('go'));
    expect(submitted).not.toHaveBeenCalled();
  });

  it('an empty field is not skipped, and composition keys are left alone', () => {
    const { getByTestId } = render(<Form onSubmit={vi.fn()} />);
    const email = getByTestId('email') as HTMLInputElement;
    act(() => { email.focus(); });
    fireEvent.keyDown(email, { key: 'Enter', keyCode: 13 });
    expect(document.activeElement).toBe(email);
    fireEvent.input(email, { target: { value: 'x' } });
    fireEvent.keyDown(email, { key: 'Enter', keyCode: 229 });
    expect(document.activeElement).toBe(email);
  });
});
