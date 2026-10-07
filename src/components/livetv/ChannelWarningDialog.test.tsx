// Asked before a channel the others reported plays: Watch anyway / Pick
// another, the highlight on Pick another, Back = Pick another.
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Warning from './ChannelWarningDialog';

const press = (key: string, extra: Partial<KeyboardEventInit> = {}) => { fireEvent.keyDown(window, { key, ...extra }); fireEvent.keyUp(window, { key }); };
const focused = () => document.querySelector('[data-focused="true"]')?.getAttribute('data-warn-choice');

describe('ChannelWarningDialog', () => {
  it('buffering: says so, starts on Pick another, ◀ then OK watches', () => {
    const onWatch = vi.fn(); const onPick = vi.fn();
    render(<Warning channelName="ESPN" report="buffering" onWatch={onWatch} onPickAnother={onPick} />);
    expect(document.body.textContent).toContain('Reported buffering recently — it may not play well.');
    expect(screen.getByText('Watch anyway')).toBeTruthy();
    expect(focused()).toBe('pick');
    press('ArrowLeft');
    expect(focused()).toBe('watch');
    press('Enter');
    expect(onWatch).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('down: OK straight away picks another (a habit press never starts it)', () => {
    const onWatch = vi.fn(); const onPick = vi.fn();
    render(<Warning channelName="TNT" report="down" onWatch={onWatch} onPickAnother={onPick} />);
    expect(document.body.textContent).toContain('Someone reported this channel down recently');
    press('Enter');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onWatch).not.toHaveBeenCalled();
  });

  it('a whole category down names the category; Back is Pick another', () => {
    const onWatch = vi.fn(); const onPick = vi.fn();
    render(<Warning channelName="NFL 01" report="category" categoryName="NFL Sunday" onWatch={onWatch} onPickAnother={onPick} />);
    expect(document.body.textContent).toContain('The whole NFL Sunday category was reported down recently');
    press('Escape');
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('ignores the repeats of a held OK', () => {
    const onWatch = vi.fn(); const onPick = vi.fn();
    render(<Warning channelName="TNT" report="down" onWatch={onWatch} onPickAnother={onPick} />);
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('keeps the keys from the list behind it', () => {
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    render(<Warning channelName="TNT" report="down" onWatch={() => {}} onPickAnother={() => {}} />);
    press('ArrowDown');
    window.removeEventListener('keydown', behind);
    expect(behind).not.toHaveBeenCalled();
  });
});
