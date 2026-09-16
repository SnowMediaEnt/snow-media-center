import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'wallet-test-user' } }),
}));

vi.mock('@/hooks/useGameSocket', () => ({
  useGameSocket: () => ({ balance: 1000000, status: 'connected' }),
}));

import Plinko from './Plinko';

describe('Snow Plinko wallet visibility', () => {
  it('keeps total Snow Coins, the wager, and session net visible as separate values', () => {
    render(<Plinko onBack={() => {}} />);

    expect(screen.getByLabelText('games.shared.balanceAria').textContent).toContain('1,000,000');
    expect(screen.getByLabelText('Wager 10 Snow Coins')).toBeTruthy();
    expect(screen.getByLabelText('Snow Coin net 0')).toBeTruthy();
  });
});
