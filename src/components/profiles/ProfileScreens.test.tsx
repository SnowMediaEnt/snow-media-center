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
// The remote's OK.
const ok = () => act(() => { fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 }); });

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

  it('at the start-up gate of a house with a Kids profile, Manage asks a grown-up even when a grown-up used the box last', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.setPin('main', '1111');
    p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' });
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="gate" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Manage profiles'));
    expect(screen.getByText('Ask a grown-up')).toBeTruthy();
    // OK on the focused 1, four times: the fourth submits.
    for (let i = 0; i < 4; i++) await ok();
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(screen.getByText('Pick a profile to change it.')).toBeTruthy();
    // Asked once: Add goes straight to the editor now.
    fireEvent.click(screen.getByText('Add profile'));
    expect(screen.getByPlaceholderText('Their name')).toBeTruthy();
    vi.useRealTimers();
  });

  it('a house without Kids profiles manages from the gate with no PIN', async () => {
    const p = await import('@/lib/profiles');
    p.setPin('main', '1111');
    p.createProfile({ name: 'Mom', avatar: 'pink', kidsLevel: null });
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="gate" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Manage profiles'));
    expect(screen.getByText('Pick a profile to change it.')).toBeTruthy();
  });

  it('a wrong PIN says so above the pad, where a small screen still shows it', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.setPin('main', '1111');
    p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' });
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="grownup" onClose={() => {}} onSignIn={() => {}} />);
    expect(screen.queryByText('Forgot it? Sign in again')).toBeNull();
    for (const d of '0000') await key(d);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const msg = screen.getByText("That isn't a grown-up's PIN.");
    const pad = screen.getByLabelText('1');
    expect(msg.compareDocumentPosition(pad) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    vi.useRealTimers();
  });

  it("signed out on a Kids profile: leaving it takes that account's grown-up PIN, and Back keeps Kids", async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    const v = await import('@/lib/viewer');
    // The account's list, left on the box, and its Kids profile held.
    localStorage.setItem('smc-profiles-v1:u1', JSON.stringify([
      { id: 'main', name: 'Dad', avatar: 'blue', kidsLevel: null, pinHash: p.hashPin('main', '1111', 'u1'), position: 0, t: 1 },
      { id: 'mia', name: 'Mia', avatar: 'pink', kidsLevel: 'kids', pinHash: null, position: 1, t: 1 },
    ]));
    localStorage.setItem('smc-kids-hold', JSON.stringify({ level: 'kids', acc: 'u1' }));
    v.__setViewerForTests('device');
    p.createProfile({ name: 'Guest', avatar: 'teal', kidsLevel: null });
    expect(p.activeProfile().kidsLevel).toBe('kids');
    const { default: Screens } = await import('./ProfileScreens');
    const onClose = vi.fn();
    const onSignIn = vi.fn();
    render(<Screens mode="gate" onClose={onClose} onSignIn={onSignIn} />);
    fireEvent.click(screen.getByText('Guest'));
    expect(screen.getByText('Ask a grown-up')).toBeTruthy();
    // PIN forgotten: signing in to that account again is the way on.
    fireEvent.click(screen.getByText('Forgot it? Sign in again'));
    expect(onSignIn).toHaveBeenCalled();
    await key('Escape');
    expect(screen.getByText("Who's watching?")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    await key('Escape');
    expect(onClose).toHaveBeenCalled();
    expect(p.activeProfile().kidsLevel).toBe('kids');
    vi.useRealTimers();
  });

  it("offers to bring this box's profiles to the account after signing in", async () => {
    const p = await import('@/lib/profiles');
    localStorage.setItem('smc-profiles-v1:device', JSON.stringify([
      { id: 'main', name: 'Me', avatar: 'blue', kidsLevel: null, pinHash: null, position: 0, t: 0 },
      { id: 'mia', name: 'Mia', avatar: 'pink', kidsLevel: 'kids', pinHash: null, position: 1, t: 1 },
    ]));
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="manage" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Add Mia from this box'));
    expect(screen.getByText('Mia')).toBeTruthy();
    expect(p.loadProfiles().map((x) => x.id)).toEqual(['main', 'mia']);
    expect(screen.queryByText('Add Mia from this box')).toBeNull();
  });
});
