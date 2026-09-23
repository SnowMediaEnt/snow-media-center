import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { channel: vi.fn(), removeChannel: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/capacitor/AppManager', () => ({ AppManager: { injectKey: vi.fn(async () => { throw new Error('web'); }) } }));
vi.mock('@/lib/analytics', () => ({ getDeviceId: () => 'device-12345678', trackEvent: vi.fn() }));

describe('phoneRemote (the box)', () => {
  it('types the phone’s text into the focused box the way React sees it', async () => {
    const { __phoneRemoteForTests: t } = await import('./phoneRemote');
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const seen: string[] = [];
    input.addEventListener('input', () => seen.push(input.value));
    t.onPhoneMessage({ t: 'text', v: 'batman', id: 'p1' });
    expect(input.value).toBe('batman');
    expect(seen).toEqual(['batman']);
    input.remove();
  });

  it('presses a key off-device as a keydown with the remote’s key', async () => {
    const { pressRemoteKey } = await import('./phoneRemote');
    const keys: Array<[string, number]> = [];
    const on = (e: KeyboardEvent) => keys.push([e.key, e.keyCode]);
    window.addEventListener('keydown', on);
    await pressRemoteKey('down');
    await pressRemoteKey('back');
    window.removeEventListener('keydown', on);
    expect(keys).toEqual([['ArrowDown', 40], ['Escape', 27]]);
  });

  it('counts a phone as connected once it says hello, and forgets it on bye', async () => {
    const m = await import('./phoneRemote');
    m.__phoneRemoteForTests.onPhoneMessage({ t: 'hello', id: 'p2' });
    expect(m.connectedPhones()).toBeGreaterThan(0);
    m.__phoneRemoteForTests.onPhoneMessage({ t: 'bye', id: 'p2' });
    m.__phoneRemoteForTests.onPhoneMessage({ t: 'bye', id: 'p1' });
    expect(m.connectedPhones()).toBe(0);
  });
});
