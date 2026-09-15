import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Games from '@/components/Games';

vi.mock('@/hooks/useGameSocket', () => ({ useGameSocket: () => ({ status: 'connected', balance: 1250, errorMessage: null }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('Games TV navigation', () => {
  beforeEach(() => sessionStorage.clear());

  it('moves deterministically across the six-game grid and activates once', () => {
    const open = vi.fn();
    render(<Games onBack={vi.fn()} onOpenGame={open} />);
    const first = document.querySelector<HTMLElement>('[data-game-focus="1"]');
    first?.focus();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(document.querySelector('[data-game-focus="2"]')?.getAttribute('data-tv-focused')).toBe('true');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.querySelector('[data-game-focus="5"]')?.getAttribute('data-tv-focused')).toBe('true');
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('game-roulette');
  });

  it('returns to Back from the first tile', () => {
    const back = vi.fn();
    render(<Games onBack={back} onOpenGame={vi.fn()} />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: 'games.hub.back' }).getAttribute('data-focused')).toBe('true');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(back).toHaveBeenCalledTimes(1);
  });
});
