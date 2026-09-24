import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
// Imported first, as Home does: the overlay's key listener comes first.
import Host from './voice/VoiceCommandHost';
import { openVoice } from '@/lib/voiceUi';

vi.mock('@/components/VoiceInput', () => ({ default: () => <button type="button">Voice</button> }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, functions: { invoke: vi.fn() }, rpc: async () => ({}) },
}));
vi.mock('@/hooks/useDeviceInstalledApps', () => ({
  useDeviceInstalledApps: () => ({ installedApps: [], isPackageInstalled: () => true, isAppNameInstalled: () => true }),
}));
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

import PinnedAppsPopup from './PinnedAppsPopup';

const hardwareBack = () => act(async () => { for (const b of [...backs]) b(); });
const voice = () => document.querySelector('[aria-label="Voice"]');
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

// Home's pinned-apps row with the highlight on its first slot.
const renderRow = async () => {
  const onExitFocus = vi.fn();
  render(
    <PinnedAppsPopup
      pinnedApps={[{ id: 'yt', name: 'YouTube', icon: '', packageName: 'com.yt' }]}
      apps={[]}
      isVisible
      isPinned={() => true}
      canPinMore
      focusedIndex={0}
      onLaunchApp={vi.fn()}
      onInstallApp={vi.fn()}
      onPinApp={vi.fn()}
      onReplacePinnedApp={vi.fn()}
      onUnpinApp={vi.fn()}
      onFocusChange={vi.fn()}
      onExitFocus={onExitFocus}
    />,
  );
  await settle();
  return onExitFocus;
};

beforeEach(() => {
  backs.length = 0;
  (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = 0;
});

describe('hardware Back on Home\'s pinned-apps row with the voice overlay over it', () => {
  it.each([
    ['the overlay was listening first', false],
    ['the row was listening first', true],
  ])('closes only the overlay (%s)', async (_, rowFirst) => {
    render(<Host navigate={vi.fn()} />);
    await settle();
    const onExitFocus = await renderRow();
    expect(backs).toHaveLength(2);
    if (rowFirst) backs.reverse();
    await act(async () => { openVoice(); });
    expect(voice()).toBeTruthy();

    await hardwareBack();
    expect(voice()).toBeNull();
    expect(onExitFocus).not.toHaveBeenCalled();

    // The next press leaves the row, as before.
    await new Promise((r) => setTimeout(r, 400));
    await hardwareBack();
    expect(onExitFocus).toHaveBeenCalledTimes(1);
  });
});
