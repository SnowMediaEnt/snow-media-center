/**
 * Device Health on screen: the slim deep-check note (Fix a problem, My
 * Account), the 30-second check's progress / result, "Run a 30-second check"
 * in Fix a problem, and the check offered in the report dialog (default on,
 * skippable, its id quoted in the ticket).
 */
import { act, fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  deep: null as number | null,
  deepFn: null as null | ((u: number | null) => void),
  allowed: true,
  native: true,
  runs: [] as Array<Record<string, unknown>>,
  finish: null as null | ((r: unknown) => void),
  createTicket: vi.fn(async () => undefined),
}));

vi.mock('@/lib/deviceHealth', () => ({
  deepUntil: () => h.deep,
  subscribeDeep: (fn: (u: number | null) => void) => { h.deepFn = fn; return () => { h.deepFn = null; }; },
  checkAllowedToday: () => h.allowed,
}));
vi.mock('@/lib/deviceCheck', () => ({
  CHECK_SECONDS: 30,
  runDeviceCheck: vi.fn((opts: Record<string, unknown> & { onProgress?: (p: unknown) => void; signal?: AbortSignal }) => {
    h.runs.push(opts);
    opts.onProgress?.({ second: 18, total: 30, stalled: false });
    return new Promise((resolve) => {
      h.finish = resolve;
      opts.signal?.addEventListener('abort', () => resolve(null));
    });
  }),
}));
vi.mock('@/capacitor/SnowPlayer', () => ({ hasNativePlayer: () => h.native }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useSupportTickets', () => ({ useSupportTickets: () => ({ createTicket: h.createTicket }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/usePlayerAccount', () => ({ usePlayerAccount: () => ({ account: null }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: vi.fn(async () => ({ error: null })) } } }));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/appInfo', () => ({ withAppInfo: async (m: string) => m }));
vi.mock('@/utils/keepInView', () => ({ keepInView: () => undefined }));

import { CheckView, DeepCheckNote } from './DeviceHealthParts';
import FixProblemScreen from './FixProblemScreen';
import ReportChannelDialog from './ReportChannelDialog';

const RESULT = {
  verdict: 'server', fine: false, sent: true, id: '6f1c2d3e-0000-4000-8000-000000000001',
  plain: { key: 'deviceHealth.check.verdict.server', params: { internet: '48.0 Mb/s', arrival: '3.0 Mb/s', needed: '6.0 Mb/s' } },
  event: {},
};
const key = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });
const flush = async () => { await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); }); };

beforeEach(() => {
  h.deep = null; h.allowed = true; h.native = true; h.runs = []; h.finish = null; h.createTicket.mockClear();
});

describe('the deep-check note', () => {
  it('nothing without a deep check; one slim line with the date while one is on, live', () => {
    const { container } = render(<DeepCheckNote />);
    expect(container.querySelector('[data-deep-check-note]')).toBeNull();
    act(() => h.deepFn?.(Date.parse('2026-11-04T12:00:00Z')));
    const note = container.querySelector('[data-deep-check-note]') as HTMLElement;
    expect(note.textContent).toMatch(/Snow Media is checking this box until .*2026/);
    expect(note.className).toContain('h-9'); // 36 px, one line
    act(() => h.deepFn?.(null));
    expect(container.querySelector('[data-deep-check-note]')).toBeNull();
  });
  it('shows on Fix a problem when on', () => {
    h.deep = Date.parse('2026-11-04T12:00:00Z');
    render(<FixProblemScreen active onBack={vi.fn()} onOpenBufferingGuide={vi.fn()} />);
    expect(document.querySelector('[data-deep-check-note]')).toBeTruthy();
  });
});

describe('the check view', () => {
  it('running: a slim bar and the seconds', () => {
    const { container } = render(<CheckView progress={{ second: 18, total: 30, stalled: false }} result={null} />);
    expect(container.textContent).toContain('Checking… 18 s');
    expect((container.querySelector('[data-check-bar]') as HTMLElement).style.width).toBe('60%');
  });
  it('done: the plain verdict with the numbers, and "Sent to Snow Media"', () => {
    const { container } = render(<CheckView progress={null} result={RESULT as never} />);
    expect(container.textContent).toContain('Your box is fine and your internet is 48.0 Mb/s, but the stream server only sent 3.0 Mb/s of the 6.0 Mb/s it needs.');
    expect(container.textContent).toContain('Sent to Snow Media.');
  });
});

