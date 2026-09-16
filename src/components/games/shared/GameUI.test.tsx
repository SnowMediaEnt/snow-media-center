import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BetChip, FairnessPanel, GamePanel, GameShell, GameTopBar, ResultBanner, SnowCoinBalance } from './GameUI';
import { PlayingCard } from './PlayingCard';
import { GameArtwork } from './GameArtwork';
import { isActivatable, isSelectKey } from './tvActivate';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

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
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
    expect(screen.getByText('games.shared.held')).toBeTruthy();
    rerender(<PlayingCard card={{ rank: 'A', suit: 'H' }} faceDown />);
    expect(screen.queryAllByText('A')).toHaveLength(0);
  });

  it('reveals fairness details only after the disclosure is opened', () => {
    const fair = { serverSeedHash: 'hash', serverSeed: 'seed', clientSeed: 'client', nonce: 4 };
    const onToggle = vi.fn();
    const { rerender } = render(<FairnessPanel fair={fair} open={false} onToggle={onToggle} />);
    expect(screen.queryByText(/seed$/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /provablyFair/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<FairnessPanel fair={fair} open onToggle={onToggle} />);
    expect(screen.getByText(/seed$/)).toBeTruthy();
  });

  it('announces results politely', () => {
    render(<ResultBanner tone="win" title="You win">250 chips</ResultBanner>);
    expect(screen.getByRole('status').textContent).toContain('You win');
    expect(screen.getByRole('status').textContent).toContain('250 chips');
  });

  it('shows the balance, the phase line and a reduced-FX control in the top bar', () => {
    const onToggleFx = vi.fn();
    render(
      <GameShell accent="ruby">
        <GameTopBar onBack={() => {}} backLabel="back" balance={1234} status="connected" title="Roulette" phase="Place bets" reducedFx={false} onToggleFx={onToggleFx} />
        <GamePanel>board</GamePanel>
      </GameShell>,
    );
    expect(screen.getByText('1,234')).toBeTruthy();
    expect(screen.getByText('Roulette · Place bets')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /fxFull/i }));
    expect(onToggleFx).toHaveBeenCalledTimes(1);
  });

  it('formats the reusable Snow Coin wallet for custom game headers', () => {
    render(<SnowCoinBalance balance={1000000} status="connected" />);
    expect(screen.getByLabelText('games.shared.balanceAria').textContent).toContain('1,000,000');
  });

  it('draws decorative artwork that is hidden from assistive tech', () => {
    const { container } = render(<GameArtwork game="roulette" accent="ruby" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('data-accent')).toBe('ruby');
  });
});

describe('TV activation helpers', () => {
  const key = (init: Partial<KeyboardEvent>) => new KeyboardEvent('keydown', init as KeyboardEventInit);

  it('recognises every remote OK variant, including DPAD_CENTER', () => {
    expect(isSelectKey(key({ key: 'Enter' }))).toBe(true);
    expect(isSelectKey(key({ key: ' ' }))).toBe(true);
    expect(isSelectKey(key({ key: 'Select' }))).toBe(true);
    expect(isSelectKey(key({ key: 'Unidentified', keyCode: 23 }))).toBe(true);
    expect(isSelectKey(key({ key: 'ArrowDown' }))).toBe(false);
    expect(isSelectKey(key({ key: 'Escape' }))).toBe(false);
  });

  it('treats disabled, aria-disabled and busy targets as unusable', () => {
    const enabled = document.createElement('button');
    const disabled = document.createElement('button');
    disabled.disabled = true;
    const aria = document.createElement('button');
    aria.setAttribute('aria-disabled', 'true');
    const busy = document.createElement('button');
    busy.setAttribute('data-busy', 'true');
    expect(isActivatable(enabled)).toBe(true);
    expect(isActivatable(disabled)).toBe(false);
    expect(isActivatable(aria)).toBe(false);
    expect(isActivatable(busy)).toBe(false);
    expect(isActivatable(null)).toBe(false);
  });
});
