import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
// Imported first, as Home does: the overlay's key listener comes first.
import Host from './voice/VoiceCommandHost';
import { openVoice } from '@/lib/voiceUi';

vi.mock('@/components/VoiceInput', () => ({ default: () => <button type="button">Voice</button> }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, functions: { invoke: vi.fn() }, rpc: async () => ({}) },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useSupportTickets', () => ({ useSupportTickets: () => ({ createTicket: vi.fn() }) }));
vi.mock('@/hooks/useDeviceInstalledApps', () => ({
  useDeviceInstalledApps: () => ({ isPackageInstalled: () => false, isAppNameInstalled: () => false, resolvePackageName: () => null, refresh: () => undefined }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), getDeviceId: () => 'box' }));
vi.mock('@/capacitor/AppManager', () => ({ AppManager: { openAppSettings: vi.fn(), launch: vi.fn() }, isWebUnsupportedError: () => false }));
vi.mock('@/components/SpeedTest', () => ({ default: () => null }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,' } }));
// Capacitor's backButton listeners, called in turn as a hardware Back would.
const backs: Array<() => void> = [];
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_: string, fn: () => void) => {
      backs.push(fn);
      return { remove() { const i = backs.indexOf(fn); if (i >= 0) backs.splice(i, 1); } };
    },
  },
}));

import BufferingGuide from './BufferingGuide';

const hardwareBack = () => act(async () => { for (const b of [...backs]) b(); });
const voice = () => document.querySelector('[aria-label="Voice"]');
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

// On its first screen, where Back closes the guide.
const renderGuide = async () => {
  const onClose = vi.fn();
  render(
    <BufferingGuide onClose={onClose} apps={[]} appStatuses={new Map()} onLaunch={vi.fn()} onDownload={vi.fn()} />,
  );
  await settle();
  return onClose;
};

beforeEach(() => {
  backs.length = 0;
  (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = 0;
  Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
});
afterEach(() => { document.querySelectorAll('[data-test-popup]').forEach((n) => n.remove()); });

describe('hardware Back on the Buffering Guide with a popup over it', () => {
  it.each([
    ['the overlay was listening first', false],
    ['the guide was listening first', true],
  ])('the voice overlay closes and the guide stays (%s)', async (_, guideFirst) => {
    render(<Host navigate={vi.fn()} />);
    await settle();
    const onClose = await renderGuide();
    expect(backs).toHaveLength(2);
    if (guideFirst) backs.reverse();
    await act(async () => { openVoice(); });
    expect(voice()).toBeTruthy();

    await hardwareBack();
    expect(voice()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // The next press is the guide's again.
    await new Promise((r) => setTimeout(r, 400));
    await hardwareBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves a press to any other popup on top (a kickoff reminder)', async () => {
    const onClose = await renderGuide();
    const popup = document.createElement('div');
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('data-state', 'open');
    popup.setAttribute('data-test-popup', '');
    document.body.appendChild(popup);
    await hardwareBack();
    expect(onClose).not.toHaveBeenCalled();
    popup.remove();
    await hardwareBack();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('with nothing on top, two quick presses are two presses (its own mark is not another popup\'s)', async () => {
    const onClose = await renderGuide();
    await hardwareBack();
    await hardwareBack();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