describe('Fix a problem: Run a 30-second check', () => {
  it('the last row; OK runs it, Back stops it (and stays), the result shows', async () => {
    const onBack = vi.fn();
    render(<FixProblemScreen active onBack={onBack} onOpenBufferingGuide={vi.fn()} onOpenSupportTool={vi.fn()} deviceCheck />);
    const rows = Array.from(document.querySelectorAll('[data-row]')).map((n) => n.getAttribute('data-row'));
    expect(rows).toEqual(['guide', 'speedtest', 'tickets', 'check']);
    expect(document.body.textContent).toContain('Run a 30-second check');
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    key('Enter');
    await flush();
    expect(h.runs).toHaveLength(1);
    expect(document.querySelector('[data-check-view="running"]')?.textContent).toContain('Checking… 18 s');
    key('Escape');
    await flush();
    expect(onBack).not.toHaveBeenCalled();
    expect(document.querySelector('[data-check-view]')).toBeNull();
    key('Enter');
    await flush();
    await act(async () => { h.finish?.(RESULT); });
    await flush();
    expect(document.querySelector('[data-check-view="result"]')?.textContent).toContain('Sent to Snow Media.');
    key('Escape');
    expect(onBack).toHaveBeenCalledTimes(1);
  });
  it('not offered without the flag (no native player)', () => {
    render(<FixProblemScreen active onBack={vi.fn()} onOpenBufferingGuide={vi.fn()} />);
    expect(document.querySelector('[data-row="check"]')).toBeNull();
  });
  it('over the day\'s 6: says it can\'t run', async () => {
    h.allowed = false;
    render(<FixProblemScreen active onBack={vi.fn()} onOpenBufferingGuide={vi.fn()} deviceCheck />);
    act(() => { (document.querySelector('[data-row="check"]') as HTMLElement).click(); });
    await flush();
    expect(document.querySelector('[data-check-view="unavailable"]')).toBeTruthy();
    expect(h.runs).toHaveLength(0);
  });
});

describe('the report dialog offers the check', () => {
  const open = (props: Record<string, unknown> = {}) => {
    const onClose = vi.fn();
    render(<ReportChannelDialog channelName="TNT" channelId={11} categoryName="Sports" initialChoice="Channel down" onClose={onClose} {...props} />);
    fireEvent.keyUp(window, { key: 'Enter' });
    return onClose;
  };

  it('on by default; the report waits for it and quotes its id; the verdict stays until OK', async () => {
    const onClose = open();
    const toggle = document.querySelector('[data-check-toggle]') as HTMLElement;
    expect(toggle.getAttribute('data-check-toggle')).toBe('on');
    expect(toggle.textContent).toContain('Run a 30-second check and send it with your report');
    key('Enter'); // Channel down
    await flush();
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]).toMatchObject({ channel: { streamId: 11, name: 'TNT' }, context: 'live', title: 'TNT' });
    expect(h.createTicket).not.toHaveBeenCalled();
    expect(document.querySelector('[data-check-view="running"]')).toBeTruthy();
    await act(async () => { h.finish?.(RESULT); });
    await flush();
    const message = (h.createTicket.mock.calls[0] as unknown as [string, string])[1];
    expect(message).toContain('Device check: 6f1c2d3e-0000-4000-8000-000000000001');
    expect(document.querySelector('[data-check-view="result"]')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    key('Enter');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switched off: the report goes at once, no check, no id', async () => {
    const onClose = open();
    const n = document.querySelectorAll('[data-howto="report.reasons"] > button').length;
    expect(n).toBe(6); // 4 reasons, the check row, Cancel
    for (let i = 0; i < 4; i += 1) key('ArrowDown');
    key('Enter'); // the check row: off
    expect(document.querySelector('[data-check-toggle]')?.getAttribute('data-check-toggle')).toBe('off');
    key('ArrowUp'); key('ArrowUp'); key('ArrowUp'); key('ArrowUp');
    key('Enter');
    await flush();
    expect(h.runs).toHaveLength(0);
    const message = (h.createTicket.mock.calls[0] as unknown as [string, string])[1];
    expect(message).not.toContain('Device check');
    expect(onClose).toHaveBeenCalled();
  });

  it('Back during the check stops it; the report still goes, without an id', async () => {
    const onClose = open();
    key('Enter');
    await flush();
    key('Escape');
    await flush();
    const message = (h.createTicket.mock.calls[0] as unknown as [string, string])[1];
    expect(message).not.toContain('Device check');
    expect(onClose).toHaveBeenCalled();
  });

  it('not offered without the native player, or for an outside service', () => {
    h.native = false;
    open();
    expect(document.querySelector('[data-check-toggle]')).toBeNull();
  });
});
