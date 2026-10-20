/**
 * The channel menu in a Favorites list: Move (a TV), Move up / Move down (a
 * touch screen), and the sort row that offers the other way. A long menu is
 * drawn tighter, without its footer, so it still fits a 540px TV screen.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }, from: () => ({}) },
}));

const rows = () => Array.from(document.querySelectorAll('[role="dialog"] button')).map((b) => b.textContent);
const FOOTER = /Long-press OK or press the Menu key/;

describe('ReportChannelDialog in a Favorites list', () => {
  it('Move hands the channel back to be carried and closes the menu', async () => {
    const { default: Dialog } = await import('./ReportChannelDialog');
    const onMove = vi.fn();
    const onClose = vi.fn();
    render(<Dialog channelName="TNT" isFavorite onToggleFavorite={() => {}} onMoveFavorite={onMove} favoritesSort="mine" onToggleFavoritesSort={() => {}} onClose={onClose} />);
    expect(rows()).toEqual(['Report Channel', 'Remove from Favorites', 'Move', 'Sort A–Z', 'Cancel']);
    fireEvent.click(screen.getByText('Move'));
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the sort row offers the other way, and closes the menu', async () => {
    const { default: Dialog } = await import('./ReportChannelDialog');
    const onSort = vi.fn();
    const onClose = vi.fn();
    render(<Dialog channelName="TNT" isFavorite onToggleFavorite={() => {}} favoritesSort="az" onToggleFavoritesSort={onSort} onClose={onClose} />);
    expect(rows()).toContain('Sort my way');
    expect(rows()).not.toContain('Sort A–Z');
    fireEvent.click(screen.getByText('Sort my way'));
    expect(onSort).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a touch screen gets Move up / Move down, one press each, by OK too', async () => {
    const { default: Dialog } = await import('./ReportChannelDialog');
    const onUp = vi.fn();
    const onDown = vi.fn();
    const onClose = vi.fn();
    render(<Dialog channelName="TNT" isFavorite onToggleFavorite={() => {}} onMoveFavoriteUp={onUp} onMoveFavoriteDown={onDown} onClose={onClose} />);
    expect(rows()).toEqual(['Report Channel', 'Remove from Favorites', 'Move up', 'Move down', 'Cancel']);
    fireEvent.keyUp(window, { key: 'Enter' }); // armed once OK is let go
    for (let i = 0; i < 3; i++) fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onDown).toHaveBeenCalledTimes(1);
    expect(onUp).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a long menu is drawn tighter and drops its footer; a short one keeps it', async () => {
    const { default: Dialog } = await import('./ReportChannelDialog');
    const { unmount } = render(<Dialog channelName="TNT" isFavorite onToggleFavorite={() => {}} onClose={() => {}} />);
    expect(screen.getByText(FOOTER)).toBeTruthy();
    expect(document.querySelector('[role="dialog"] button')?.className).toContain('py-3');
    unmount();
    render(
      <Dialog
        channelName="TNT" isFavorite isDown onClearDown={() => {}} onToggleFavorite={() => {}}
        onMoveFavorite={() => {}} favoritesSort="mine" onToggleFavoritesSort={() => {}}
        onRecord={() => {}} onRefreshFavorite={async () => 'same' as const} onClose={() => {}}
      />,
    );
    expect(rows()).toHaveLength(8);
    expect(screen.queryByText(FOOTER)).toBeNull();
    expect(document.querySelector('[role="dialog"] button')?.className).toContain('py-2');
  });
});
