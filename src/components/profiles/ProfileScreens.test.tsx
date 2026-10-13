import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { account, resetAccount } from '@/test/fakeViewerAccount';

// The account: viewer_profiles and viewer_parent_pin in memory (pulls answer,
// a Parent PIN is inserted or changed by compare and swap), and
// profile-pin-reset's request and verify. It can be offline, or hang.
vi.mock('@/integrations/supabase/client', async () => ({ supabase: (await import('@/test/fakeViewerAccount')).supabase }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
// The remote's OK.
const ok = () => act(() => { fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 }); });
// Let the account's answer (and the timers) come through.
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
// Four digits on the remote's number keys: the last one submits.
const type = async (digits: string) => { for (const d of digits) await key(d); await settle(); };

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  resetAccount();
  (await import('@/lib/profiles')).__resetProfilesForTests();
  (await import('@/lib/viewer')).__setViewerForTests('u1');
});
afterEach(() => { vi.useRealTimers(); });

describe('ProfileScreens', () => {
  it('asks for the PIN of a locked profile and offers Forgot PIN after three wrong tries', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.putOffParentPin();
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
    p.putOffParentPin();
    render(<Screens mode="pick" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Add profile'));
    fireEvent.change(screen.getByPlaceholderText('Their name'), { target: { value: 'Leo' } });
    fireEvent.click(screen.getByText('Save'));
    expect(p.loadProfiles().find((x) => x.name === 'Leo')?.kidsLevel).toBeNull();
    expect(screen.getByText("Who's watching?")).toBeTruthy();
  });

  it("the remote's OK (Enter, keyCode 13) presses the focused control, not the digit 6", async () => {
    (await import('@/lib/profiles')).putOffParentPin();
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

  it('the remote moves along the colors, shows where it is, and OK picks one', async () => {
    (await import('@/lib/profiles')).putOffParentPin();
    // jsdom has no layout: the name box on top, the colors in a row under it,
    // everything else further down.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const id = this.dataset.pf ?? '';
      const colors = Array.from(document.querySelectorAll('[data-pf^="c-"]'));
      const others = Array.from(document.querySelectorAll('[data-pf]:not([data-pf^="c-"]):not([data-pf="name"])'));
      const [x, y] = id === 'name' ? [0, 0] : id.startsWith('c-') ? [colors.indexOf(this) * 60, 200] : [others.indexOf(this) * 200, 400];
      return { left: x, top: y, width: 48, height: 48, right: x + 48, bottom: y + 48, x, y, toJSON() {} } as DOMRect;
    });
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Add profile'));
    expect(screen.getByText('Color')).toBeTruthy();
    const color = (id: string) => document.querySelector<HTMLElement>(`[data-pf="c-${id}"]`)!;
    await key('ArrowDown');
    await key('ArrowRight');
    await key('ArrowRight');
    // On purple, not picked: the remote's ring shows (a valid shadow).
    expect(color('purple').dataset.focused).toBe('true');
    expect(color('purple').style.boxShadow).toMatch(/^0(px)? 0(px)? 0(px)? 5px/);
    await ok();
    expect(color('purple').getAttribute('aria-pressed')).toBe('true');
    rect.mockRestore();
  });

  it('Backspace and space in the name box type; they do not leave it', async () => {
    (await import('@/lib/profiles')).putOffParentPin();
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

  it('at the start-up gate of a house with a Kids profile, Manage asks the Parent PIN even when a grown-up used the box last', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.setPin('main', '1111');
    p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' });
    p.setParentPin('1111');
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="gate" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Manage profiles'));
    expect(screen.getByText('Enter the parent PIN')).toBeTruthy();
    // OK on the focused 1, four times: the fourth submits.
    for (let i = 0; i < 4; i++) await ok();
    await settle();
    expect(screen.getByText('Pick a profile to change it.')).toBeTruthy();
    // Asked once: Add goes straight to the editor now.
    fireEvent.click(screen.getByText('Add profile'));
    expect(screen.getByPlaceholderText('Their name')).toBeTruthy();
  });

  it('a house without Kids profiles may put the Parent PIN off ("Not now"), then manages from the gate with no PIN', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.setPin('main', '1111');
    p.createProfile({ name: 'Mom', avatar: 'pink', kidsLevel: null });
    const { default: Screens } = await import('./ProfileScreens');
    const view = render(<Screens mode="gate" onClose={() => {}} />);
    expect(screen.getByText('Create a parent PIN')).toBeTruthy();
    await settle();
    fireEvent.click(screen.getByText('Not now'));
    expect(screen.getByText("Who's watching?")).toBeTruthy();
    fireEvent.click(screen.getByText('Manage profiles'));
    expect(screen.getByText('Pick a profile to change it.')).toBeTruthy();
    // Put off on this box: not asked by itself again while there are no Kids profiles.
    view.unmount();
    render(<Screens mode="pick" onClose={() => {}} />);
    expect(screen.getByText("Who's watching?")).toBeTruthy();
    expect(p.hasParentPin()).toBe(false);
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

  it("offers to bring this box's profiles to the account after signing in (a Kids one makes the Parent PIN first)", async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.putOffParentPin();
    localStorage.setItem('smc-profiles-v1:device', JSON.stringify([
      { id: 'main', name: 'Me', avatar: 'blue', kidsLevel: null, pinHash: null, position: 0, t: 0 },
      { id: 'mia', name: 'Mia', avatar: 'pink', kidsLevel: 'kids', pinHash: null, position: 1, t: 1 },
    ]));
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="manage" onClose={() => {}} />);
    await settle();
    fireEvent.click(screen.getByText('Add Mia from this box'));
    await settle();
    expect(screen.getByText('Kids profiles need a parent PIN first. It keeps kids from changing profiles.')).toBeTruthy();
    await type('2468');
    await type('2468');
    expect(p.hasParentPin()).toBe(true);
    expect(screen.getByText('Mia')).toBeTruthy();
    expect(p.loadProfiles().map((x) => x.id)).toEqual(['main', 'mia']);
    expect(screen.queryByText('Add Mia from this box')).toBeNull();
  });
});

