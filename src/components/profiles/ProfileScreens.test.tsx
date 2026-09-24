import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
    functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
  },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  (await import('@/lib/profiles')).__resetProfilesForTests();
  (await import('@/lib/viewer')).__setViewerForTests('u1');
});

describe('ProfileScreens', () => {
  it('asks for the PIN of a locked profile and offers Forgot PIN after three wrong tries', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    const dad = p.createProfile({ name: 'Dad', avatar: 'gold', kidsLevel: null })!;
    p.setPin(dad.id, '1234');
    const { default: Screens } = await import('./ProfileScreens');
    const onClose = vi.fn();
    render(<Screens mode="pick" onClose={onClose} />);
    expect(screen.getByText("Who's watching?")).toBeTruthy();
    fireEvent.click(screen.getByText('Dad'));
    expect(screen.getByText('Enter the PIN for Dad')).toBeTruthy();
    for (let i = 0; i < 3; i++) {
      for (const d of '0000') await key(d);
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    }
    expect(screen.getByText('Wrong PIN. Try again.')).toBeTruthy();
    expect(screen.getByText('Forgot PIN?')).toBeTruthy();
    await key('Escape');
    expect(screen.getByText("Who's watching?")).toBeTruthy();
    // (A key and the hardware Back event of one press arrive together; two
    // presses are further apart than that.)
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await key('Escape');
    expect(onClose).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('adds a profile from the editor', async () => {
    const { default: Screens } = await import('./ProfileScreens');
    const p = await import('@/lib/profiles');
    render(<Screens mode="pick" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Add profile'));
    fireEvent.change(screen.getByPlaceholderText('Their name'), { target: { value: 'Mia' } });
    fireEvent.click(screen.getByText('Kids'));
    fireEvent.click(screen.getByText('Save'));
    const mia = p.loadProfiles().find((x) => x.name === 'Mia');
    expect(mia?.kidsLevel).toBe('kids');
  });

  it("the remote's OK (Enter, keyCode 13) presses the focused control, not the digit 6", async () => {
    // jsdom has no layout: put the controls in one row, in page order.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const all = Array.from(document.querySelectorAll('[data-pf]'));
      const i = Math.max(0, all.indexOf(this));
      return { left: i * 200, top: 0, width: 150, height: 150, right: i * 200 + 150, bottom: 150, x: i * 200, y: 0, toJSON() {} } as DOMRect;
    });
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
    await key('ArrowRight');
    await act(() => { fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 }); });
    expect(screen.getByPlaceholderText('Their name')).toBeTruthy();
    rect.mockRestore();
  });

  it('Backspace and space in the name box type; they do not leave it', async () => {
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Add profile'));
    const box = screen.getByPlaceholderText('Their name') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'Mia' } });
    box.focus();
    vi.useFakeTimers();
    for (const k of [{ key: 'Backspace', keyCode: 8 }, { key: ' ', keyCode: 32 }, { key: 'Backspace', keyCode: 8 }]) {
      await act(() => { fireEvent.keyDown(document.activeElement ?? window, k); });
      await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    }
    vi.useRealTimers();
    // Still in the editor, still typing, the name kept.
    expect((screen.getByPlaceholderText('Their name') as HTMLInputElement).value).toBe('Mia');
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Their name'));
  });
});
