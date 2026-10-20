/**
 * Live TV -> Settings -> "Devices on this line": offered for the line Live TV
 * is signed into, a page beside the menu like the others (its list loads only
 * once the remote goes in), and inert in the demo.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useBillingEnabled', () => ({ useBillingEnabled: () => false }));

const pageProps = vi.hoisted(() => ({} as Record<string, Record<string, unknown>>));
const stub = (name: string) => ({
  default: (p: Record<string, unknown>) => {
    pageProps[name] = p;
    return <div data-testid={`page-${name}`} data-active={p.active ? 'yes' : 'no'} />;
  },
});
vi.mock('./AccountInfoScreen', () => stub('account'));
vi.mock('./SwitchAccountScreen', () => stub('switch'));
vi.mock('./HideCategoriesScreen', () => stub('categories'));
vi.mock('./AppearanceScreen', () => stub('appearance'));
vi.mock('./RewindSettingsScreen', () => stub('rewind'));
vi.mock('./PlaybackScreen', () => stub('playback'));
vi.mock('./LineDevicesPanel', () => stub('devices'));
vi.mock('./OutsideSourceScreen', () => stub('outside'));

import SettingsHub from './SettingsHub';

const LINE = { host: 'http://dstreams.xyz:8080', username: 'jsmith' };
const key = (k: string) => act(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
});
const settle = async (ms = 0) => { await act(async () => { vi.advanceTimersByTime(ms); await Promise.resolve(); await Promise.resolve(); }); };
const shownPage = (c: HTMLElement) => c.querySelector('[data-settings-page]')!;
const menuLabels = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-settings-menu] > div')).map((n) => n.textContent);

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); for (const k of Object.keys(pageProps)) delete pageProps[k]; });
afterEach(() => { vi.useRealTimers(); });

const renderHub = (line: typeof LINE | null) => {
  const props = { onBack: vi.fn(), onSignOut: vi.fn(), onChangeCredentials: vi.fn(), onSwitchAccount: vi.fn(), line };
  return { ...render(<SettingsHub {...props} />), props };
};

describe('Live TV Settings: Devices on this line', () => {
  it('is in the menu, after Switch Account, only with a line signed in', () => {
    const { container, unmount } = renderHub(LINE);
    expect(menuLabels(container)).toEqual([
      'Account Info', 'Switch Account', 'Devices on this line', 'Hide Categories', 'Add another service', 'Appearance', 'Rewind & recording', 'Playback', 'Sign Out',
    ]);
    unmount();
    const { container: none } = renderHub(null);
    expect(menuLabels(none)).not.toContain('Devices on this line');
  });

  it('highlighted, it explains itself; OK opens the line\'s devices beside the menu, with the remote in it; Back returns', async () => {
    const { container, props } = renderHub(LINE);
    await settle();
    key('ArrowDown'); key('ArrowDown');
    await settle(300);
    expect(shownPage(container).getAttribute('data-settings-page')).toBe('devices');
    expect(screen.queryByTestId('page-devices')).toBeNull(); // nothing asked of the server for a passing highlight
    expect(shownPage(container).textContent).toMatch(/a short message to send them/);
    key('Enter');
    await settle();
    expect(await screen.findByTestId('page-devices')).toBeTruthy();
    expect(pageProps.devices).toMatchObject({ host: LINE.host, username: 'jsmith', embedded: true, active: true });
    act(() => { (pageProps.devices.onBack as () => void)(); });
    await settle();
    expect(shownPage(container).getAttribute('data-settings-preview')).toBe('true');
    expect(props.onBack).not.toHaveBeenCalled();
  });
});
