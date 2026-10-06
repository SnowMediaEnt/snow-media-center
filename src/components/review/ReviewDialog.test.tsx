// The review screen with the remote: Left/Right sets the stars, OK moves on,
// stars are required, Back = Not now; and what Send sends with and without a
// comment or a voice note.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Upload = { bucket: string; path: string; type?: string };
const sb = vi.hoisted(() => ({
  user: { id: '11111111-1111-4111-8111-111111111111' } as { id: string } | null,
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  uploads: [] as Upload[],
  invokes: [] as Array<{ name: string; body: unknown }>,
  insertError: null as null | { message: string },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: sb.user } }),
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, _blob: Blob, opts: { contentType?: string }) => {
          sb.uploads.push({ bucket, path, type: opts?.contentType });
          return { error: null };
        },
      }),
    },
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => { sb.inserts.push({ table, row }); return { error: sb.insertError }; },
    }),
    functions: {
      invoke: async (name: string, opts: { body: unknown }) => { sb.invokes.push({ name, body: opts.body }); return { data: null, error: null }; },
    },
  },
}));
const events = vi.hoisted(() => [] as Array<{ name: string; props?: Record<string, unknown> }>);
vi.mock('@/lib/analytics', () => ({
  trackEvent: (name: string, _cat?: string, props?: Record<string, unknown>) => { events.push({ name, props }); },
}));
vi.mock('@/hooks/useVersion', () => ({ loadVersion: async () => ({ version: '1.8.1', versionCode: 61 }) }));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));
const mic = vi.hoisted(() => ({ can: false }));
vi.mock('@/lib/supportAttachments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supportAttachments')>()),
  canRecordVoice: () => mic.can,
  startVoiceRecording: async () => ({
    stop: async () => ({ kind: 'audio', blob: new Blob([new Uint8Array(3000)], { type: 'audio/mp4' }), mime: 'audio/mp4', durationMs: 7000 }),
    cancel: () => {},
  }),
}));

import ReviewDialog, { THANKS_MS } from './ReviewDialog';

const focusedId = () => document.activeElement?.getAttribute('data-tv-focus-id');
const press = (key: string, extra: Record<string, unknown> = {}) => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key, ...extra });
};
const ready = async () => { await waitFor(() => expect(focusedId()).toBe('review-stars')); };

beforeEach(() => {
  localStorage.clear();
  sb.user = { id: '11111111-1111-4111-8111-111111111111' };
  sb.inserts.length = 0; sb.uploads.length = 0; sb.invokes.length = 0; sb.insertError = null;
  events.length = 0;
  mic.can = false;
});
afterEach(() => { vi.useRealTimers(); });

describe('ReviewDialog with the remote', () => {
  it('Left/Right sets the stars and OK moves on to the text box', async () => {
    render(<ReviewDialog source="prompt" onClose={() => {}} />);
    await ready();
    press('ArrowRight'); press('ArrowRight'); press('ArrowRight'); press('ArrowRight');
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('4');
    expect(screen.getByText('Very good')).toBeTruthy();
    press('ArrowRight'); press('ArrowRight');
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('5');
    press('ArrowLeft');
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('4');
    expect(focusedId()).toBe('review-stars');
    press('Enter');
    await waitFor(() => expect(focusedId()).toBe('review-text'));
    press('ArrowDown');
    expect(focusedId()).toBe('review-send');
    press('ArrowRight');
    expect(focusedId()).toBe('review-later');
    press('ArrowUp');
    expect(focusedId()).toBe('review-text');
  });

  it('OK on the stars with none chosen asks for a rating', async () => {
    render(<ReviewDialog source="prompt" onClose={() => {}} />);
    await ready();
    press('Enter');
    expect(screen.getByText('Choose a star rating first.')).toBeTruthy();
    expect(focusedId()).toBe('review-stars');
  });

  it('needs stars before it sends', async () => {
    render(<ReviewDialog source="prompt" onClose={() => {}} />);
    await ready();
    fireEvent.click(screen.getByText('Send'));
    expect(screen.getByText('Choose a star rating first.')).toBeTruthy();
    await waitFor(() => expect(focusedId()).toBe('review-stars'));
    expect(sb.inserts).toHaveLength(0);
  });

  it('Back is "Not now"', async () => {
    const onClose = vi.fn();
    render(<ReviewDialog source="prompt" onClose={onClose} />);
    await ready();
    press('Escape');
    expect(onClose).toHaveBeenCalledWith('dismissed');
    expect(events).toEqual([{ name: 'review_dismissed', props: { source: 'prompt', reason: 'back' } }]);
  });

  it('shows no voice button where recording is not possible (Fire TV)', async () => {
    render(<ReviewDialog source="prompt" onClose={() => {}} />);
    await ready();
    expect(screen.queryByText('Record voice')).toBeNull();
  });

  it('offers a support ticket under 1–3 stars, not under 4–5', async () => {
    const onOpenSupport = vi.fn();
    const onClose = vi.fn();
    render(<ReviewDialog source="prompt" onClose={onClose} onOpenSupport={onOpenSupport} />);
    await ready();
    press('ArrowRight'); press('ArrowRight');
    expect(screen.getByText('Need help? Open a support ticket')).toBeTruthy();
    press('ArrowRight'); press('ArrowRight');
    expect(screen.queryByText('Need help? Open a support ticket')).toBeNull();
    press('ArrowLeft'); press('ArrowLeft'); press('ArrowLeft');
    fireEvent.click(screen.getByText('Need help? Open a support ticket'));
    expect(onOpenSupport).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith('dismissed');
    // The line never blocks sending: Send is still there and enabled.
  });
});

