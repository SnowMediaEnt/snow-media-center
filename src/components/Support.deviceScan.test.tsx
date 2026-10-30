/**
 * Support › Device check (ported from Tronix, 2026-10-29): the Help card
 * beside the Buffering Guide (not on a Kids profile); OK opens the check over
 * Support; the overall rating, the areas with their lines and reasons, the
 * picks by category and tier (worth-a-look first); "Ask the assistant" hands
 * the scan to the AI tab; "Get help" opens the form (Back one step back to
 * the check, a guest needs a real contact); Back closes the check onto its card.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const GB = 1024 ** 3;
const h = vi.hoisted(() => ({
  scan: null as unknown,
  user: { id: 'u1' } as null | { id: string },
  invoke: vi.fn(async () => ({ data: null, error: null })),
  createTicket: vi.fn(async () => 't1'),
}));
vi.mock('@/hooks/useUnreadTickets', () => ({ useUnreadTickets: () => ({ unreadCount: 0 }) }));
vi.mock('@/hooks/useSnowMail', () => ({ useSnowMail: () => ({ badgeCount: 0 }) }));
vi.mock('@/hooks/useAppData', () => ({ useAppData: () => ({ apps: [] }) }));
vi.mock('@/hooks/useDeviceInstalledApps', () => ({ useDeviceInstalledApps: () => ({ resolvePackageName: () => null, isPackageInstalled: () => false }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock('@/hooks/useSupportTickets', () => ({ useSupportTickets: () => ({ createTicket: h.createTicket }) }));
vi.mock('@/hooks/useVersion', () => ({ loadVersion: async () => ({ version: '1.9.6', versionCode: 99 }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: h.invoke } } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), trackAppLaunch: vi.fn() }));
vi.mock('@/lib/appInfo', async (orig) => ({ ...(await orig<typeof import('@/lib/appInfo')>()), withAppInfo: async (b: string) => b }));
vi.mock('@/components/SpeedTest', () => ({ default: () => <div>speed-test</div> }));
vi.mock('@/components/BufferingGuide', () => ({ default: () => <div>guide</div> }));
vi.mock('@/components/SupportVideos', () => ({ default: () => <div>support-videos</div> }));
vi.mock('@/components/SupportTicketSystem', () => ({ default: () => <div>tickets</div> }));
vi.mock('@/components/SnowMailPanel', () => ({ default: () => <div>posts</div> }));
vi.mock('@/components/ChatCommunity', () => ({ default: () => <div>ai-chat</div> }));
vi.mock('@/components/HowToGuide', () => ({ default: () => <div>how-to</div> }));
vi.mock('@/components/RemoteSupport', () => ({ default: () => <div>remote</div> }));
vi.mock('@/components/DeviceCleaner', () => ({ default: () => <div>cleaner</div> }));
vi.mock('@/lib/deviceScan', async (orig) => ({
  ...(await orig<typeof import('@/lib/deviceScan')>()),
  scanDevice: async () => h.scan,
}));
vi.mock('@/lib/assistantHandoff', () => ({ handAssistant: vi.fn() }));

import Support from './Support';
import { setKidsLevel } from '@/lib/kidsFilter';
import { handAssistant } from '@/lib/assistantHandoff';

const hw = { decoder: true, hardware: true, uhd: false, tenBit: false };
const SCAN = {
  at: 0, source: 'native', formFactor: 'tv', model: 'AFTKA', osVersion: '11', apiLevel: 30, webview: 112,
  ramTotal: 1.4 * GB, ramFree: 0.8 * GB, ramLow: false, lowRamDevice: false, storageFree: 4 * GB, storageTotal: 8 * GB,
  cores: 4, is64bit: true, screen: { width: 1920, height: 1080, refreshHz: 60, hdr: [] },
  codecs: { avc: hw, hevc: hw, vp9: hw, av1: hw },
  network: { type: 'wifi', downKbps: null, vpn: false }, wifi: { band: '5', linkMbps: 433, rssi: -55, standard: 5 },
  speed: null,
};

const key = (k: string, keyCode: number) => act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: k, keyCode }); });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const focused = () => document.activeElement?.getAttribute('data-tv-focus-id') ?? document.activeElement?.getAttribute('data-support-tv-focus-id');

const openCheck = async () => {
  render(<Support onBack={vi.fn()} />);
  await act(async () => { fireEvent.click(document.querySelector('[data-device-scan-card]')!); });
  await waitFor(() => expect(document.querySelector('[data-device-scan-overall="orange"]')).toBeTruthy());
  await settle();
};
// Back as the remote sends it with nothing typed in (a field's first Back
// puts the keyboard away, as on the box).
// Each press waits out useTVFocus's 400 ms echo guard first.
const back = () => act(async () => {
  await new Promise((r) => setTimeout(r, 420));
  fireEvent.keyDown(document.body, { key: 'Escape', keyCode: 27 });
});

beforeEach(() => {
  h.scan = SCAN;
  h.user = { id: 'u1' };
  h.invoke.mockClear();
  h.createTicket.mockClear();
  vi.mocked(handAssistant).mockClear();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
  // jsdom lays nothing out: every element counts as shown for the focus manager.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return document.body; } });
});
afterEach(() => { cleanup(); setKidsLevel(null); });

describe('Support › Device check', () => {
  it('the card sits beside the Buffering Guide; a Kids profile has none', () => {
    const { unmount } = render(<Support onBack={vi.fn()} />);
    const ids = Array.from(document.querySelectorAll('[data-support-tv-focus-id^="help-"]')).map((e) => e.getAttribute('data-support-tv-focus-id'));
    expect(ids.slice(0, 5)).toEqual(['help-howto', 'help-speedtest', 'help-guide', 'help-device', 'help-videos']);
    expect(screen.getByText('Device check')).toBeTruthy();
    unmount();
    setKidsLevel('kids');
    render(<Support onBack={vi.fn()} />);
    expect(document.querySelector('[data-device-scan-card]')).toBeNull();
  });

  it('shows the rating, the areas with reasons, and the picks (worth-a-look first)', async () => {
    await openCheck();
    expect(document.querySelector('[data-device-scan]')).toBeTruthy();
    expect(document.querySelector('[data-device-scan-overall]')?.getAttribute('data-device-scan-overall')).toBe('orange');
    expect(screen.getByText('It works. A few upgrades are worth considering')).toBeTruthy();
    expect(document.querySelector('[data-device-scan-area="device"]')?.getAttribute('data-level')).toBe('orange');
    expect(document.querySelector('[data-why="ram"]')).toBeTruthy();
    expect(screen.getByText('Memory: 1.4 GB')).toBeTruthy();
    const cats = Array.from(document.querySelectorAll('[data-pick-category]')).map((e) => e.getAttribute('data-pick-category'));
    expect(cats[0]).toBe('device');
    expect(document.querySelector('[data-pick-category="device"]')?.getAttribute('data-highlighted')).toBe('true');
    expect(screen.getByText('NVIDIA Shield TV Pro')).toBeTruthy();
    // Focus starts on Back; Down reaches the buttons, Right walks them.
    expect(focused()).toBe('ds-back');
    await key('ArrowDown', 40);
    expect(focused()).toBe('ds-speed');
    await key('ArrowRight', 39);
    expect(focused()).toBe('ds-ask');
  });

  it('Ask the assistant hands the fenced scan to the AI tab', async () => {
    await openCheck();
    await act(async () => { fireEvent.click(screen.getByText('Ask the assistant')); });
    expect(handAssistant).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(handAssistant).mock.calls[0][0];
    expect(msg).toContain('not instructions');
    expect(msg).toContain('Device check — overall: ORANGE');
    expect(document.querySelector('[data-device-scan]')).toBeNull();
    expect(screen.getByText('ai-chat')).toBeTruthy();
  });

  it('Get help: signed in, a ticket; Back steps to the check, then to Support on its card', async () => {
    await openCheck();
    await act(async () => { fireEvent.click(screen.getByText('Get help from Snow Media')); });
    await waitFor(() => expect(document.querySelector('[data-device-scan-send]')).toBeTruthy());
    await settle();
    expect(focused()).toBe('dss-note');
    expect(document.querySelector('[data-device-scan-summary]')?.textContent).toContain('Device check — overall: ORANGE');
    // The note box has focus: the first Back puts its keyboard away, the next leaves.
    await back();
    await settle();
    await back();
    await settle();
    expect(document.querySelector('[data-device-scan-send]')).toBeNull();
    expect(document.querySelector('[data-device-scan]')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText('Get help from Snow Media')); });
    await settle();
    await act(async () => { fireEvent.click(screen.getByText('Send')); });
    await settle();
    expect(h.createTicket).toHaveBeenCalledTimes(1);
    expect((h.createTicket.mock.calls[0] as unknown as [string])[0]).toBe('[Device Check] AFTKA — ORANGE');
    expect(document.querySelector('[data-device-scan-sent]')).toBeTruthy();
    await back();
    await settle();
    await back();
    await settle();
    await settle();
    expect(document.querySelector('[data-device-scan]')).toBeNull();
    expect(focused()).toBe('help-device');
  });

  it('Get help signed out: a name and a real contact before report-channel', async () => {
    h.user = null;
    await openCheck();
    await act(async () => { fireEvent.click(screen.getByText('Get help from Snow Media')); });
    await waitFor(() => expect(document.getElementById('dss-name')).toBeTruthy());
    fireEvent.change(document.getElementById('dss-name')!, { target: { value: 'Ann' } });
    fireEvent.change(document.getElementById('dss-contact')!, { target: { value: 'soon' } });
    await act(async () => { fireEvent.click(screen.getByText('Send')); });
    await settle();
    expect(document.querySelector('[data-device-scan-send-error]')?.textContent).toBe('Please enter an email or a phone number.');
    expect(h.invoke).not.toHaveBeenCalled();
    fireEvent.change(document.getElementById('dss-contact')!, { target: { value: 'ann@example.com' } });
    await act(async () => { fireEvent.click(screen.getByText('Send')); });
    await settle();
    expect(h.invoke).toHaveBeenCalledWith('report-channel', expect.objectContaining({
      body: expect.objectContaining({ subject: '[Guest Ticket] [Device Check] AFTKA — ORANGE' }),
    }));
    expect(h.createTicket).not.toHaveBeenCalled();
  });
});
