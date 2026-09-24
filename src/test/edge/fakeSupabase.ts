// A stand-in for the service-role Supabase client an edge function creates,
// for tests that load the function file (see vitest.config.ts). Every query
// builder method is recorded and chains; awaiting the builder (or calling
// maybeSingle/single) asks `onQuery` for the result.

export interface QueryCall { table: string; ops: Array<{ op: string; args: unknown[] }> }
export interface RpcCall { name: string; args: Record<string, unknown> }
type Result = { data?: unknown; error?: unknown; count?: number | null };

type FakeUser = { id: string; email?: string | null };

export interface FakeHandlers {
  onQuery?: (q: QueryCall) => Result | undefined;
  onRpc?: (c: RpcCall) => Result | undefined;
  /** The signed-in user a bearer token belongs to (null: not signed in). */
  userForToken?: (token: string) => FakeUser | null;
  /** auth.admin.getUserById */
  userById?: (id: string) => FakeUser | null;
}

export function fakeSupabase(handlers: FakeHandlers = {}) {
  const queries: QueryCall[] = [];
  const rpcs: RpcCall[] = [];
  const answer = (q: QueryCall): Result => ({ data: null, error: null, ...(handlers.onQuery?.(q) ?? {}) });

  const client = {
    from(table: string) {
      const q: QueryCall = { table, ops: [] };
      queries.push(q);
      const builder: Record<string, unknown> = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(answer(q)).then(resolve, reject);
          }
          if (prop === 'maybeSingle' || prop === 'single') {
            return () => {
              q.ops.push({ op: String(prop), args: [] });
              return Promise.resolve(answer(q));
            };
          }
          return (...args: unknown[]) => {
            q.ops.push({ op: String(prop), args });
            return builder;
          };
        },
      });
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      const c = { name, args };
      rpcs.push(c);
      return { data: null, error: null, ...(handlers.onRpc?.(c) ?? {}) };
    },
    auth: {
      async getUser(token?: string) {
        const user = token ? handlers.userForToken?.(token) ?? null : null;
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'no session' } };
      },
      admin: {
        async getUserById(id: string) { return { data: { user: handlers.userById?.(id) ?? null }, error: null }; },
      },
    },
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        download: async () => ({ data: null, error: { message: 'none' } }),
      }),
    },
  };
  return { client, queries, rpcs };
}

/** The value a recorded query was filtered on with .eq(column, value). */
export const eqValue = (q: QueryCall, column: string): unknown =>
  q.ops.find((o) => o.op === 'eq' && o.args[0] === column)?.args[1];

/** The first argument of a recorded builder call (insert, update, ...). */
export const opArg = (q: QueryCall, op: string): unknown => q.ops.find((o) => o.op === op)?.args[0];

type Handler = (req: Request) => Promise<Response> | Response;

/** A bearer token whose payload says role 'authenticated' (the functions
 *  read the role before asking auth.getUser who it is). */
export const userToken = (sub: string): string => {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated' })}.sig`;
};

/**
 * Loads supabase/functions/<name>/index.ts with a fake Deno and returns its
 * handler. The path is built at run time so the app's type check does not
 * follow it into Deno code.
 */
export async function loadEdgeFunction(name: string, env: Record<string, string> = {}): Promise<Handler> {
  const served: { handler: Handler | null } = { handler: null };
  (globalThis as unknown as { Deno: unknown }).Deno = {
    serve: (h: Handler) => { served.handler = h; },
    env: { get: (k: string) => ({ SUPABASE_URL: 'http://supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', ...env })[k] },
  };
  const file = new URL(`../../../supabase/functions/${name}/index.ts`, import.meta.url).pathname;
  await import(/* @vite-ignore */ file);
  if (!served.handler) throw new Error('the function did not call Deno.serve');
  return served.handler;
}
