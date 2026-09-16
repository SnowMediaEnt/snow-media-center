import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Plinko from './Plinko';

const press = (key: string, keyCode?: number) => {
  fireEvent.keyDown(window, { key, keyCode, bubbles: true, cancelable: true });
  fireEvent.keyUp(window, { key, keyCode, bubbles: true, cancelable: true });
};

describe('Snow Plinko TV game', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('snow-games-reduced-fx-v1', 'true');
  });

  it('is explicitly free play and starts no idle animation loop', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    render(<Plinko onBack={() => {}} />);

    expect(screen.getByText('Free play · score only · no coins')).toBeTruthy();
    expect(screen.getByText('No purchases · no prizes · score resets on refresh')).toBeTruthy();
    expect(screen.getByLabelText('Session score 0')).toBeTruthy();
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  it('uses D-pad and OK to select a mode and drop exactly once per press', async () => {
    render(<Plinko onBack={() => {}} />);
    const drop = screen.getByRole('button', { name: 'Drop puck' });
    await waitFor(() => expect(document.activeElement).toBe(drop));

    press('ArrowUp');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Chill/ }));
    press('ArrowRight');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Classic/ }));
    press('ArrowRight');
    const wild = screen.getByRole('button', { name: /Wild/ });
    expect(document.activeElement).toBe(wild);
    press('Enter');
    expect(wild.getAttribute('aria-pressed')).toBe('true');

    press('ArrowDown');
    expect(document.activeElement).toBe(drop);
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 23, bubbles: true, cancelable: true });
    fireEvent.keyDown(window, { key: 'Unidentified', keyCode: 23, repeat: true, bubbles: true, cancelable: true });
    expect(drop.getAttribute('data-busy')).toBe('true');

    const dropsStat = screen.getByText('Drops').parentElement!;
    await waitFor(() => expect(dropsStat.querySelector('strong')?.textContent).toBe('1'), { timeout: 2500 });
    expect(screen.getByText(/^\+\d[\d,]* points$/)).toBeTruthy();
  });

  it('blocks Back during a drop, then leaves after the puck lands', async () => {
    const onBack = vi.fn();
    render(<Plinko onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drop puck' }));

    press('Escape');
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByText('Let the puck land first')).toBeTruthy();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Drop puck' }).getAttribute('data-busy')).toBeNull(), { timeout: 2500 });
    press('Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('yields arrows to a global modal instead of moving focus behind it', async () => {
    render(<Plinko onBack={() => {}} />);
    const drop = screen.getByRole('button', { name: 'Drop puck' });
    await waitFor(() => expect(document.activeElement).toBe(drop));
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);

    expect(fireEvent.keyDown(window, { key: 'ArrowUp', cancelable: true })).toBe(true);
    expect(document.activeElement).toBe(drop);
    modal.remove();
  });
});