describe('sending', () => {
  it('sends stars only, says thank you, then closes', async () => {
    const onClose = vi.fn();
    render(<ReviewDialog source="prompt" onClose={onClose} />);
    await ready();
    press('ArrowRight'); press('ArrowRight'); press('ArrowRight'); press('ArrowRight'); press('ArrowRight');
    fireEvent.click(screen.getByText('Send'));
    await screen.findByText('Thank you!');
    expect(sb.inserts).toHaveLength(1);
    const { table, row } = sb.inserts[0];
    expect(table).toBe('app_reviews');
    expect(row).toMatchObject({ user_id: sb.user!.id, rating: 5, comment: null, audio_path: null, audio_ms: null, app_version: '1.8.1', build: 61, language: 'en' });
    expect(String(row.id)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sb.uploads).toHaveLength(0);
    expect(sb.invokes).toHaveLength(0);
    expect(events).toContainEqual({ name: 'review_submitted', props: { rating: 5, has_text: false, has_voice: false, source: 'prompt' } });
    expect(JSON.parse(localStorage.getItem('smc_review_prompt') || '{}').submitted).toBe(true);
    await waitFor(() => expect(onClose).toHaveBeenCalledWith('sent'), { timeout: THANKS_MS + 1500 });
  });

  it('sends the written review, never in analytics', async () => {
    render(<ReviewDialog source="settings" onClose={() => {}} />);
    await ready();
    press('ArrowRight'); press('ArrowRight'); press('ArrowRight');
    fireEvent.change(screen.getByPlaceholderText('What do you like? What could be better?'), { target: { value: '  The guide is slow at night.  ' } });
    fireEvent.click(screen.getByText('Send'));
    await screen.findByText('Thank you!');
    expect(sb.inserts[0].row).toMatchObject({ rating: 3, comment: 'The guide is slow at night.' });
    const submitted = events.find((e) => e.name === 'review_submitted');
    expect(submitted?.props).toEqual({ rating: 3, has_text: true, has_voice: false, source: 'settings' });
    expect(JSON.stringify(events)).not.toContain('guide is slow');
  });

  it('records, uploads and sends a voice review, then asks for the transcript', async () => {
    mic.can = true;
    render(<ReviewDialog source="prompt" onClose={() => {}} />);
    await ready();
    press('ArrowRight'); press('ArrowRight'); press('ArrowRight'); press('ArrowRight');
    press('Enter');
    await waitFor(() => expect(focusedId()).toBe('review-text'));
    press('ArrowDown');
    expect(focusedId()).toBe('review-voice');
    await act(async () => { press('Enter'); });
    expect(await screen.findByText('Stop')).toBeTruthy();
    await act(async () => { press('Enter'); });
    expect(await screen.findByText('Voice review recorded (0:07)')).toBeTruthy();
    press('ArrowRight');
    expect(focusedId()).toBe('review-voice-remove');
    press('ArrowDown');
    expect(focusedId()).toBe('review-later');
    press('ArrowLeft');
    expect(focusedId()).toBe('review-send');
    await act(async () => { press('Enter'); });
    await screen.findByText('Thank you!');
    const row = sb.inserts[0].row;
    expect(sb.uploads).toEqual([{ bucket: 'review-audio', path: `${sb.user!.id}/${row.id}.m4a`, type: 'audio/mp4' }]);
    expect(row).toMatchObject({ rating: 4, audio_path: `${sb.user!.id}/${row.id}.m4a`, audio_ms: 7000, comment: null });
    expect(sb.invokes).toEqual([{ name: 'review-transcribe', body: { review_id: row.id } }]);
    expect(events.find((e) => e.name === 'review_submitted')?.props).toMatchObject({ has_voice: true, has_text: false });
  });

  it('keeps the screen open with a message when sending fails', async () => {
    sb.insertError = { message: 'boom' };
    const onClose = vi.fn();
    render(<ReviewDialog source="prompt" onClose={onClose} />);
    await ready();
    press('ArrowRight');
    fireEvent.click(screen.getByText('Send'));
    expect(await screen.findByText("Your review couldn't be sent. Check your connection and try again.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('smc_review_prompt') || '{}').submitted).toBeFalsy();
  });
});
