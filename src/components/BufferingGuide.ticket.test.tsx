import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { createTicket, invoke, auth } = vi.hoisted(() => ({
  createTicket: vi.fn(async () => undefined),
  invoke: vi.fn(async () => ({ error: null })),
  auth: { user: { id: 'u1' } as { id: string } | null },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('@/hooks/useSupportTickets', () => ({ useSupportTickets: () => ({ createTicket }) }));
vi.mock('@/hooks/useDeviceInstalledApps', () => ({
  useDeviceInstalledApps: () => ({
    isPackageInstalled: () => false, isAppNameInstalled: () => false, resolvePackageName: () => null, refresh: () => undefined,
  }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/utils/platform', async () => {
  const real = await vi.importActual<typeof import('@/utils/platform')>('@/utils/platform');
  return { ...real, isNativePlatform: () => true };
});
vi.mock('@/capacitor/AppManager', () => ({
  AppManager: {
    openAppSettings: vi.fn(), launch: vi.fn(),
    getAppInfo: async () => ({ versionName: '1.8.0', versionCode: 55, packageName: 'com.snowmedia.player' }),
  },
  isWebUnsupportedError: () => false,
}));
vi.mock('@/components/SpeedTest', () => ({ default: () => null }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,' } }));

import BufferingGuide from './BufferingGuide';

const ok = (label: string | RegExp) => {
  const el = screen.getByRole('button', { name: label });
  act(() => { el.focus(); });
  act(() => { fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 }); });
};

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'u1' };
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
});

describe('Buffering Guide ticket', () => {
  it('names the app version and build at the top of the ticket body', async () => {
    render(<BufferingGuide onClose={vi.fn()} apps={[]} appStatuses={new Map()} onLaunch={vi.fn()} onDownload={vi.fn()} onOpenAppSettings={vi.fn()} onNavigateToChat={vi.fn()} />);
    ok(/DreamStreams/);
    ok(/Go to the VPN step/);
    ok(/^Next/);
    ok(/Skip VPN/);
    await act(async () => { ok(/Send to support/); await new Promise((r) => setTimeout(r, 50)); });
    expect(createTicket).toHaveBeenCalledTimes(1);
    // The ticket waits for the line info (lib/lineInfo, loaded on demand) before it goes.
    await waitFor(() => expect(createTicket).toHaveBeenCalled());
    const [subject, body] = createTicket.mock.calls[0] as unknown as [string, string];
    expect(subject).toMatch(/Buffering Walkthrough Results/);
    expect(body.split('\n')[0]).toBe('App: Snow Media Center 1.8.0 (build 55)');
    expect(body).toContain('Snow Media Buffering Walkthrough Results:');
  });
});
