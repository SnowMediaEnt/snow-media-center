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
