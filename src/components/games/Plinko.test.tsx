import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import Plinko, { buildPlinkoMotion, PLINKO_PEGS, PLINKO_RISK_MODES } from './Plinko';

const press = (key: string, keyCode?: number) => {
  fireEvent.keyDown(window, { key, keyCode, bubbles: true, cancelable: true });
  fireEvent.keyUp(window, { key, keyCode, bubbles: true, cancelable: true });
};

describe('Snow Plinko TV game', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('snow-games-reduced-fx-v1', 'true');
  });

  it('builds a seeded contact-and-recoil track that lands in the server slot', () => {
    const path = [true, false, true, false, true, false, true, false, true, false];
    const motion = buildPlinkoMotion(path, 1234);

    expect(motion.finalSlot).toBe(5);
    expect(motion.points).toHaveLength(32);
    expect(motion.points[0]).toMatchObject({ x: 50, y: 5, offset: 0 });
    expect(motion.points[motion.points.length - 1]).toMatchObject({ x: 50, y: 89, offset: 1 });
    const impacts = motion.points.filter((point) => point.impact);
    expect(impacts).toHaveLength(10);
    expect(impacts.every((point) => point.scale < 1)).toBe(true);
    expect(impacts.every((point, row) => motion.points[row * 3 + 2].y < point.y)).toBe(true);
    expect(motion.points.every((point, index, points) => index === 0 || point.offset >= points[index - 1].offset)).toBe(true);
    expect(buildPlinkoMotion(path, 1234)).toEqual(motion);
    expect(buildPlinkoMotion(path, 5678).points).not.toEqual(motion.points);
    expect(buildPlinkoMotion(path, 5678).finalSlot).toBe(motion.finalSlot);
  });

  it('fills a rectangular field with clear staggered peg lanes and aligns all eleven buckets', () => {
    expect(PLINKO_PEGS).toHaveLength(115);
    expect(PLINKO_PEGS.filter((peg) => peg.row === 0)).toHaveLength(11);
    expect(PLINKO_PEGS.filter((peg) => peg.row === 1)).toHaveLength(12);
    expect(Math.min(...PLINKO_PEGS.map((peg) => peg.x))).toBe(2.5);
    expect(Math.max(...PLINKO_PEGS.map((peg) => peg.x))).toBe(97.5);

    for (let word = 0; word < 1024; word += 1) {
      const path = Array.from({ length: 10 }, (_, row) => Boolean(word & (1 << row)));
      const motion = buildPlinkoMotion(path, word + 1);
      const slot = path.filter(Boolean).length;
      const landing = motion.points[motion.points.length - 1];
      expect(motion.finalSlot).toBe(slot);
      expect(landing.x).toBeCloseTo(2.5 + (slot + .5) * (95 / 11), 8);
      expect(motion.points.every((point) => point.x > 2.5 && point.x < 97.5)).toBe(true);
    }
  });

  it('keeps every score-only board consistently player-friendly', () => {
    const combinations = [1, 10, 45, 120, 210, 252, 210, 120, 45, 10, 1];

    for (const mode of PLINKO_RISK_MODES) {
      const expectedMultiplier = mode.multipliers.reduce(
        (sum, multiplier, index) => sum + multiplier * combinations[index],
        0,
      ) / 1024;

      expect(expectedMultiplier).toBeGreaterThanOrEqual(1.04);
      expect(expectedMultiplier).toBeLessThanOrEqual(1.06);
    }
  });

  it('is explicitly free play and starts no idle animation loop', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    render(<Plinko onBack={() => {}} />);

    expect(screen.getByText('Guest free play · score only')).toBeTruthy();
    expect(screen.getByText('Free entertainment coins only · no purchase required · no cash value')).toBeTruthy();
    expect(screen.getByLabelText('Practice score 0')).toBeTruthy();
    expect(document.querySelectorAll('.snow-plinko-pegs span')).toHaveLength(115);
    expect(document.querySelectorAll('.snow-plinko-wall')).toHaveLength(2);
    expect(raf).not.toHaveBeenCalled();
    raf.mockRestore();
  });

  it('uses D-pad and OK to select a mode and drop exactly once per press', async () => {
    render(<Plinko onBack={() => {}} />);
    const drop = screen.getByRole('button', { name: 'Drop puck' });
    await waitFor(() => expect(document.activeElement).toBe(drop));

    press('ArrowUp');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Wild/ }));
    press('ArrowUp');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Classic/ }));
    press('ArrowUp');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Chill/ }));
    press('ArrowDown');
    press('ArrowDown');
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
    await waitFor(() => expect(dropsStat.querySelector('strong')?.textContent).toBe('1'), { timeout: 3500 });
    expect(screen.getByText(/^\+\d[\d,]* points$/)).toBeTruthy();
  });

  it('blocks Back during a drop, then leaves after the puck lands', async () => {
    const onBack = vi.fn();
    render(<Plinko onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: 'Drop puck' }));

    press('Escape');
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByText('Let the puck land first')).toBeTruthy();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Drop puck' }).getAttribute('data-busy')).toBeNull(), { timeout: 3500 });
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
