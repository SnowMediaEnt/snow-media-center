// Stand-in for https://deno.land/std/http/server.ts in tests: serve() hands
// the handler to the fake Deno.serve (see fakeSupabase.ts).
type Handler = (req: Request) => Promise<Response> | Response;
export function serve(handler: Handler): void {
  (globalThis as unknown as { Deno: { serve: (h: Handler) => void } }).Deno.serve(handler);
}
