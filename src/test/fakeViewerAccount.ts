// A stand-in for the Supabase client the profiles code talks to, for tests:
// the account's viewer_profiles and viewer_parent_pin kept in memory, with
// what Postgres would do to them — a second insert of a Parent PIN fails as a
// unique violation, an update or delete names the row it last saw
// (updated_at) and matches nothing when the row changed, and updated_at is
// always stamped here (the server), never taken from the box. It can also be
// offline (every request fails) or hang (no request ever answers).
//
//   vi.mock('@/integrations/supabase/client', async () => ({ supabase: (await import('@/test/fakeViewerAccount')).supabase }));
//
// Its state lives on globalThis, so a test that resets modules still sees it.

type Row = Record<string, unknown>;
export interface ParentRow { user_id: string; pin_hash: string; updated_at: string }

export interface FakeAccount {
  profiles: Row[];
  parent: Record<string, ParentRow>;
  /** Every write to viewer_parent_pin, as sent. */
  parentWrites: Array<{ op: string; payload: Row | null; filters: Row }>;
  offline: boolean;
  hang: boolean;
  session: null | { user: { id: string } };
  authCb: null | ((event: string, session: unknown) => void);
  /** profile-pin-reset calls (their bodies), and what verify answers when it isn't ok. */
  invokes: Array<Record<string, unknown>>;
  verifyFails: null | Record<string, unknown>;
  tick: number;
}

const g = globalThis as unknown as { __fakeViewerAccount?: FakeAccount };
export const account: FakeAccount = g.__fakeViewerAccount ??= {
  profiles: [], parent: {}, parentWrites: [], offline: false, hang: false, session: null, authCb: null, invokes: [], verifyFails: null, tick: 0,
};

export function resetAccount(): void {
  Object.assign(account, { profiles: [], parent: {}, parentWrites: [], offline: false, hang: false, session: null, authCb: null, invokes: [], verifyFails: null, tick: 0 });
}

/** The server's clock: later on every write, and nothing like a box's. */
export const stamp = (): string => new Date(Date.UTC(2030, 0, 1) + ++account.tick * 1000).toISOString();

const OFFLINE = { data: null, error: { message: 'TypeError: Failed to fetch', code: '' } };

function from(table: string) {
  const filters: Row = {};
  let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  let payload: Row | null = null;
  const run = (): unknown => {
    if (account.offline) return OFFLINE;
    if (table === 'viewer_profiles') {
      if (op === 'upsert' && payload) {
        account.profiles = [...account.profiles.filter((r) => !(r.user_id === payload!.user_id && r.id === payload!.id)), payload];
        return { data: null, error: null };
      }
      if (op === 'delete') {
        account.profiles = account.profiles.filter((r) => !(r.user_id === filters.user_id && r.id === filters.id));
        return { data: null, error: null };
      }
      return { data: account.profiles.filter((r) => r.user_id === filters.user_id), error: null };
    }
    if (table === 'viewer_parent_pin') {
      const user = String(filters.user_id ?? payload?.user_id ?? '');
      const row = account.parent[user];
      const matches = !!row && (!('updated_at' in filters) || filters.updated_at === row.updated_at);
      if (op !== 'select') account.parentWrites.push({ op, payload, filters: { ...filters } });
      if (op === 'insert') {
        if (row) return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
        account.parent[user] = { user_id: user, pin_hash: String(payload!.pin_hash), updated_at: stamp() };
        return { data: [account.parent[user]], error: null };
      }
      if (op === 'update') {
        if (!matches) return { data: [], error: null };
        account.parent[user] = { ...row, pin_hash: String(payload!.pin_hash), updated_at: stamp() };
        return { data: [account.parent[user]], error: null };
      }
      if (op === 'delete') {
        if (!matches) return { data: [], error: null };
        delete account.parent[user];
        return { data: [row], error: null };
      }
      return { data: row ? [row] : [], error: null };
    }
    return { data: [], error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => { filters[c] = v; return q; },
    like: () => q,
    not: () => q,
    insert: (row: Row) => { op = 'insert'; payload = row; return q; },
    update: (row: Row) => { op = 'update'; payload = row; return q; },
    upsert: (row: Row) => { op = 'upsert'; payload = row; return q; },
    delete: () => { op = 'delete'; return q; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      (account.hang ? new Promise(() => {}) : Promise.resolve(run())).then(res, rej),
  };
  return q;
}

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: account.session } }),
    onAuthStateChange: (cb: (event: string, session: unknown) => void) => { account.authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
  },
  from,
  functions: {
    // profile-pin-reset: a request emails a code; a right code for the Parent
    // PIN puts its new hash on the account (made, or in place of the old one).
    invoke: async (_name: string, opts: { body: Record<string, unknown> }) => {
      const body = opts.body;
      account.invokes.push(body);
      if (account.offline) return { data: null, error: { message: 'Failed to fetch' } };
      if (body.action === 'request') return { data: { ok: true, emailed: true, email: 'ow•••••@example.com' }, error: null };
      if (account.verifyFails) return { data: account.verifyFails, error: null };
      if (body.profile_id === '__parent__') {
        // The caller: the session's user, or 'u1' (what the screen tests sign in as).
        const user = account.session?.user.id ?? 'u1';
        account.parent[user] = { user_id: user, pin_hash: String(body.new_pin_hash), updated_at: stamp() };
        return { data: { ok: true, updated_at: account.parent[user].updated_at }, error: null };
      }
      return { data: { ok: true }, error: null };
    },
  },
};
