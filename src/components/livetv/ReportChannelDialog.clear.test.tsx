import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }, from: () => ({}) },
}));

describe('ReportChannelDialog', () => {
  it('offers "It’s working now" on a channel showing ⚠️', async () => {
    const { default: Dialog } = await import('./ReportChannelDialog');
    const onClearDown = vi.fn();
    const onClose = vi.fn();
    render(<Dialog channelName="TNT" channelId={11} isDown onClearDown={onClearDown} onClose={onClose} />);
    fireEvent.click(screen.getByText("It's working now — remove ⚠️"));
    expect(onClearDown).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('does not offer it when the channel is fine', async () => {
    const { default: Dialog } = await import('./ReportChannelDialog');
    render(<Dialog channelName="TNT" channelId={11} onClearDown={() => {}} onClose={() => {}} />);
    expect(screen.queryByText("It's working now — remove ⚠️")).toBeNull();
  });
});

describe('ReportChannelDialog: rows that stay put', () => {
  const press = (key: string) => { fireEvent.keyDown(window, { key }); fireEvent.keyUp(window, { key }); };
  const focusedRow = () => document.querySelector('[data-focused="true"]')?.textContent ?? '';

  it('keeps the highlighted row when the ⚠️ clears under the open dialog', async () => {
    const { default: Dialog } = await import('./ReportChannelDialog');
    const onToggleFavorite = vi.fn();
    const onClearDown = vi.fn();
    const { rerender } = render(<Dialog channelName="TNT" channelId={11} isDown onClearDown={onClearDown} onToggleFavorite={onToggleFavorite} onClose={() => {}} />);
    fireEvent.keyUp(window, { key: 'Enter' });
    press('ArrowDown');
    expect(focusedRow()).toContain('Report Channel');
    // A box played it fine for 12 s: the live flag drops while the viewer is here.
    rerender(<Dialog channelName="TNT" channelId={11} isDown={false} onClearDown={onClearDown} onToggleFavorite={onToggleFavorite} onClose={() => {}} />);
    expect(focusedRow()).toContain('Report Channel');
    press('Enter');
    expect(onToggleFavorite).not.toHaveBeenCalled();
    expect(screen.getByText(/Report a problem/)).toBeTruthy();
  });

  it('does not slide the highlight onto "It’s working now" when the ⚠️ appears', async () => {
    const { default: Dialog } = await import('./ReportChannelDialog');
    const onClearDown = vi.fn();
    const { rerender } = render(<Dialog channelName="TNT" channelId={11} onClearDown={onClearDown} onClose={() => {}} />);
    fireEvent.keyUp(window, { key: 'Enter' });
    rerender(<Dialog channelName="TNT" channelId={11} isDown onClearDown={onClearDown} onClose={() => {}} />);
    press('Enter');
    expect(onClearDown).not.toHaveBeenCalled();
    expect(screen.getByText(/Report a problem/)).toBeTruthy();
  });

  it('Back from the reasons lands on Report Channel, not on the row above it', async () => {
    const { default: Dialog } = await import('./ReportChannelDialog');
    render(<Dialog channelName="TNT" channelId={11} isDown onClearDown={() => {}} onClose={() => {}} />);
    fireEvent.keyUp(window, { key: 'Enter' });
    press('ArrowDown');
    press('Enter');
    expect(screen.getByText(/Report a problem/)).toBeTruthy();
    press('Escape');
    expect(focusedRow()).toContain('Report Channel');
  });
});