const focused = () => document.querySelector<HTMLElement>('[data-focused="true"]')?.dataset.pf;

describe('the Parent PIN: making it', () => {
  it('the first time Profiles opens on a grown-up profile, it waits for the account, then asks for one, typed twice', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
    expect(screen.getByText('Create a parent PIN')).toBeTruthy();
    // This box hasn't heard from the account yet: no pad before it has.
    expect(screen.getByText('Checking your account…')).toBeTruthy();
    expect(document.querySelector('[data-pf="pad-1"]')).toBeNull();
    await settle();
    expect(screen.getByText('A parent PIN keeps kids from changing profiles.')).toBeTruthy();
    // The remote is on the pad, not on "Not now" (OK there would dismiss it).
    expect(focused()).toBe('pad-1');
    expect(screen.getByText('Not now')).toBeTruthy();
    await type('1234');
    expect(screen.getByText('Enter the parent PIN again')).toBeTruthy();
    await type('9999');
    expect(screen.getByText("Those didn't match. Enter the new PIN again.")).toBeTruthy();
    expect(screen.getByText('Create a parent PIN')).toBeTruthy();
    await type('1234');
    await type('1234');
    expect(screen.getByText("Who's watching?")).toBeTruthy();
    expect(account.parent.u1.pin_hash).toBe(p.hashPin('__parent__', '1234', 'u1'));
    // Making it is not giving it: Manage asks for it.
    fireEvent.click(screen.getByText('Manage profiles'));
    expect(screen.getByText('Enter the parent PIN')).toBeTruthy();
  });

  it('the account already has one (made on another box): it is never offered here, and Profiles asks for that one', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    account.parent.u1 = { user_id: 'u1', pin_hash: p.hashPin('__parent__', '2580', 'u1'), updated_at: '2029-01-01T00:00:00.000Z' };
    expect(p.parentPinKnown()).toBe(false);
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
    await settle();
    expect(screen.queryByText('Create a parent PIN')).toBeNull();
    expect(screen.getByText("Who's watching?")).toBeTruthy();
    fireEvent.click(screen.getByText('Manage profiles'));
    expect(screen.getByText('Enter the parent PIN')).toBeTruthy();
    await type('2580');
    expect(screen.getByText('Pick a profile to change it.')).toBeTruthy();
    expect(account.parentWrites).toEqual([]);
  });

  it("can't reach the account: no pad, Retry and Cancel; Cancel goes on without one, Retry offers it once the account answers", async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.createProfile({ name: 'Mom', avatar: 'teal', kidsLevel: null });
    account.offline = true;
    const { default: Screens } = await import('./ProfileScreens');
    const view = render(<Screens mode="gate" onClose={() => {}} />);
    await settle();
    expect(screen.getByText("Can't reach your account")).toBeTruthy();
    expect(document.querySelector('[data-pf="pad-1"]')).toBeNull();
    expect(focused()).toBe('pp-retry');
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText("Who's watching?")).toBeTruthy();
    expect(p.hasParentPin()).toBe(false);
    view.unmount();
    render(<Screens mode="gate" onClose={() => {}} />);
    await settle();
    account.offline = false;
    fireEvent.click(screen.getByText('Retry'));
    await settle();
    expect(screen.getByText('A parent PIN keeps kids from changing profiles.')).toBeTruthy();
    expect(focused()).toBe('pad-1');
  });

  it('the start-up gate never hangs: a request that never answers gives up, and Back goes on', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.createProfile({ name: 'Mom', avatar: 'teal', kidsLevel: null });
    account.hang = true;
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="gate" onClose={() => {}} />);
    await settle();
    expect(screen.getByText('Checking your account…')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(screen.getByText("Can't reach your account")).toBeTruthy();
    await key('Escape');
    expect(screen.getByText("Who's watching?")).toBeTruthy();
  });

  it('repro #1, closed: a kid on a Kids profile is never offered it; the old grown-up PIN still guards Manage', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.setPin('main', '9999');
    const mia = p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' })!;
    p.pickProfile(mia.id);
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
    await settle();
    expect(screen.queryByText('Create a parent PIN')).toBeNull();
    expect(screen.getByText('A grown-up sets up the parent PIN.')).toBeTruthy();
    fireEvent.click(screen.getByText('Manage profiles'));
    expect(screen.getByText('Ask a grown-up')).toBeTruthy();
    await type('0000');
    expect(screen.getByText("That isn't a grown-up's PIN.")).toBeTruthy();
    expect(p.getProfile(mia.id)?.kidsLevel).toBe('kids');
    expect(account.parent.u1).toBeUndefined();
  });

  it('from a Kids profile, a Kids profile is not made without a Parent PIN (a grown-up sets that up)', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    const mia = p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' })!;
    p.pickProfile(mia.id);
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
    await settle();
    // No grown-up PIN anywhere: the old rules let Manage open...
    fireEvent.click(screen.getByText('Add profile'));
    fireEvent.change(screen.getByPlaceholderText('Their name'), { target: { value: 'Leo' } });
    fireEvent.click(screen.getByText('Kids'));
    fireEvent.click(screen.getByText('Save'));
    // ...but the Parent PIN isn't made from here, so neither is the Kids profile.
    expect(screen.queryByText('Create a parent PIN')).toBeNull();
    expect(screen.getByText('A grown-up sets up the parent PIN.')).toBeTruthy();
    expect(p.loadProfiles().some((x) => x.name === 'Leo')).toBe(false);
  });

  it('repro #2, closed: offline, a box that never heard from the account offers nothing, and the parent\'s PIN stands', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    account.parent.u1 = { user_id: 'u1', pin_hash: p.hashPin('__parent__', '2580', 'u1'), updated_at: '2029-01-01T00:00:00.000Z' };
    const mia = p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' })!;
    p.pickProfile(mia.id);
    account.offline = true;
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
    await settle();
    expect(screen.queryByText('Create a parent PIN')).toBeNull();
    expect(document.querySelector('[data-pf="pad-1"]')).toBeNull();
    account.offline = false;
    await act(async () => { await p.pullProfiles(); });
    expect(account.parent.u1.pin_hash).toBe(p.hashPin('__parent__', '2580', 'u1'));
    expect(account.parentWrites).toEqual([]);
    expect(p.checkParentPin('2580')).toBe(true);
  });

  it('repro #3, closed: a Kids hold from another account is not left by a Parent PIN made on a new account', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    const v = await import('@/lib/viewer');
    // Parent account P: Mia (Kids) in use, a Parent PIN, no profile PINs.
    v.__setViewerForTests('P');
    const mia = p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' })!;
    p.setParentPin('2580');
    p.pickProfile(mia.id);
    // Signed out, then the kid signs in to (or signs up for) account K, and gives it PINs.
    v.__setViewerForTests('K');
    p.pickProfile('main');
    p.setPin('main', '1111');
    p.setParentPin('0000');
    localStorage.setItem('smc-kids-hold', JSON.stringify({ level: 'kids', acc: 'P' }));
    expect(p.kidsHoldNeedsGrownUp()).toBe(true);
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
    await settle();
    expect(screen.queryByText('Create a parent PIN')).toBeNull();
    fireEvent.click(screen.getByText('Me'));
    expect(screen.getByText('Ask a grown-up')).toBeTruthy();
    // K's PINs are not P's grown-up.
    await type('0000');
    await type('1111');
    expect(screen.getByText("That isn't a grown-up's PIN.")).toBeTruthy();
    expect(localStorage.getItem('smc-kids-hold')).not.toBeNull();
    await type('2580');
    // P's grown-up said so; Me has its own PIN, which comes next.
    expect(screen.getByText('Enter the PIN for Me')).toBeTruthy();
    await type('1111');
    expect(localStorage.getItem('smc-kids-hold')).toBeNull();
  });

  it("on an account with a Kids profile, a grown-up proves it first with a grown-up profile's PIN", async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.setPin('main', '9999');
    p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' });
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="gate" onClose={() => {}} />);
    await settle();
    expect(screen.getByText('Create a parent PIN')).toBeTruthy();
    expect(screen.getByText("This account has Kids profiles, so first a grown-up's profile PIN. Then the new parent PIN.")).toBeTruthy();
    await type('0000');
    expect(screen.getByText("That isn't a grown-up's PIN.")).toBeTruthy();
    await type('9999');
    expect(screen.getByText('A parent PIN keeps kids from changing profiles.')).toBeTruthy();
    await type('1357');
    await type('1357');
    expect(screen.getByText("Who's watching?")).toBeTruthy();
    expect(account.parent.u1.pin_hash).toBe(p.hashPin('__parent__', '1357', 'u1'));
    // Proven on the way: Manage opens without asking again.
    fireEvent.click(screen.getByText('Manage profiles'));
    expect(screen.getByText('Pick a profile to change it.')).toBeTruthy();
  });

  it('...or, with no grown-up profile PIN, with a code emailed to the account that goes in with the new PIN', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' });
    const { default: Screens } = await import('./ProfileScreens');
    const view = render(<Screens mode="pick" onClose={() => {}} />);
    await settle();
    expect(screen.getByText("This account has Kids profiles, so a grown-up proves it first: we email a 6-digit code to the account's address.")).toBeTruthy();
    // Not now, this time: asked again next time (there is a Kids profile).
    fireEvent.click(screen.getByText('Not now'));
    expect(screen.getByText("Who's watching?")).toBeTruthy();
    view.unmount();
    render(<Screens mode="pick" onClose={() => {}} />);
    await settle();
    fireEvent.click(screen.getByText('Email me a code'));
    await settle();
    expect(account.invokes[0]).toEqual({ action: 'request', profile_id: '__parent__' });
    expect(screen.getByText('We emailed a 6-digit code to ow•••••@example.com. Enter it below.')).toBeTruthy();
    for (const d of '123456') await key(d);
    await settle();
    expect(screen.getByText('New parent PIN')).toBeTruthy();
    await type('2468');
    await type('2468');
    expect(account.invokes[1]).toEqual({ action: 'verify', profile_id: '__parent__', code: '123456', new_pin_hash: p.hashPin('__parent__', '2468', 'u1') });
    expect(screen.getByText("Who's watching?")).toBeTruthy();
    expect(p.checkParentPin('2468')).toBe(true);
  });

  it('a house without Kids profiles: making a Kids profile makes the Parent PIN first, right there', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.putOffParentPin();
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
    await settle();
    fireEvent.click(screen.getByText('Add profile'));
    fireEvent.change(screen.getByPlaceholderText('Their name'), { target: { value: 'Mia' } });
    fireEvent.click(screen.getByText('Kids'));
    fireEvent.click(screen.getByText('Save'));
    expect(screen.getByText('Create a parent PIN')).toBeTruthy();
    expect(screen.getByText('Kids profiles need a parent PIN first. It keeps kids from changing profiles.')).toBeTruthy();
    // Not saved until there is one.
    expect(p.loadProfiles().some((x) => x.name === 'Mia')).toBe(false);
    await type('4321');
    await type('4321');
    expect(p.hasParentPin()).toBe(true);
    expect(p.loadProfiles().find((x) => x.name === 'Mia')?.kidsLevel).toBe('kids');
    expect(screen.getByText("Who's watching?")).toBeTruthy();
  });
});

