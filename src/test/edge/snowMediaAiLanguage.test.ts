// snow-media-ai reply language: the app's chosen language (body.language) wins over what the
// customer typed; without it (an old app build) the message is guessed as before. The sign-in
// refusals come back in the chosen language.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEdgeFunction, userToken, type FakeHandlers } from './fakeSupabase';

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase } = await import('./fakeSupabase');
  return { createClient: () => fakeSupabase(state.handlers).client };
});

let handler: (req: Request) => Promise<Response> | Response;
const fetchMock = vi.fn();

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'viewer@example.com' };
const TOKEN = userToken(USER.id);

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  handler = await loadEdgeFunction('snow-media-ai', { SUPABASE_ANON_KEY: 'anon-key', OPENAI_API_KEY: 'openai-key' });
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('https://api.openai.com/')
    ? new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage: { total_tokens: 10 } }))
    : new Response('not found', { status: 404 })));
  state.handlers = {
    userForToken: (t) => (t === TOKEN ? USER : null),
    onQuery: (q) => {
      if (q.table === 'ai_tiers') return { data: { feature: 'chat', tier: 'free', model: 'gpt-5.4-nano', gems: 0, label: 'free', enabled: true } };
      if (q.table === 'ai_safety_state') return { data: { id: 1, paused: false, pause_reason: null, paused_until: null, token_threshold_per_hour: 2_000_000, notify_email: '' } };
      return undefined;
    },
    onRpc: (c) => {
      if (c.name === 'ai_user_hourly_take') return { data: { allowed: true } };
      if (c.name === 'ai_tokens_last_hour') return { data: 1 };
      if (c.name === 'reserve_free_ai') return { data: { allowed: true, reason: 'ok' } };
      return undefined;
    },
  };
});

const ask = async (body: Record<string, unknown>, signedIn = true) => {
  const res = await handler(new Request('http://fn.test/snow-media-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(signedIn ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};

/** The reply language the prompt asked the model for. */
const promptLanguage = (): string | undefined => {
  const call = fetchMock.mock.calls.find(([u]) => String(u).startsWith('https://api.openai.com/'));
  const sent = JSON.parse(String(call?.[1]?.body)) as { instructions: string };
  return /Your reply language for THIS turn is: (.+?)\./.exec(sent.instructions)?.[1];
};

describe('snow-media-ai language', () => {
  it.each([
    ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ar', 'Arabic (Modern Standard Arabic)'],
  ])('answers in the app language %s', async (language, name) => {
    await ask({ message: 'hello', language });
    expect(promptLanguage()).toBe(name);
  });

  it('uses the chosen language even when the customer typed another', async () => {
    await ask({ message: 'hola, cómo estás', language: 'en' });
    expect(promptLanguage()).toBe('English');
    fetchMock.mockClear();
    await ask({ message: 'what is on tonight', language: 'de' });
    expect(promptLanguage()).toBe('German');
  });

  it('keeps guessing from the message when the app sends no language or one it does not know', async () => {
    await ask({ message: 'hola, quiero ver el partido' });
    expect(promptLanguage()).toBe('Spanish');
    fetchMock.mockClear();
    await ask({ message: 'hello there' });
    expect(promptLanguage()).toBe('English');
    fetchMock.mockClear();
    await ask({ message: 'hola, quiero ver el partido', language: 'pt' });
    expect(promptLanguage()).toBe('Spanish');
    fetchMock.mockClear();
    await ask({ message: 'hola, quiero ver el partido', language: 42 });
    expect(promptLanguage()).toBe('Spanish');
  });

  it('refuses signed-out Premium in the app language, English by default', async () => {
    const es = await ask({ message: 'hi', tier: 'premium', device_id: 'device-12345678', language: 'es' }, false);
    expect(es.status).toBe(401);
    expect(es.body.error).toBe('premium_requires_signin');
    expect(es.body.message).toBe('Inicia sesión para usar la IA Premium.');
    const ar = await ask({ message: 'hi', tier: 'premium', device_id: 'device-12345678', language: 'ar' }, false);
    expect(String(ar.body.message)).toMatch(/[؀-ۿ]/);
    const old = await ask({ message: 'hi', tier: 'premium', device_id: 'device-12345678' }, false);
    expect(old.body.message).toBe('Sign in to use Premium AI.');
  });

  it('asks a caller with no device id to sign in, in the app language', async () => {
    const fr = await ask({ message: 'hi', language: 'fr' }, false);
    expect(fr.status).toBe(401);
    expect(fr.body.message).toBe('Veuillez vous connecter pour utiliser l\'assistant IA.');
    const old = await ask({ message: 'hi' }, false);
    expect(old.body.message).toBe('Please sign in to use the AI assistant.');
  });

  it('says a session expired in the app language', async () => {
    const res = await handler(new Request('http://fn.test/snow-media-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken('22222222-2222-4222-8222-222222222222')}` },
      body: JSON.stringify({ message: 'hi', language: 'de' }),
    }));
    expect(res.status).toBe(401);
    expect((await res.json() as { message: string }).message).toBe('Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.');
  });
});
