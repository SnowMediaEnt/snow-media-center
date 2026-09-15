import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BetChip, FairnessPanel, ResultBanner } from './GameUI';
import { PlayingCard } from './PlayingCard';

describe('shared game UI', () => {
  it('renders a selected TV bet chip and handles activation once', () => {
    const onClick = vi.fn();
    render(<BetChip selected focused onClick={onClick}>25</BetChip>);
    const chip = screen.getByRole('button', { name: '25' });
    expect(chip.getAttribute('data-tv-focused')).toBe('true');
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders cards, hidden backs, and held state without leaking a hidden card', () => {
    const { rerender } = render(<PlayingCard card={{ rank: 'A', suit: 'H' }} held />);
    expect(screen.getAllByText('A')).toHaveLength(2);
    expect(screen.getByText('HELD')).toBeTruthy();
    rerender(<PlayingCard card={{ rank: 'A', suit: 'H' }} faceDown />);
    expect(screen.queryAllByText('A')).toHaveLength(0);
  });

  it('reveals fairness details only after the disclosure is opened', () => {
    const fair = { serverSeedHash: 'hash', serverSeed: 'seed', clientSeed: 'client', nonce: 4 };
    const onToggle = vi.fn();
    const { rerender } = render(<FairnessPanel fair={fair} open={false} onToggle={onToggle} />);
    expect(screen.queryByText('seed')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /provably fair/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<FairnessPanel fair={fair} open onToggle={onToggle} />);
    expect(screen.getByText(/seed$/)).toBeTruthy();
  });

  it('announces results politely', () => {
    render(<ResultBanner tone="win" title="You win">250 chips</ResultBanner>);
    expect(screen.getByRole('status').textContent).toContain('You win');
    expect(screen.getByRole('status').textContent).toContain('250 chips');
  });
});
