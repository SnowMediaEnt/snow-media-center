import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// "Forgot PIN?" calls: what was sent, and what verify answers.
const fx = vi.hoisted(() => ({ invokes: [] as Array<Record<string, unknown>>, verify: { ok: true } as Record<string, unknown> }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
    functions: {
      invoke: async (_name: string, opts: { body: Record<string, unknown> }) => {
        fx.invokes.push(opts.body);
        return opts.body.action === 'request'
          ? { data: { ok: true, emailed: true, email: 'ow•••••@example.com' }, error: null }
          : { data: fx.verify, error: null };
      },
    },
  },
}));
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
  fx.invokes.length = 0; fx.verify = { ok: true };
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
    fireEvent.click(screen.getByText('Add Mia from this box'));
    expect(screen.getByText('Kids profiles need a parent PIN first. It keeps kids from changing profiles.')).toBeTruthy();
    await type('2468');
    await type('2468');
    expect(p.hasParentPin()).toBe(true);
    expect(screen.getByText('Mia')).toBeTruthy();
    expect(p.loadProfiles().map((x) => x.id)).toEqual(['main', 'mia']);
    expect(screen.queryByText('Add Mia from this box')).toBeNull();
  });
});

describe('the Parent PIN', () => {
  it('the first time Profiles opens on a signed-in account, it asks for one to be made, typed twice', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
    expect(screen.getByText('Create a parent PIN')).toBeTruthy();
    // This box hasn't heard from the account yet: it asks before offering the pad.
    expect(screen.getByText('Checking your account…')).toBeTruthy();
    await settle();
    expect(screen.getByText('A parent PIN keeps kids from changing profiles.')).toBeTruthy();
    // No Kids profile yet: it may be put off.
    expect(screen.getByText('Not now')).toBeTruthy();
    await type('1234');
    expect(screen.getByText('Enter the parent PIN again')).toBeTruthy();
    await type('9999');
    expect(screen.getByText("Those didn't match. Enter the new PIN again.")).toBeTruthy();
    expect(screen.getByText('Create a parent PIN')).toBeTruthy();
    await type('1234');
    await type('1234');
    expect(screen.getByText("Who's watching?")).toBeTruthy();
    expect(p.hasParentPin()).toBe(true);
    expect(p.checkParentPin('1234')).toBe(true);
  });

  it('with a Kids profile it cannot be put off: Back leaves Profiles with nothing changed, and the gate waits for it', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' });
    const { default: Screens } = await import('./ProfileScreens');
    const onClose = vi.fn();
    const view = render(<Screens mode="pick" onClose={onClose} />);
    await settle();
    expect(screen.getByText('Create a parent PIN')).toBeTruthy();
    expect(screen.queryByText('Not now')).toBeNull();
    await key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(p.hasParentPin()).toBe(false);
    view.unmount();
    // At the start-up gate on a grown-up profile there is no way past it.
    const gateClose = vi.fn();
    render(<Screens mode="gate" onClose={gateClose} />);
    await settle();
    await key('Escape');
    expect(gateClose).not.toHaveBeenCalled();
    expect(screen.getByText('Create a parent PIN')).toBeTruthy();
  });

  it('making a Kids profile makes the Parent PIN first, right there', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    p.putOffParentPin();
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
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

  it('from a Kids profile, Manage takes the Parent PIN (once per opening); then Kids can be switched off', async () => {
    vi.useFakeTimers();
    const p = await import('@/lib/profiles');
    const mia = p.createProfile({ name: 'Mia', avatar: 'pink', kidsLevel: 'kids' })!;
    p.setParentPin('2580');
    p.pickProfile(mia.id);
    const { default: Screens } = await import('./ProfileScreens');
    render(<Screens mode="pick" onClose={() => {}} />);
    fireEvent.click(screen.getByText('Manage profiles'));
    expect(screen.getByText('Enter the parent PIN')).toBeTruthy();
    // A grown-up profile's PIN is not the Parent PIN.
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
    expect(fx.invokes[0]).toEqual({ action: 'request', profile_id: '__parent__' });

    // A wrong code: found out once the new PIN is in, and the old one stands.
    fx.verify = { ok: false, reason: 'wrong_code', left: 4 };
    for (const d of '000000') await key(d);
    await settle();
    expect(screen.getByText('New parent PIN')).toBeTruthy();
    await type('7777');
    expect(screen.getByText('Enter the parent PIN again')).toBeTruthy();
    await type('7777');
    expect(screen.getByText("That code isn't right. 4 tries left.")).toBeTruthy();
    expect(screen.getByText('Reset the parent PIN')).toBeTruthy();
    expect(p.checkParentPin('2580')).toBe(true);

    fx.verify = { ok: true };
    for (const d of '123456') await key(d);
    await settle();
    await type('7777');
    await type('7777');
    expect(fx.invokes[fx.invokes.length - 1]).toEqual({ action: 'verify', profile_id: '__parent__', code: '123456', new_pin_hash: p.hashPin('__parent__', '7777', 'u1') });
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
    expect(p.checkParentPin('1212')).toBe(true);
    // No Kids profile left: it may go.
    act(() => { p.deleteProfile(mia.id); });
    fireEvent.click(screen.getByText('Turn off'));
    expect(screen.getByText('Parent PIN turned off.')).toBeTruthy();
    expect(p.hasParentPin()).toBe(false);
    fireEvent.click(screen.getByText('Done'));
    expect(onClose).toHaveBeenCalled();
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