describe('the Parent PIN: using it', () => {
  it('from a Kids profile, Manage takes the Parent PIN (once per opening); then Kids can be switched off', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    const mia = p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' })!;
    p.setPin(p.createProfile({ name: 'Dad', avatar: 'gold', kidsLevel: null })!.id, '1111');
    p.setParentPin('2580');
    p.pickProfile(mia.id);
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
    await settle();
    fireEvent.click(screen.getByText('Manage profiles'));
    expect(screen.getByText('Enter the parent PIN')).toBeTruthy();
    // Dad's own PIN is not the Parent PIN.
    await type('1111');
    expect(screen.getByText("That isn't the parent PIN.")).toBeTruthy();
    await type('2580');
    expect(screen.getByText('Pick a profile to change it.')).toBeTruthy();
    fireEvent.click(screen.getByText('Mia'));
    fireEvent.click(screen.getByText('Off'));
    fireEvent.click(screen.getByText('Save'));
    expect(p.getProfile(mia.id)?.kidsLevel).toBeNull();
  });

  it('from a Kids profile, a grown-up profile takes the Parent PIN, or its own; grown-up to grown-up does not', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    const mia = p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' })!;
    const mom = p.createProfile({ name: 'Mom', avatar: 'teal', kidsLevel: null })!;
    const dad = p.setPin(p.createProfile({ name: 'Dad', avatar: 'gold', kidsLevel: null })!.id, '1111')!;
    p.setParentPin('2580');
    const { default: Screens } = await import('./ProfileScreens');

    p.pickProfile(mia.id);
    let view = render(<Screens mode="pick" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Mom'));
    expect(screen.getByText('Enter the parent PIN')).toBeTruthy();
    await type('2580');
    expect(p.activeProfile().id).toBe(mom.id);
    view.unmount();

    // Grown-up to grown-up: nothing asked (Mom has no PIN of her own).
    p.pickProfile('main');
    view = render(<Screens mode="pick" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Mom'));
    expect(p.activeProfile().id).toBe(mom.id);
    view.unmount();

    // Kids to Dad: his own pad, which the Parent PIN opens too.
    p.pickProfile(mia.id);
    render(<Screens mode="pick" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Dad'));
    expect(screen.getByText('Enter the PIN for Dad')).toBeTruthy();
    expect(screen.getByText('Or enter the parent PIN.')).toBeTruthy();
    await type('2580');
    expect(p.activeProfile().id).toBe(dad.id);
  });

  it('the start-up gate after a Kids session asks the Parent PIN for a grown-up profile, not for a Kids one', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    const mia = p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' })!;
    const leo = p.createProfile({ name: 'Leo', avatar: 'green', kidsLevel: 'little' })!;
    p.setParentPin('2580');
    p.pickProfile(mia.id);
    sessionStorage.clear();
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="gate" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Me'));
    expect(screen.getByText('Enter the parent PIN')).toBeTruthy();
    await key('Escape');
    expect(screen.getByText("Who's watching?")).toBeTruthy();
    fireEvent.click(screen.getByText('Leo'));
    expect(p.activeProfile().id).toBe(leo.id);
  });

  it('wrong tries: "Forgot PIN?" after three, a pause after five that even the right PIN waits out', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.setParentPin('2580');
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="manage" onClose={() => {}} />);
    expect(screen.getByText('Enter the parent PIN')).toBeTruthy();
    for (let i = 0; i < 3; i++) await type('0000');
    expect(screen.getByText('Forgot PIN?')).toBeTruthy();
    for (let i = 0; i < 2; i++) await type('0000');
    expect(screen.getByText("That isn't the parent PIN. Too many tries — wait 30 seconds.")).toBeTruthy();
    await type('2580');
    expect(screen.getByText(/^Too many tries — wait \d+ seconds\.$/)).toBeTruthy();
    expect(screen.queryByText('Pick a profile to change it.')).toBeNull();
  });

  it('Forgot PIN: the emailed code and a new PIN go together; a wrong code keeps the old one', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.setParentPin('2580');
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="manage" onClose={() => {}} />);
    for (let i = 0; i < 3; i++) await type('0000');
    fireEvent.click(screen.getByText('Forgot PIN?'));
    await settle();
    expect(screen.getByText('Reset the parent PIN')).toBeTruthy();
    expect(screen.getByText('We emailed a 6-digit code to ow•••••@example.com. Enter it below.')).toBeTruthy();
    expect(account.invokes[0]).toEqual({ action: 'request', profile_id: '__parent__' });

    // A wrong code: found out once the new PIN is in, and the old one stands.
    account.verifyFails = { ok: false, reason: 'wrong_code', left: 4 };
    for (const d of '000000') await key(d);
    await settle();
    expect(screen.getByText('New parent PIN')).toBeTruthy();
    await type('7777');
    expect(screen.getByText('Enter the parent PIN again')).toBeTruthy();
    await type('7777');
    expect(screen.getByText("That code isn't right. 4 tries left.")).toBeTruthy();
    expect(screen.getByText('Reset the parent PIN')).toBeTruthy();
    expect(p.checkParentPin('2580')).toBe(true);

    account.verifyFails = null;
    for (const d of '123456') await key(d);
    await settle();
    await type('7777');
    await type('7777');
    expect(account.invokes[account.invokes.length - 1]).toEqual({ action: 'verify', profile_id: '__parent__', code: '123456', new_pin_hash: p.hashPin('__parent__', '7777', 'u1') });
    // On to what it was asked for (Manage), not asked again.
    expect(screen.getByText('Pick a profile to change it.')).toBeTruthy();
    expect(p.checkParentPin('7777')).toBe(true);
  });

  it('signed out: no Parent PIN to make; Manage says signing in protects profiles with one', async () => {
    const v = await import('@/lib/viewer');
    v.__setViewerForTests('device');
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="manage" onClose={() => {}} />);
    expect(screen.queryByText('Create a parent PIN')).toBeNull();
    expect(screen.getByText('Pick a profile to change it.')).toBeTruthy();
    expect(screen.getByText('Sign in to your Snow Media account to protect profiles with a parent PIN.')).toBeTruthy();
  });

  it('Settings → Parent PIN: the old one first, then change it; turning it off waits until there are no Kids profiles', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    const mia = p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' })!;
    p.setParentPin('2580');
    const { default: Screens } = await import('./ProfileScreens');
    const onClose = vi.fn();
    render(<Screens mode="parent" onClose={onClose} />);
    await settle();
    expect(screen.getByText('Enter the parent PIN')).toBeTruthy();
    await type('2580');
    expect(screen.getByText('Parent PIN')).toBeTruthy();
    expect((screen.getByText('Turn off').closest('button') as HTMLElement).hasAttribute('data-pf-disabled')).toBe(true);
    fireEvent.click(screen.getByText('Turn off'));
    expect(p.hasParentPin()).toBe(true);
    fireEvent.click(screen.getByText('Change parent PIN'));
    expect(screen.getByText('New parent PIN')).toBeTruthy();
    await type('1212');
    await type('1212');
    expect(screen.getByText('Parent PIN changed.')).toBeTruthy();
    expect(account.parent.u1.pin_hash).toBe(p.hashPin('__parent__', '1212', 'u1'));
    // No Kids profile left: it may go.
    act(() => { p.deleteProfile(mia.id); });
    fireEvent.click(screen.getByText('Turn off'));
    expect(screen.getByText('Parent PIN turned off.')).toBeTruthy();
    expect(p.hasParentPin()).toBe(false);
    await settle();
    expect(account.parent.u1).toBeUndefined();
    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalled();
  });

  it("Settings → Parent PIN, Create, on a box that can't reach the account: it says so, never the pad", async () => {
    vi.useFakeTimers();
    account.offline = true;
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="parent" onClose={() => {}} />);
    await settle();
    fireEvent.click(screen.getByText('Create parent PIN'));
    await settle();
    expect(screen.getByText("Can't reach your account")).toBeTruthy();
    expect(document.querySelector('[data-pf="pad-1"]')).toBeNull();
  });

  it("a Kids profile opening Settings: the grown-up pad takes the Parent PIN", async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' });
    p.setParentPin('2580');
    const { default: Screens } = await import('./ProfileScreens');
    const onOk = vi.fn();
    render(<Screens mode="grownup" onClose={() => {}} onGrownUpOk={onOk} />);
    expect(screen.getByText("The parent PIN or a grown-up's profile PIN opens this.")).toBeTruthy();
    await type('2580');
    expect(onOk).toHaveBeenCalled();
  });
});
