// snow-media-ai: Premium gems come back when a call fails, a Kids profile is
// never charged, a signed-out 'premium' request never touches the free
// budget, messages are capped, signed-in accounts have an hourly allowance,
// and an automatic pause ends on its own.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eqValue, loadEdgeFunction, opArg, userToken, type FakeHandlers, type RpcCall } from './fakeSupabase';

const state = vi.hoisted(() => ({ handlers: {} as FakeHandlers, rpcs: [] as RpcCall[], updates: [] as Array<{ table: string; value: unknown }> }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase } = await import('./fakeSupabase');
  return {
    createClient: () => {
      const f = fakeSupabase({
        ...state.handlers,
        onRpc: (c) => { state.rpcs.push(c); return state.handlers.onRpc?.(c); },
        onQuery: (q) => {
          const update = opArg(q, 'update');
          if (update !== undefined) state.updates.push({ table: q.table, value: update });
          return state.handlers.onQuery?.(q);
        },
      });
      return f.client;
    },
  };
});

let handler: (req: Request) => Promise<Response> | Response;
const fetchMock = vi.fn();
let openAiOk = true;

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'viewer@example.com' };
const TOKEN = userToken(USER.id);

beforeAll(async () => {
  vi.stubGlobal('fetch', fetchMock);
  handler = await loadEdgeFunction('snow-media-ai', {
    SUPABASE_ANON_KEY: 'anon-key', OPENAI_API_KEY: 'openai-key',
  });
});

let safety: Record<string, unknown>;
let hourlyAllowed: boolean;
let tokensLastHour: number;

