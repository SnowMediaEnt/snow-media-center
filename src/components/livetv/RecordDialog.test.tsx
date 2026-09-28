/**
 * The Record dialog (TRACKER 25): where to save, how long, Start — by remote.
 * It opens from a held OK, so OK does nothing until that press is released.
 * Above Start it says a recording is one more stream on the viewer's line.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extraStreamNote } from '@/lib/recording';

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
