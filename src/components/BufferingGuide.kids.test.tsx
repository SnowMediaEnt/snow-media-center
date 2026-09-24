import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { setKidsLevel } from '@/lib/kidsFilter';

// Signed in, with a VPN installed: every grown-up action would be live.
const { createTicket, openAppSettings, launch } = vi.hoisted(() => ({
  createTicket: vi.fn(async () => undefined),
  openAppSettings: vi.fn(async () => undefined),
  launch: vi.fn(async () => undefined),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useSupportTickets', () => ({ useSupportTickets: () => ({ createTicket }) }));
vi.mock('@/hooks/useDeviceInstalledApps', () => ({
  useDeviceInstalledApps: () => ({
    isPackageInstalled: () => true, isAppNameInstalled: () => true, resolvePackageName: () => null, refresh: () => undefined,
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/capacitor/AppManager', () => ({ AppManager: { openAppSettings, launch }, isWebUnsupportedError: () => false }));
vi.mock('@/components/SpeedTest', () => ({ default: () => null }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,' } }));

import BufferingGuide from './BufferingGuide';

// The remote's OK arrives as Enter, keyCode 13, on whatever has focus.
const ok = (label: string | RegExp) => {
  const el = screen.getByRole('button', { name: label });
  act(() => { el.focus(); });
  act(() => { fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 }); });
};

const renderGuide = () => {
  const props = {
    onClose: vi.fn(), apps: [], appStatuses: new Map<string, { installed: boolean }>(),
    onLaunch: vi.fn(), onDownload: vi.fn(), onOpenAppSettings: vi.fn(), onNavigateToChat: vi.fn(),
  };
  const { unmount } = render(<BufferingGuide {...props} />);
  return { ...props, unmount };
};

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
});
afterEach(() => { setKidsLevel(null); });

describe('Buffering Guide on a Kids profile', () => {
  it('has no VPN to install or open, and its results cannot become a ticket', () => {
    setKidsLevel('kids');
    const props = renderGuide();
    ok(/Go to the VPN step/);
    expect(screen.getByText(/A VPN is a grown-up's job/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /IPVanish/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Surfshark/ })).toBeNull();
    // Next goes straight on: there is nothing on this step a child can do.
    ok(/^Next/);
    expect(screen.getByText(/Show this screen to a grown-up/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send to support/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Start over/ })).toBeTruthy();
    expect(createTicket).not.toHaveBeenCalled();
    expect(props.onNavigateToChat).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });

  it('asks a grown-up to clear the cache instead of opening Android App Info', () => {
    setKidsLevel('little');
    const props = renderGuide();
    ok(/Dreamstreams/);
    ok(/^Next/);
    ok(/Everything buffers/);
    ok(/^Next/);
    expect(screen.getByText(/Ask a grown-up to do this part/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
    expect(props.onOpenAppSettings).not.toHaveBeenCalled();
    expect(openAppSettings).not.toHaveBeenCalled();
  });

  it('sends a one-channel problem to a grown-up, not into a ticket form', () => {
    setKidsLevel('teen');
    renderGuide();
    ok(/Dreamstreams/);
    ok(/^Next/);
    ok(/Just one channel or title/);
    expect(screen.getByText('Tell a grown-up')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Send report/ })).toBeNull();
    ok(/Change answer/);
    expect(screen.getByRole('button', { name: /Everything buffers/ })).toBeTruthy();
    expect(createTicket).not.toHaveBeenCalled();
  });
});

describe('Buffering Guide on a grown-up profile', () => {
  it('keeps the VPN install/open and App Info steps and Send to support', () => {
    const first = renderGuide();
    ok(/Go to the VPN step/);
    expect(screen.getByRole('button', { name: /Open IPVanish/ })).toBeTruthy();
    first.unmount();
    renderGuide();
    ok(/Dreamstreams/);
    ok(/^Next/);
    ok(/Everything buffers/);
    ok(/^Next/);
    expect(screen.getByRole('button', { name: /Open Dreamstreams settings/ })).toBeTruthy();
  });
});