beforeEach(() => {
  state.rpcs.length = 0;
  state.updates.length = 0;
  openAiOk = true;
  hourlyAllowed = true;
  tokensLastHour = 10;
  safety = { id: 1, paused: false, pause_reason: null, paused_until: null, token_threshold_per_hour: 2_000_000, notify_email: '' };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).startsWith('https://api.openai.com/')) {
      return openAiOk
        ? new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here you go.' }] }], usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 } }))
        : new Response('upstream error', { status: 500 });
    }
    return new Response('not found', { status: 404 });
  });
  state.handlers = {
    userForToken: (t) => (t === TOKEN ? USER : null),
    onQuery: (q) => {
      if (q.table === 'ai_tiers') {
        const tier = eqValue(q, 'tier');
        return { data: { feature: 'chat', tier, model: tier === 'premium' ? 'top-model' : 'gpt-5.4-nano', gems: tier === 'premium' ? 0.5 : 0, label: String(tier), enabled: true } };
      }
      if (q.table === 'ai_safety_state') return { data: safety };
      return undefined;
    },
    onRpc: (c) => {
      if (c.name === 'update_user_credits') return { data: true };
      if (c.name === 'ai_user_hourly_take') return { data: { allowed: hourlyAllowed } };
      if (c.name === 'ai_tokens_last_hour') return { data: tokensLastHour };
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

const creditCalls = (type: string) => state.rpcs.filter((c) => c.name === 'update_user_credits' && c.args.p_transaction_type === type);
const openAiCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith('https://api.openai.com/'));

describe('snow-media-ai', () => {
  it('charges Premium once and gives the gems back when the model call fails', async () => {
    openAiOk = false;
    const out = await ask({ message: 'what is on tonight', tier: 'premium' });
    expect(out.status).toBe(500);
    expect(creditCalls('deduction')).toHaveLength(1);
    expect(creditCalls('refund')).toHaveLength(1);
    expect(creditCalls('refund')[0].args.p_amount).toBe(0.5);
  });

  it('keeps the gems when Premium answers', async () => {
    const out = await ask({ message: 'hello', tier: 'premium' });
    expect(out.status).toBe(200);
    expect(out.body.charged_gems).toBe(0.5);
    expect(creditCalls('refund')).toHaveLength(0);
  });

  it('never charges a Kids profile, even when Premium is asked for', async () => {
    const out = await ask({ message: 'put on cartoons', tier: 'premium', use_trial: true, kids_level: 'kids' });
    expect(out.status).toBe(200);
    expect(out.body.tier).toBe('free');
    expect(out.body.charged_gems).toBe(0);
    expect(creditCalls('deduction')).toHaveLength(0);
    const body = JSON.parse(String(openAiCalls()[0][1]?.body));
    expect(body.model).toBe('gpt-5.4-nano');
  });

  it('refuses signed-out Premium before touching the free budget', async () => {
    const out = await ask({ message: 'hi', tier: 'premium', device_id: 'device-12345678' }, false);
    expect(out.status).toBe(401);
    expect(out.body.error).toBe('premium_requires_signin');
    expect(state.rpcs.some((c) => c.name === 'reserve_free_ai')).toBe(false);
  });

  it('refuses a message over the cap before anything is spent', async () => {
    const out = await ask({ message: 'x'.repeat(4001), tier: 'premium' });
    expect(out.status).toBe(413);
    expect(state.rpcs).toHaveLength(0);
    expect(openAiCalls()).toHaveLength(0);
  });

  it('keeps the app version short, so it cannot carry what the message cap keeps out', async () => {
    const openAi = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (String(url).endsWith('/smc/update.json')
      ? new Response(JSON.stringify({ version: '1.7.9', downloadUrl: 'https://example.test/smc.apk' }))
      : openAi(url, init)));
    const out = await ask({ message: 'is there an update?', currentVersion: `1.7.8${'x'.repeat(100_000)}` });
    expect(out.status).toBe(200);
    const sent = String(openAiCalls()[0][1]?.body);
    expect(sent).toContain('Installed SMC version: 1.7.8');
    expect(sent).not.toContain('x'.repeat(40));
    expect(sent.length).toBeLessThan(60_000);
  });

  it('stops a signed-in account at its hourly allowance, and counts what a call used', async () => {
    hourlyAllowed = false;
    const blocked = await ask({ message: 'hello' });
    expect(blocked.body.blocked).toBe(true);
    expect(openAiCalls()).toHaveLength(0);

    hourlyAllowed = true;
    await ask({ message: 'hello' });
    const added = state.rpcs.find((c) => c.name === 'ai_user_hourly_add');
    expect(added?.args).toEqual({ p_user_id: USER.id, p_tokens: 1000 });
  });

  it('gives an automatic pause an end', async () => {
    tokensLastHour = 5_000_000;
    const before = Date.now();
    await ask({ message: 'hello' });
    const pause = state.updates.find((u) => u.table === 'ai_safety_state')?.value as { paused?: boolean; paused_until?: string } | undefined;
    expect(pause?.paused).toBe(true);
    const until = Date.parse(String(pause?.paused_until));
    expect(until - before).toBeGreaterThanOrEqual(29 * 60_000);
    expect(until - before).toBeLessThanOrEqual(31 * 60_000);
  });

  describe('app actions', () => {
    const sentTools = (): Array<{ name: string; parameters?: { properties?: Record<string, { enum?: string[] }> } }> =>
      JSON.parse(String(openAiCalls()[0][1]?.body)).tools;
    const sentPrompt = (): string => JSON.parse(String(openAiCalls()[0][1]?.body)).instructions;
    const NEW = ['open_live_tv', 'open_plex', 'open_settings', 'request_plex_title'];

    it('offers the new tools only to a build that says it carries them out', async () => {
      await ask({ message: 'take me to my favorites' });
      expect(sentTools().map((t) => t.name)).not.toEqual(expect.arrayContaining(['open_live_tv']));
      expect(sentPrompt()).not.toContain('request_plex_title');

      fetchMock.mockClear();
      await ask({ message: 'take me to my favorites', app_actions: 2 });
      const names = sentTools().map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining([...NEW, 'open_screen', 'install_app', 'play_channel', 'plex_title']));
      expect(sentPrompt()).toContain('request_plex_title');
      // A request is confirmed with the customer first.
      expect(sentPrompt()).toMatch(/Call it only after they say yes, with confirmed true/);
      const req = sentTools().find((t) => t.name === 'request_plex_title');
      expect(req?.parameters?.properties?.media_type?.enum).toEqual(['movie', 'tv']);
    });

    it('never offers them to a Kids profile, and drops one the model calls anyway', async () => {
      fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('https://api.openai.com/')
        ? new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'open_settings', arguments: '{"page":"my_account"}' }], usage: { total_tokens: 10 } }))
        : new Response('not found', { status: 404 })));
      const out = await ask({ message: 'open the guide', app_actions: 2, kids_level: 'kids' });
      for (const n of NEW) expect(sentTools().map((t) => t.name)).not.toContain(n);
      expect(out.body.functionCall).toBeNull();
    });

    it('passes a function call through to the app', async () => {
      fetchMock.mockImplementation(async (url: string) => (String(url).startsWith('https://api.openai.com/')
        ? new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'open_plex', arguments: '{"place":"discover"}' }], usage: { total_tokens: 10 } }))
        : new Response('not found', { status: 404 })));
      const out = await ask({ message: 'show me something to watch', app_actions: 2 });
      expect(out.body.functionCall).toEqual({ name: 'open_plex', arguments: { place: 'discover' } });
    });

    it('describes the app as it is now (1.9.7), and lists the new tools for voice commands', async () => {
      await ask({ message: 'where is multi screen', app_actions: 2, mode: 'voice_command' });
      const prompt = sentPrompt();
      expect(prompt).toContain('SMC APP GUIDE (version 1.9.7');
      expect(prompt).not.toContain('1.7.3');
      for (const s of ['Sign in with a PIN', 'Devices on this line', 'Snow Originals', 'Still buffering?', 'up to 5 channels', 'Settings › UI › Home screen']) expect(prompt).toContain(s);
      expect(prompt).toMatch(/call exactly ONE function \([^)]*open_live_tv, open_plex, open_settings, request_plex_title\)/);
    });
  });
});
