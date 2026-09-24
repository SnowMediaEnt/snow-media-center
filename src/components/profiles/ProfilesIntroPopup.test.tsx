import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
}));
// The hardware Back (Capacitor's backButton), called by hand.
const cap = vi.hoisted(() => ({ back: null as null | (() => void) }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async (_e: string, cb: () => void) => { cap.back = cb; return { remove() {} }; } } }));

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); sessionStorage.clear(); localStorage.setItem('smc-welcome-shown-version', '1.7.7'); });
afterEach(() => { vi.useRealTimers(); });

describe('ProfilesIntroPopup', () => {
  it('waits its turn, then offers Settings → Profiles once', async () => {
    const { default: Popup } = await import('./ProfilesIntroPopup');
    const onSetUp = vi.fn();
    const r = render(<Popup onSetUp={onSetUp} />);
    expect(screen.queryByText('New: profiles for everyone')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    fireEvent.click(screen.getByText('Set up profiles'));
    expect(onSetUp).toHaveBeenCalled();
    expect(sessionStorage.getItem('smc-settings-tab')).toBe('profiles');
    r.unmount();
    render(<Popup onSetUp={onSetUp} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(screen.queryByText('New: profiles for everyone')).toBeNull();
  });

  it("waits behind the What's New popup", async () => {
    localStorage.removeItem('smc-welcome-shown-version');
    const { default: Popup } = await import('./ProfilesIntroPopup');
    render(<Popup onSetUp={() => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.queryByText('New: profiles for everyone')).toBeNull();
    localStorage.setItem('smc-welcome-shown-version', '1.7.7');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByText('New: profiles for everyone')).toBeTruthy();
  });

  it('waits while the viewer is in the content bar', async () => {
    const bar = document.createElement('div');
    bar.setAttribute('data-media-bar', '');
    bar.innerHTML = '<button data-focused="true">Tile</button>';
    document.body.appendChild(bar);
    const { default: Popup } = await import('./ProfilesIntroPopup');
    render(<Popup onSetUp={() => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.queryByText('New: profiles for everyone')).toBeNull();
    bar.querySelector('button')!.setAttribute('data-focused', 'false');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByText('New: profiles for everyone')).toBeTruthy();
    bar.remove();
  });

  it('waits behind a notice, and a notice that comes up over it gets the keys', async () => {
    const notice = document.createElement('div');
    notice.setAttribute('role', 'dialog');
    notice.setAttribute('data-notice-layer', 'open');
    document.body.appendChild(notice);
    const { default: Popup } = await import('./ProfilesIntroPopup');
    const onSetUp = vi.fn();
    render(<Popup onSetUp={onSetUp} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.queryByText('New: profiles for everyone')).toBeNull();
    notice.remove();
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByText('New: profiles for everyone')).toBeTruthy();
    // A notice arrives on top: OK is the notice's, not "Set up profiles".
    document.body.appendChild(notice);
    const noticeOk = vi.fn();
    const onKey = (e: KeyboardEvent) => { if (e.keyCode === 13) noticeOk(); };
    window.addEventListener('keydown', onKey, true);
    await act(() => { fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 }); });
    window.removeEventListener('keydown', onKey, true);
    expect(noticeOk).toHaveBeenCalled();
    expect(onSetUp).not.toHaveBeenCalled();
    expect(screen.getByText('New: profiles for everyone')).toBeTruthy();
    notice.remove();
    // Gone again: OK is the popup's.
    await act(() => { fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 }); });
    expect(onSetUp).toHaveBeenCalled();
  });

  it('one Back press for a notice on top: the hardware event for it does not close this too', async () => {
    const { default: Popup } = await import('./ProfilesIntroPopup');
    render(<Popup onSetUp={() => {}} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(screen.getByText('New: profiles for everyone')).toBeTruthy();
    const notice = document.createElement('div');
    notice.setAttribute('role', 'dialog');
    notice.setAttribute('data-notice-layer', 'open');
    document.body.appendChild(notice);
    // The notice's own listener: Back dismisses it.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') notice.remove(); };
    window.addEventListener('keydown', onKey, true);
    // The key first, then the hardware event of the same press.
    await act(() => { fireEvent.keyDown(window, { key: 'Escape', keyCode: 27 }); });
    window.removeEventListener('keydown', onKey, true);
    expect(document.querySelector('[data-notice-layer]')).toBeNull();
    await act(async () => { cap.back?.(); });
    expect(screen.getByText('New: profiles for everyone')).toBeTruthy();
    // A later press is this popup's.
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await act(async () => { cap.back?.(); });
    expect(screen.queryByText('New: profiles for everyone')).toBeNull();
  });
});
