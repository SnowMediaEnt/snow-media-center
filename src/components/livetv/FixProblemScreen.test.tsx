/**
 * Live TV › Settings › Fix a problem (owner, 2026-10-20): the Buffering Guide,
 * Speed test and Submit a Ticket (they open in Support), and a "restart your
 * box and router" tip. Back (or Left) returns to the Settings menu.
 */
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FixProblemScreen from './FixProblemScreen';

const key = (k: string) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});
const rows = () => Array.from(document.querySelectorAll('[data-row]')).map((n) => n.getAttribute('data-row'));
const focusedRow = () => document.querySelector('[data-row][data-focused="true"]')?.getAttribute('data-row');

describe('Settings › Fix a problem', () => {
  it('the Buffering Guide, Speed test and Submit a Ticket, then the restart tip; OK opens each', () => {
    const onOpenBufferingGuide = vi.fn();
    const onOpenSupportTool = vi.fn();
    const onBack = vi.fn();
    render(<FixProblemScreen active onBack={onBack} onOpenBufferingGuide={onOpenBufferingGuide} onOpenSupportTool={onOpenSupportTool} />);
    expect(rows()).toEqual(['guide', 'speedtest', 'tickets']);
    expect(document.body.textContent).toContain('Buffering Guide');
    expect(document.body.textContent).toContain('Speedtest');
    expect(document.body.textContent).toContain('Submit a Ticket');
    expect(document.querySelector('[data-fix-tip]')?.textContent).toContain('Restart your box and router');
    expect(focusedRow()).toBe('guide');
    key('Enter');
    expect(onOpenBufferingGuide).toHaveBeenCalledTimes(1);
    key('ArrowDown');
    key('Enter');
    expect(onOpenSupportTool).toHaveBeenLastCalledWith('speedtest');
    key('ArrowDown'); key('ArrowDown'); // stops at the last
    expect(focusedRow()).toBe('tickets');
    key('Enter');
    expect(onOpenSupportTool).toHaveBeenLastCalledWith('tickets');
    key('ArrowLeft');
    expect(onBack).toHaveBeenCalledTimes(1);
    key('Escape');
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it('a tap opens a row too; without a way to Support only the guide (and the tip) show', () => {
    const onOpenBufferingGuide = vi.fn();
    render(<FixProblemScreen active onBack={vi.fn()} onOpenBufferingGuide={onOpenBufferingGuide} />);
    expect(rows()).toEqual(['guide']);
    act(() => { (document.querySelector('[data-row="guide"]') as HTMLElement).click(); });
    expect(onOpenBufferingGuide).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-fix-tip]')).toBeTruthy();
  });

  it('while the remote is on the Settings menu: no keys, no highlight', () => {
    const onBack = vi.fn();
    const onOpenBufferingGuide = vi.fn();
    render(<FixProblemScreen active={false} onBack={onBack} onOpenBufferingGuide={onOpenBufferingGuide} />);
    expect(focusedRow()).toBeUndefined();
    key('Enter'); key('Escape');
    expect(onOpenBufferingGuide).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });
});
