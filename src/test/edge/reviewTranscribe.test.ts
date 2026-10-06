// review-transcribe: only the reviewer's own voice review, once per review,
// 10 a day per account, stopped by the global AI pause, logged in
// ai_usage_log, and nothing sensitive in the logs.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eqValue, loadEdgeFunction, opArg, userToken, type FakeHandlers, type QueryCall } from './fakeSupabase';

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase } = await import('./fakeSupabase');
  return { createClient: () => fakeSupabase(state.handlers).client };
});

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'viewer@example.com' };
const OTHER = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com' };
const TOKEN = userToken(USER.id);
const REVIEW = '33333333-3333-4333-8333-333333333333';
const PATH = `${USER.id}/${REVIEW}.m4a`;

type Row = Record<string, unknown>;
let reviews: Map<string, Row>;
let paused: boolean;
let doneToday: number;
let usage: Row[];
let audioReadable: boolean;
let sttOk: boolean;
const fetchMock = vi.fn();
let handler: (req: Request) => Promise<Response> | Response;
let env: Record<string, string | undefined>;

function onQuery(q: QueryCall) {
  const ops = q.ops.map((o) => o.op);
  if (q.table === 'ai_safety_state') {
    return { data: { id: 1, paused, pause_reason: paused ? 'Paused by admin' : null, paused_until: null, token_threshold_per_hour: 2_000_000, notify_email: '' } };
  }
  if (q.table === 'ai_usage_log') {
    usage.push(opArg(q, 'insert') as Row);
    return { data: null };
  }
  if (q.table !== 'app_reviews') return undefined;
  const id = eqValue(q, 'id') as string | undefined;
  if (ops.includes('update')) {
    const patch = opArg(q, 'update') as Row;
    const row = id ? reviews.get(id) : undefined;
    const wantStatus = eqValue(q, 'transcript_status');
    const wantUser = eqValue(q, 'user_id');
    const matches = !!row && (wantStatus === undefined || row.transcript_status === wantStatus)
      && (wantUser === undefined || row.user_id === wantUser);
    if (matches) Object.assign(row!, patch);
    return { data: matches ? [{ id }] : [] };
  }
  const selectArgs = q.ops.find((o) => o.op === 'select')?.args ?? [];
  if ((selectArgs[1] as { head?: boolean } | undefined)?.head) return { data: null, count: doneToday };
  if (ops.includes('maybeSingle')) return { data: id ? reviews.get(id) ?? null : null };
  return undefined;
}

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  handler = await loadEdgeFunction('review-transcribe', { ELEVENLABS_API_KEY: 'el-key', OPENAI_API_KEY: 'oa-key' });
  // Each test sets its own keys.
  const deno = (globalThis as unknown as { Deno: { env: { get: (k: string) => string | undefined } } }).Deno;
  deno.env.get = (k: string) => env[k];
});

beforeEach(() => {
  env = { SUPABASE_URL: 'http://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', ELEVENLABS_API_KEY: 'el-key', OPENAI_API_KEY: 'oa-key' };
  reviews = new Map([[REVIEW, { id: REVIEW, user_id: USER.id, audio_path: PATH, audio_ms: 7400, transcript_status: 'none', transcript: null }]]);
  paused = false;
  doneToday = 0;
  usage = [];
  audioReadable = true;
  sttOk = true;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (!sttOk) return new Response('quota', { status: 429 });
    return new Response(JSON.stringify({ text: String(url).includes('elevenlabs') ? '  Love the guide, Plex is fast.  ' : 'From OpenAI.' }));
  });
  state.handlers = {
    userForToken: (t) => (t === TOKEN ? USER : t === userToken(OTHER.id) ? OTHER : null),
    onQuery,
    onDownload: (bucket, path) => (audioReadable && bucket === 'review-audio' && path === PATH
      ? { data: new Blob([new Uint8Array(4000)], { type: 'audio/mp4' }), error: null }
      : { data: null, error: { message: 'not found' } }),
  };
});

afterEach(() => { vi.restoreAllMocks(); });

const post = async (body: Record<string, unknown>, token: string | null = TOKEN) => {
  const res = await handler(new Request('http://fn.test/review-transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const row = () => reviews.get(REVIEW)!;

describe('review-transcribe', () => {
  it('turns the caller’s voice review into text and logs the run', async () => {
    const out = await post({ review_id: REVIEW });
    expect(out).toEqual({ status: 200, body: { ok: true, status: 'done' } });
    expect(row().transcript).toBe('Love the guide, Plex is fast.');
    expect(row().transcript_status).toBe('done');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ user_id: USER.id, feature: 'review_stt', model: 'scribe_v1', status: 'ok' });
    // The usage log holds neither the audio's path nor the review's words.
    expect(JSON.stringify(usage[0])).not.toContain(PATH);
    expect(JSON.stringify(usage[0])).not.toContain('Plex is fast');
  });

  it('transcribes a review once', async () => {
    await post({ review_id: REVIEW });
    const again = await post({ review_id: REVIEW });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe('already');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a caller with no session or someone else’s review', async () => {
    expect((await post({ review_id: REVIEW }, null)).status).toBe(401);
    expect((await post({ review_id: REVIEW }, 'not-a-user')).status).toBe(401);
    const other = await post({ review_id: REVIEW }, userToken(OTHER.id));
    expect(other.status).toBe(404);
    expect(row().transcript_status).toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wants a review id and a voice note in the owner’s folder', async () => {
    expect((await post({ review_id: 'nope' })).status).toBe(400);
    row().audio_path = null;
    expect((await post({ review_id: REVIEW })).body.reason).toBe('no_audio');
    row().audio_path = `${OTHER.id}/${REVIEW}.m4a`;
    expect((await post({ review_id: REVIEW })).body.reason).toBe('no_audio');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops for the global AI pause without using up the review', async () => {
    paused = true;
    const out = await post({ review_id: REVIEW });
    expect(out.status).toBe(503);
    expect(out.body.reason).toBe('paused');
    expect(row().transcript_status).toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows 10 a day per account', async () => {
    doneToday = 10;
    const out = await post({ review_id: REVIEW });
    expect(out.status).toBe(429);
    expect(out.body.reason).toBe('limit');
    expect(row().transcript_status).toBe('none');
    expect(fetchMock).not.toHaveBeenCalled();
    doneToday = 9;
    expect((await post({ review_id: REVIEW })).status).toBe(200);
  });

  it('marks the review failed when speech to text fails, and logs no secrets', async () => {
    sttOk = false;
    const logs: string[] = [];
    const keep = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
    vi.spyOn(console, 'error').mockImplementation(keep);
    vi.spyOn(console, 'log').mockImplementation(keep);
    vi.spyOn(console, 'warn').mockImplementation(keep);
    const out = await post({ review_id: REVIEW });
    expect(out.status).toBe(502);
    expect(row().transcript_status).toBe('failed');
    expect(usage[0]).toMatchObject({ status: 'error', feature: 'review_stt' });
    const all = logs.join('\n');
    expect(all).not.toContain(PATH);
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain('el-key');
  });

  it('marks the review failed when the audio cannot be read', async () => {
    audioReadable = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await post({ review_id: REVIEW });
    expect(out.status).toBe(500);
    expect(row().transcript_status).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses OpenAI when the server has no ElevenLabs key', async () => {
    env.ELEVENLABS_API_KEY = undefined;
    const out = await post({ review_id: REVIEW });
    expect(out.body.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(row().transcript).toBe('From OpenAI.');
    expect(usage[0]).toMatchObject({ model: 'whisper-1' });
  });
});
