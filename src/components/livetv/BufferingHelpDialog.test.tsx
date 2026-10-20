// "Still buffering?" over the picture: the steps in order (restart, VPN, the
// guide), one at a time; Show me how; Back closes it and only it; the keys
// never reach what is behind; a press already on its way does nothing.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { MEDIA_KEY_EVENT, onMediaKey } from '@/lib/mediaKeys';
import Help from './BufferingHelpDialog';
import type { BufferHelpStep } from './useBufferingHelp';

const press = (key: string, extra: Partial<KeyboardEventInit> = {}) => { fireEvent.keyDown(window, { key, ...extra }); fireEvent.keyUp(window, { key }); };
const focused = () => document.querySelector('[data-focused="true"]')?.getAttribute('data-buffer-help-choice');
const step = () => document.querySelector('[data-buffer-help]')?.getAttribute('data-buffer-help');
const choices = () => Array.from(document.querySelectorAll('[data-buffer-help-choice]')).map((b) => b.textContent);

function open(steps: BufferHelpStep[] = ['restart', 'vpn', 'guide'], extra: { canReport?: boolean; armMs?: number } = {}) {
  const cb = { onRestartDone: vi.fn(), onOpenGuide: vi.fn(), onReport: vi.fn(), onClose: vi.fn(), track: vi.fn() };
  const r = render(<Help steps={steps} canReport={extra.canReport ?? true} armMs={extra.armMs ?? 0} {...cb} />);
  return { ...cb, unmount: r.unmount };
}

afterEach(() => { vi.useRealTimers(); });

