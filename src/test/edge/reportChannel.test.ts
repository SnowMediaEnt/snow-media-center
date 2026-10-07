// report-channel: a guest's ticket carries the line's username and
// connections (the app's "Line:" line) but never a password, a URL that
// holds one, or a stream path with the login in it.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEdgeFunction, opArg, type QueryCall } from './fakeSupabase';

const state = vi.hoisted(() => ({ queries: [] as QueryCall[] }));
vi.mock('@supabase/supabase-js', async () => {
  const { fakeSupabase } = await import('./fakeSupabase');
  return {
    createClient: () => {
      const { client } = fakeSupabase({
        onQuery: (q) => {
          if (!state.queries.includes(q)) state.queries.push(q);
          if (q.table === 'support_tickets') return { data: { id: 'ticket-1' } };
          if (q.table === 'player_login_throttle') return { data: null };
          return undefined;
        },
      });
      (client.auth.admin as Record<string, unknown>).createUser = async () => ({ data: { user: { id: 'sentinel-user' } }, error: null });
      return client;
    },
  };
});

let handler: (req: Request) => Promise<Response> | Response;
beforeAll(async () => { handler = await loadEdgeFunction('report-channel'); });
beforeEach(() => { state.queries.length = 0; });

const send = async (subject: string, message: string) => {
  const res = await handler(new Request('http://fn.test/report-channel', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.20' }, body: JSON.stringify({ subject, message }),
  }));
  return { status: res.status, body: await res.json() as Record<string, unknown> };
};
const stored = () => {
  const ticket = opArg(state.queries.find((q) => q.table === 'support_tickets')!, 'insert') as { subject: string };
  const msg = opArg(state.queries.find((q) => q.table === 'support_messages')!, 'insert') as { message: string };
  return { subject: ticket.subject, message: msg.message };
};

describe('report-channel', () => {
  it('keeps the line, the service and the connections', async () => {
    const out = await send('[Channel Report] Category down: NFL', 'App: Snow Media Center 1.9.0\nLine: jsmith (DreamStreams) · connections 2/3 · expires 2026-12-01\n\nIssue: Category down');
    expect(out.body.success).toBe(true);
    expect(stored().message).toContain('Line: jsmith (DreamStreams) · connections 2/3 · expires 2026-12-01');
    expect(stored().subject).toBe('[Channel Report] Category down: NFL');
  });

  it('never stores a password, whatever is pasted into a report', async () => {
    await send(
      '[Channel Report] http://jsmith:hunter2@dstreams.xyz:8080/x',
      [
        'Other — it fails at http://dstreams.xyz:8080/player_api.php?username=jsmith&password=hunter2&action=get_live_streams',
        'and http://dstreams.xyz:8080/live/jsmith/hunter2/101.ts',
      ].join('\n'),
    );
    const { subject, message } = stored();
    expect(`${subject}\n${message}`).not.toContain('hunter2');
    expect(message).toContain('password=[removed]');
    expect(message).toContain('/live/jsmith/[removed]/101.ts');
    expect(subject).toContain('http://[removed]@dstreams.xyz');
  });
});
