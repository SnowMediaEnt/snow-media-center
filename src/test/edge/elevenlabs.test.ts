// ElevenLabs voice: a signed-in caller pays before ElevenLabs is asked, gets
// the gems back when it fails, and the voice id can't redirect the request.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEdgeFunction, userToken, type FakeHandlers, type RpcCall } from './fakeSupabase';

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers, rpcs: [] as RpcCall[] }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase } = await import('./fakeSupabase');
  return {
    createClient: () => fakeSupabase({
      ...state.handlers,
      onRpc: (c) => { state.rpcs.push(c); return state.handlers.onRpc?.(c); },
    }).client,
  };
});

const USER = { id: '22222222-2222-4222-8222-222222222222', email: 'viewer@example.com' };
const TOKEN = userToken(USER.id);
const fetchMock = vi.fn();
let stt: (req: Request) => Promise<Response> | Response;
let tts: (req: Request) => Promise<Response> | Response;
let enoughGems: boolean;
let elevenOk: boolean;

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  const env = { ELEVENLABS_API_KEY: 'el-key', SUPABASE_ANON_KEY: 'anon-key' };
  stt = await loadEdgeFunction('elevenlabs-stt', env);
  tts = await loadEdgeFunction('elevenlabs-tts', env);
});

beforeEach(() => {
  state.rpcs.length = 0;
  enoughGems = true;
  elevenOk = true;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (!elevenOk) return new Response('quota', { status: 429 });
    return String(url).includes('speech-to-text')
      ? new Response(JSON.stringify({ text: 'put on espn' }))
      : new Response(new Uint8Array([1, 2, 3]));
  });
  state.handlers = {
    userForToken: (t) => (t === TOKEN ? USER : null),
    onRpc: (c) => {
      if (c.name === 'update_user_credits') {
        return { data: c.args.p_transaction_type === 'deduction' ? enoughGems : true };
      }
      if (c.name === 'reserve_free_ai') return { data: { allowed: true, reason: 'ok' } };
      return undefined;
    },
  };
});

const post = async (fn: typeof stt, body: Record<string, unknown>, signedIn = true) => {
  const res = await fn(new Request('http://fn.test/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(signedIn ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const credits = (type: string) => state.rpcs.filter((c) => c.name === 'update_user_credits' && c.args.p_transaction_type === type);

describe('elevenlabs-stt', () => {
  it('does not transcribe for a caller who cannot pay', async () => {
    enoughGems = false;
    const out = await post(stt, { audio: btoa('clip') });
    expect(out.status).toBe(402);
    expect(out.body.error).toBe('insufficient_gems');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives the gems back when ElevenLabs fails', async () => {
    elevenOk = false;
    const out = await post(stt, { audio: btoa('clip') });
    expect(out.status).toBe(500);
    expect(credits('deduction')).toHaveLength(1);
    expect(credits('refund')).toHaveLength(1);
  });

  it('refuses an oversized clip before charging', async () => {
    const out = await post(stt, { audio: 'A'.repeat(2_000_004) });
    expect(out.status).toBe(413);
    expect(credits('deduction')).toHaveLength(0);
  });

  it('transcribes for a caller who paid', async () => {
    const out = await post(stt, { audio: btoa('clip') });
    expect(out.body.text).toBe('put on espn');
    expect(credits('deduction')).toHaveLength(1);
    expect(credits('refund')).toHaveLength(0);
  });
});

describe('elevenlabs-tts', () => {
  it('does not synthesise for a signed-in caller who cannot pay', async () => {
    enoughGems = false;
    const out = await post(tts, { text: 'Hello there' });
    expect(out.body.blocked).toBe(true);
    expect(out.body.error).toBe('insufficient_gems');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives the gems back when ElevenLabs fails', async () => {
    elevenOk = false;
    const out = await post(tts, { text: 'Hello there' });
    expect(out.status).toBe(500);
    expect(credits('refund')).toHaveLength(1);
  });

  it('keeps a caller-sent voice id from pointing the request anywhere else', async () => {
    await post(tts, { text: 'Hi', voiceId: '../sound-generation#' });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/v1/text-to-speech/nwHExYD0xaabDwxhumpc');
    expect(url.search).toBe('?output_format=mp3_44100_128');
  });

  it('still takes a well-formed voice id', async () => {
    await post(tts, { text: 'Hi', voiceId: 'AbCdEfGhIjKlMnOpQrSt' });
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe('/v1/text-to-speech/AbCdEfGhIjKlMnOpQrSt');
  });
});
