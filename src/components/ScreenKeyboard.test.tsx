import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScreenKeyboard from './ScreenKeyboard';
import { closeScreenKeyboard, openScreenKeyboard } from '@/lib/screenKeyboard';

const Form = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  return (
    <form>
      <input aria-label="Username" enterKeyHint="next" value={username} onChange={(event) => setUsername(event.target.value)} />
      <input aria-label="Password" type="password" enterKeyHint="done" value={password} onChange={(event) => setPassword(event.target.value)} />
      <ScreenKeyboard />
    </form>
  );
};

describe('ScreenKeyboard', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  });

  afterEach(() => {
    act(() => closeScreenKeyboard());
    vi.unstubAllGlobals();
  });

  it('opens visibly for a desktop field and types into a controlled input', () => {
    render(<Form />);
    const username = screen.getByLabelText('Username') as HTMLInputElement;
    act(() => { openScreenKeyboard(username); });
    expect(screen.getByLabelText('On-screen keyboard')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'q' }));
    expect(username.value).toBe('q');
  });

  it('moves one D-pad highlight and activates it with Enter', () => {
    render(<Form />);
    const username = screen.getByLabelText('Username') as HTMLInputElement;
    act(() => { openScreenKeyboard(username); });
    expect(screen.getByRole('button', { name: 'q' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'w' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(username.value).toBe('w');
  });

  it('preserves selection and supports delete', () => {
    render(<Form />);
    const username = screen.getByLabelText('Username') as HTMLInputElement;
    fireEvent.change(username, { target: { value: 'snow' } });
    username.setSelectionRange(1, 3);
    act(() => { openScreenKeyboard(username); });
    fireEvent.click(screen.getByRole('button', { name: 'q' }));
    expect(username.value).toBe('sqw');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(username.value).toBe('sw');
  });

  it('moves Next to the masked password and Back closes without submission', () => {
    const submitted = vi.fn();
    render(<div onSubmit={submitted}><Form /></div>);
    const username = screen.getByLabelText('Username') as HTMLInputElement;
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    act(() => { openScreenKeyboard(username); });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(document.activeElement).toBe(password);
    expect(password.type).toBe('password');
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('On-screen keyboard')).toBeNull();
    expect(submitted).not.toHaveBeenCalled();
  });
});