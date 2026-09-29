/**
 * The Record dialog (TRACKER 25): where to save, how long, Start — by remote.
 * It opens from a held OK, so OK does nothing until that press is released.
 * Above Start it says a recording is one more stream on the viewer's line.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extraStreamNote } from '@/lib/recording';
import { clockLabel, conflictMessage, paddedLabel } from '@/lib/recordSchedule';

const { volumes } = vi.hoisted(() => ({
  volumes: {
    value: [
      { id: 'box', label: 'This box', removable: false, freeBytes: 1.5 * 1024 ** 3, totalBytes: 8 * 1024 ** 3 },
      { id: 'ABCD-1234', label: 'USB drive', removable: true, freeBytes: 60 * 1024 ** 3, totalBytes: 64 * 1024 ** 3 },
    ],
  },
}));
vi.mock('@/capacitor/SnowRecorder', () => ({
  SnowRecorder: { getVolumes: async () => ({ volumes: volumes.value }) },
}));

import RecordDialog, { ONE_STREAM_WARNING } from './RecordDialog';

const key = (k: string, extra: Partial<KeyboardEventInit> = {}) => {
  fireEvent.keyDown(window, { key: k, ...extra });
};
const release = () => fireEvent.keyUp(window, { key: 'Enter' });
const focused = () => document.querySelector('[data-record-row][data-focused="true"]')?.getAttribute('data-record-row');

async function open(props: Partial<Parameters<typeof RecordDialog>[0]> = {}) {
  const onStart = vi.fn();
  const onClose = vi.fn();
  const onMore = vi.fn();
  const onStop = vi.fn();
  render(<RecordDialog channelName="CNN HD" onStart={onStart} onClose={onClose} onMore={onMore} onStop={onStop} {...props} />);
  await act(async () => { await Promise.resolve(); });
  return { onStart, onClose, onMore, onStop };
}

describe('Record dialog', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('ignores the OK that opened it, then records 1 hour on the box by default', async () => {
    const { onStart } = await open();
    expect(screen.getByText('Record CNN HD')).toBeTruthy();
    key('ArrowDown'); key('ArrowDown');
    expect(focused()).toBe('start');
    key('Enter'); // still the held press
    expect(onStart).not.toHaveBeenCalled();
    release();
    key('Enter');
    expect(onStart).toHaveBeenCalledWith({ volumeId: 'box', durationMin: 60 });
  });

  it('warns when the drive has less than 2 GB free', async () => {
    await open();
    expect(screen.getByText(/Less than 2 GB free/)).toBeTruthy();
    // The USB drive has room: the warning goes.
    key('ArrowRight');
    expect(screen.queryByText(/Less than 2 GB free/)).toBeNull();
  });

  it('USB drive, until I stop it', async () => {
    const { onStart } = await open();
    release();
    key('ArrowRight'); // Save to: USB drive
    key('ArrowDown'); // How long
    for (let i = 0; i < 6; i++) key('ArrowRight'); // to the last choice
    key('ArrowDown');
    expect(focused()).toBe('start');
    key('Enter');
    expect(onStart).toHaveBeenCalledWith({ volumeId: 'ABCD-1234', durationMin: 0 });
  });

  it('custom length in 15-minute steps', async () => {
    const { onStart } = await open();
    release();
    key('ArrowDown');
    key('ArrowRight'); key('ArrowRight'); key('ArrowRight'); // 2 h, 3 h, Custom
    key('ArrowDown');
    expect(focused()).toBe('custom');
    expect(screen.getByText(/1 h 30 min/)).toBeTruthy();
    key('ArrowRight'); key('ArrowRight');
    expect(screen.getByText(/2 h/, { selector: 'span.font-quicksand' })).toBeTruthy();
    key('ArrowDown');
    key('Enter');
    expect(onStart).toHaveBeenCalledWith({ volumeId: 'box', durationMin: 120 });
  });

  it('Back closes; More options hands over to the channel menu', async () => {
    const { onClose, onMore } = await open();
    release();
    for (let i = 0; i < 3; i++) key('ArrowDown');
    expect(focused()).toBe('more');
    expect(screen.getByText('More options…')).toBeTruthy();
    key('Enter');
    expect(onMore).toHaveBeenCalled();
    key('Escape');
    expect(onClose).toHaveBeenCalled();
  });

  it('a channel already recording offers Stop', async () => {
    const { onStop, onStart } = await open({
      activeJob: { id: 'job-1', channel: 'CNN HD', name: 'CNN HD – x', startedAt: Date.now() - 60_000, endsAt: 0, bytes: 5 * 1024 * 1024 },
    });
    expect(screen.getByText('Recording CNN HD')).toBeTruthy();
    release();
    expect(focused()).toBe('stop');
    key('Enter');
    expect(onStop).toHaveBeenCalledWith('job-1');
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe('the extra-stream notice', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const note = () => document.querySelector('[data-record-note]');
  const startRow = () => document.querySelector('[data-record-row="start"]');

  it('sits above Start and says how many streams the plan allows', async () => {
    await open({ maxConnections: 2 });
    expect(note()?.textContent).toBe(extraStreamNote(2));
    expect(note()?.textContent).toBe('Recording uses one more stream on your line (your plan allows 2 at once).');
    // Above Start in the dialog, so it is read before the button.
    expect(note()!.compareDocumentPosition(startRow()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('without a known plan it still says a recording is one more stream', async () => {
    await open({ maxConnections: null });
    expect(note()?.textContent).toBe('Recording uses one more stream on your line.');
  });

  it('on a one-stream plan it warns that watching may stop the picture or the recording', async () => {
    await open({ maxConnections: 1 });
    expect(note()?.textContent).toContain('your plan allows 1 at once');
    expect(note()?.textContent).toContain(ONE_STREAM_WARNING);
  });

  it('a plan with more streams does not carry the one-stream warning', async () => {
    await open({ maxConnections: 3 });
    expect(note()?.textContent).not.toContain(ONE_STREAM_WARNING);
  });

  it('a channel already recording (Stop) has nothing to start, so no notice', async () => {
    await open({
      maxConnections: 2,
      activeJob: { id: 'job-1', channel: 'CNN HD', name: 'CNN HD – x', startedAt: Date.now() - 60_000, endsAt: 0, bytes: 0 },
    });
    expect(note()).toBeNull();
  });
});

describe('the "This programme" length chip (Live TV)', () => {
  beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

  const chips = () => Array.from(document.querySelectorAll('[data-record-row="dur"] span')).map((n) => n.textContent);
  const selectedChip = () => Array.from(document.querySelectorAll('[data-record-row="dur"] span')).find((n) => n.className.includes('font-semibold') || n.className.includes('font-bold'))?.textContent;

  it('is the first choice when the programme on now has an end, and runs to its end plus the late padding', async () => {
    const end = Date.now() + 40 * 60_000;
    const { onStart } = await open({ programme: { title: 'The News', endMs: end }, padding: { beforeMin: 2, afterMin: 5 } });
    const until = clockLabel(end + 5 * 60_000);
    expect(chips()[0]).toBe(`This programme (until ${until})`);
    expect(chips()).toHaveLength(7);
    // Still 1 hour by default; the chip is one ◀ away from the first ordinary choice.
    expect(selectedChip()).toBe('1 hour');
    release();
    key('ArrowDown'); // How long
    key('ArrowLeft'); key('ArrowLeft'); key('ArrowLeft'); // 30 min, then the chip
    expect(selectedChip()).toContain('This programme');
    key('ArrowDown');
    expect(document.querySelector('[data-record-row="start"]')?.textContent).toContain(`until ${until}`);
    key('Enter');
    const call = onStart.mock.calls[0][0];
    expect(call.volumeId).toBe('box');
    // Whole minutes from now to that end: 45, give or take the test's own time.
    expect(call.durationMin).toBeGreaterThanOrEqual(45);
    expect(call.durationMin).toBeLessThanOrEqual(46);
  });

  it('is not offered without a programme, or one that has finished', async () => {
    await open();
    expect(chips()).toHaveLength(6);
    document.body.innerHTML = '';
    await open({ programme: { title: 'Old', endMs: Date.now() - 60_000 } });
    expect(chips()).toHaveLength(6);
  });

  it('arriving after the dialog opened does not move the viewer off the length they were on', async () => {
    const onStart = vi.fn();
    const r = render(<RecordDialog channelName="CNN HD" onStart={onStart} onClose={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    release();
    key('ArrowDown'); key('ArrowRight'); // 2 hours
    expect(selectedChip()).toBe('2 hours');
    r.rerender(<RecordDialog channelName="CNN HD" onStart={onStart} onClose={vi.fn()} programme={{ title: 'X', endMs: Date.now() + 30 * 60_000 }} />);
    expect(chips()[0]).toContain('This programme');
    expect(selectedChip()).toBe('2 hours');
  });
});

describe('programme mode (the Guide)', () => {
  beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

  const pad = { beforeMin: 2, afterMin: 5 };
  const t0 = Date.now();
  const at = (min: number) => t0 + min * 60_000;
  const later = { title: 'The News', startMs: at(60), endMs: at(120) };
  const after = { title: 'Late Film', startMs: at(120), endMs: at(210), scheduled: true };
  const onNow = { title: 'Morning Show', startMs: at(-30), endMs: at(30) };
  const rowsText = () => Array.from(document.querySelectorAll('[data-record-programme]')).map((n) => n.textContent);
  const sched = (id: string, streamId: number, s: number, e: number) => ({
    id, streamId, startUtcMs: at(s), endUtcMs: at(e), padBeforeMin: 0, padAfterMin: 0, status: 'scheduled',
  });
  const startText = () => document.querySelector('[data-record-row="start"]')?.textContent ?? '';

  it('lists the programmes with their times, marks a scheduled one, and shows the padded times on the button', async () => {
    await open({ programmes: [later, after], streamId: 7, padding: pad, maxConnections: 2 });
    expect(screen.getByText('Record a programme on CNN HD')).toBeTruthy();
    expect(rowsText()).toEqual([
      `${clockLabel(later.startMs)}\u2013${clockLabel(later.endMs)}The News`,
      `${clockLabel(after.startMs)}\u2013${clockLabel(after.endMs)}Late Film`,
    ]);
    expect(document.querySelectorAll('[aria-label="Already scheduled"]')).toHaveLength(1);
    expect(focused()).toBe('what');
    expect(startText()).toContain('Record this programme');
    expect(startText()).toContain(paddedLabel(later.startMs - 2 * 60_000, later.endMs + 5 * 60_000));
    // No length row, no "more options" in this mode.
    expect(document.querySelector('[data-record-row="dur"]')).toBeNull();
    expect(document.querySelector('[data-record-row="more"]')).toBeNull();
  });

  it('shows the same extra-stream line as Record now, with the one-stream warning', async () => {
    await open({ programmes: [later], streamId: 7, padding: pad, maxConnections: 1 });
    const note = document.querySelector('[data-record-note]')?.textContent;
    expect(note).toContain(extraStreamNote(1));
    expect(note).toContain(ONE_STREAM_WARNING);
    expect(note).toContain('your plan allows 1 at once');
  });

  it('◀▶ picks the programme and the button follows; OK on Start hands it over with the drive', async () => {
    const { onStart } = await open({ programmes: [later, after], streamId: 7, padding: pad, maxConnections: 2 });
    release();
    key('ArrowRight');
    expect(startText()).toContain(paddedLabel(after.startMs - 2 * 60_000, after.endMs + 5 * 60_000));
    key('ArrowDown'); key('ArrowDown');
    expect(focused()).toBe('start');
    key('Enter');
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0][0]).toMatchObject({ volumeId: 'box', programme: after });
  });

  it('one that is on now says so, and starts from now', async () => {
    const { onStart } = await open({ programmes: [onNow], streamId: 7, padding: pad, maxConnections: 2 });
    release();
    expect(startText()).toContain(`now \u2192 ${clockLabel(onNow.endMs + 5 * 60_000)}`);
    key('ArrowDown'); key('ArrowDown'); key('Enter');
    const c = onStart.mock.calls[0][0];
    // 30 min to the end + 5 late, rounded up.
    expect(c.durationMin).toBeGreaterThanOrEqual(35);
    expect(c.durationMin).toBeLessThanOrEqual(36);
  });

  it('refuses with a message when more recordings than the plan allows would overlap', async () => {
    const { onStart } = await open({
      programmes: [later], streamId: 7, padding: pad, maxConnections: 2,
      existing: [sched('a', 1, 55, 130), sched('b', 2, 58, 125)],
    });
    release();
    const msg = (document.querySelector('[data-record-conflict]')?.textContent ?? '').trim();
    expect(msg).toBe(conflictMessage({ atMs: later.startMs - 2 * 60_000, count: 2 }));
    expect(msg).toMatch(/^You already have 2 recordings at \d{1,2}:\d\d\s[AP]M\. Cancel one first\.$/);
    expect(document.querySelector('[data-record-row="start"]')?.getAttribute('data-disabled')).toBe('true');
    key('ArrowDown'); key('ArrowDown'); key('Enter');
    expect(onStart).not.toHaveBeenCalled();
  });

  it('the plan sets the limit: one stream allows only one, back to back on the same channel is fine', async () => {
    await open({ programmes: [later], streamId: 7, padding: pad, maxConnections: 1, existing: [sched('a', 1, 55, 130)] });
    expect(document.querySelector('[data-record-conflict]')?.textContent?.trim()).toMatch(/You already have 1 recording at/);
    document.body.innerHTML = '';
    // The previous programme of the same channel joins this one: still one stream.
    await open({ programmes: [later], streamId: 7, padding: pad, maxConnections: 1, existing: [sched('a', 7, 0, 60)] });
    expect(document.querySelector('[data-record-conflict]')).toBeNull();
  });

  it('warns when the drive cannot hold it (about 2.5 GB an hour), and still lets it go ahead', async () => {
    const { onStart } = await open({ programmes: [later], streamId: 7, padding: pad, maxConnections: 2 });
    release();
    // The box has 1.5 GB free and keeps 1 GB: a 67 minute recording (about 2.8 GB) will not fit.
    expect(document.querySelector('[data-record-space]')?.textContent?.trim()).toMatch(/^Not enough free space for about 1 h 07/);
    key('ArrowDown'); key('ArrowDown'); key('Enter');
    expect(onStart).toHaveBeenCalledTimes(1);
    // The USB drive has room: the warning goes.
    key('ArrowUp'); key('ArrowRight');
    expect(document.querySelector('[data-record-space]')).toBeNull();
  });

  it('a programme that has finished cannot be recorded', async () => {
    const over = { title: 'Gone', startMs: at(-120), endMs: at(-60) };
    const { onStart } = await open({ programmes: [over], streamId: 7, padding: pad });
    release();
    expect(document.querySelector('[data-record-over]')?.textContent).toContain('finished');
    key('ArrowDown'); key('ArrowDown'); key('Enter');
    expect(onStart).not.toHaveBeenCalled();
  });

  it('with no listings it says so and cannot start; Back closes', async () => {
    const { onStart, onClose } = await open({ programmes: [], streamId: 7, padding: pad });
    release();
    expect(screen.getByText(/No programme listings/)).toBeTruthy();
    key('ArrowDown'); key('ArrowDown'); key('Enter');
    expect(onStart).not.toHaveBeenCalled();
    key('Escape');
    expect(onClose).toHaveBeenCalled();
  });
});