describe('BufferingHelpDialog', () => {
  it('walks the steps in order: restart, then the VPN, then the guide', () => {
    const cb = open();
    expect(step()).toBe('restart');
    expect(screen.getByText('Have you restarted your TV box and your internet router?')).toBeTruthy();
    expect(choices()).toEqual(['Yes, I did', 'Show me how']);
    // The highlight starts on the safe choice: a habit OK never claims a restart.
    expect(focused()).toBe('how');
    press('ArrowLeft');
    expect(focused()).toBe('yes');
    press('Enter');
    expect(cb.onRestartDone).toHaveBeenCalledTimes(1);
    expect(cb.track).toHaveBeenLastCalledWith('restart', 'yes');

    expect(step()).toBe('vpn');
    expect(screen.getByText('Try a VPN')).toBeTruthy();
    expect(document.body.textContent).toContain('Internet providers often slow streaming down');
    expect(document.body.textContent).toContain('The Buffering Guide shows you how to set one up.');
    expect(choices()).toEqual(['Open the Buffering Guide', 'Not now']);
    press('ArrowRight');
    expect(focused()).toBe('notnow');
    press('Enter');
    expect(cb.track).toHaveBeenLastCalledWith('vpn', 'not_now');

    expect(step()).toBe('guide');
    expect(screen.getByText('Still buffering? Open the Buffering Guide')).toBeTruthy();
    expect(choices()).toEqual(['Open the Buffering Guide', 'Report this channel']);
    expect(focused()).toBe('guide');
    press('Enter');
    expect(cb.onOpenGuide).toHaveBeenCalledWith('guide');
    expect(cb.track).toHaveBeenLastCalledWith('guide', 'open_guide');
    expect(cb.onClose).not.toHaveBeenCalled();
  });

  it('Show me how: the steps on the card; I did it counts, Next tip does not', () => {
    const cb = open();
    press('Enter');
    expect(cb.track).toHaveBeenLastCalledWith('restart', 'how');
    expect(screen.getByText('Restart your box and router')).toBeTruthy();
    expect(document.querySelector('[data-buffer-help-how]')?.textContent).toContain('Unplug your TV box and your internet router.');
    expect(document.body.textContent).toContain('Wait 30 seconds.');
    expect(choices()).toEqual(['I did it', 'Next tip']);
    press('ArrowRight');
    press('Enter');
    expect(cb.onRestartDone).not.toHaveBeenCalled();
    expect(cb.track).toHaveBeenLastCalledWith('restart', 'how_next');
    expect(step()).toBe('vpn');
  });

  it('I did it after Show me how counts as restarted', () => {
    const cb = open();
    press('Enter'); // Show me how
    expect(focused()).toBe('done');
    press('Enter');
    expect(cb.onRestartDone).toHaveBeenCalledTimes(1);
    expect(step()).toBe('vpn');
  });

  it('starts at the VPN when the restart was confirmed today; its guide button says where from', () => {
    const cb = open(['vpn', 'guide']);
    expect(step()).toBe('vpn');
    press('Enter');
    expect(cb.onOpenGuide).toHaveBeenCalledWith('vpn');
  });

  it('the last step reports the channel, or closes where there is no report', () => {
    const cb = open(['guide']);
    press('ArrowRight');
    press('Enter');
    expect(cb.onReport).toHaveBeenCalledTimes(1);
    expect(cb.track).toHaveBeenLastCalledWith('guide', 'report');
  });

  it('an outside service: Close instead of Report', () => {
    const cb = open(['guide'], { canReport: false });
    expect(choices()).toEqual(['Open the Buffering Guide', 'Close']);
    expect(document.body.textContent).not.toContain('Report it');
    press('ArrowLeft');
    expect(focused()).toBe('close');
    press('Enter');
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });

  it('Back closes it on any step', () => {
    const cb = open();
    press('ArrowLeft'); press('Enter');
    press('Escape');
    expect(cb.onClose).toHaveBeenCalledTimes(1);
    expect(cb.track).toHaveBeenLastCalledWith('vpn', 'close');
    expect((window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt).toBeGreaterThan(0);
  });

  it('keeps every key from what is behind it', () => {
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    window.addEventListener('keyup', behind);
    open();
    for (const k of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'Enter', 'ContextMenu', 'MediaPlayPause']) press(k);
    window.removeEventListener('keydown', behind);
    window.removeEventListener('keyup', behind);
    expect(behind).not.toHaveBeenCalled();
  });

  it('a press as it comes up, or as a step changes, does nothing; a held OK never walks the steps', () => {
    vi.useFakeTimers();
    const cb = open(['restart', 'vpn', 'guide'], { armMs: 600 });
    press('Enter');
    press('Escape');
    expect(cb.onRestartDone).not.toHaveBeenCalled();
    expect(cb.onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(600); });
    press('ArrowLeft');
    press('Enter');
    expect(step()).toBe('vpn');
    // The second OK of a double press lands on the new step: nothing.
    press('Enter');
    expect(cb.onOpenGuide).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(600); });
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    expect(cb.onOpenGuide).not.toHaveBeenCalled();
    press('Enter');
    expect(cb.onOpenGuide).toHaveBeenCalledWith('vpn');
  });

  it('the remote\'s media buttons (Play/Pause too) do nothing behind it, and work again once it goes', () => {
    const heard = vi.fn();
    const off = onMediaKey(heard);
    try {
      const cb = open();
      act(() => { window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: 'playpause' })); });
      act(() => { window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: 'chup' })); });
      expect(heard).not.toHaveBeenCalled();
      cb.unmount();
      act(() => { window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: 'playpause' })); });
      expect(heard).toHaveBeenCalledWith('playpause');
    } finally { off(); }
  });

  it('a tap beside the card closes it; a tap on a button chooses it', () => {
    const cb = open();
    fireEvent.click(screen.getByText('Show me how'));
    expect(screen.getByText('Restart your box and router')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-buffer-help]')!);
    expect(cb.onClose).toHaveBeenCalledTimes(1);
  });

  it('speaks the viewer\'s language', async () => {
    await act(async () => { await i18n.changeLanguage('es'); });
    const r = open();
    try {
      expect(choices()).toEqual(['Sí, ya lo hice', 'Muéstrame cómo']);
      expect(document.body.textContent).toContain('¿Reiniciaste tu TV box y tu router de internet?');
    } finally {
      r.unmount();
      await act(async () => { await i18n.changeLanguage('en'); });
    }
  });
});
