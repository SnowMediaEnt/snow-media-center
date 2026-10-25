// An in-memory public.signin_pins for the sign-in PIN tests, answering the
// queries fakeSupabase records (select / insert / update / delete with eq,
// order, range, maybeSingle, single). It keeps the table's two unique keys
// (line_key, pin_hmac: a clash answers 23505) and the generated line_key.

import type { QueryCall } from './fakeSupabase';

export type StoredPin = {
  id: string;
  panel_hostname: string;
  panel_username: string;
  line_key: string;
  customer_id: string | null;
  pin_hmac: string;
  pin_enc: string;
  source: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  disabled_at: string | null;
  deleted_at: string | null;
  panel_over_at?: string | null;
  last_used_at: string | null;
  use_count: number;
};

type Result = { data?: unknown; error?: unknown };

let seq = 0;
const newId = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

export function pinStore() {
  const rows: StoredPin[] = [];
  const op = (q: QueryCall, name: string) => q.ops.find((o) => o.op === name);
  const matches = (q: QueryCall, r: StoredPin) =>
    q.ops.filter((o) => o.op === 'eq').every((o) => (r as Record<string, unknown>)[o.args[0] as string] === o.args[1])
    && q.ops.filter((o) => o.op === 'is').every((o) => ((r as Record<string, unknown>)[o.args[0] as string] ?? null) === o.args[1]);
  const single = (q: QueryCall) => !!op(q, 'maybeSingle') || !!op(q, 'single');
  const clash = (cand: StoredPin, self?: StoredPin) =>
    rows.some((r) => r !== self && (r.line_key === cand.line_key || r.pin_hmac === cand.pin_hmac));
  const dup = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };

  function answer(q: QueryCall): Result | undefined {
    if (q.table !== 'signin_pins') return undefined;
    const now = new Date().toISOString();
    const ins = op(q, 'insert');
    if (ins) {
      const v = ins.args[0] as Partial<StoredPin>;
      const row: StoredPin = {
        id: newId(), customer_id: null, created_by: null, created_at: now, updated_at: now,
        disabled_at: null, deleted_at: null, panel_over_at: null, last_used_at: null, use_count: 0, ...v,
        line_key: `${v.panel_hostname}:${String(v.panel_username).toLowerCase()}`,
      } as StoredPin;
      if (clash(row)) return dup;
      rows.push(row);
      return { data: single(q) ? { ...row } : [{ ...row }], error: null };
    }
    const upd = op(q, 'update');
    if (upd) {
      const patch = upd.args[0] as Partial<StoredPin>;
      const hit = rows.filter((r) => matches(q, r));
      for (const r of hit) {
        const next = { ...r, ...patch } as StoredPin;
        next.line_key = `${next.panel_hostname}:${next.panel_username.toLowerCase()}`;
        if (clash(next, r)) return dup;
      }
      for (const r of hit) Object.assign(r, patch, { updated_at: now, line_key: `${r.panel_hostname}:${(patch.panel_username ?? r.panel_username).toLowerCase()}` });
      return { data: single(q) ? (hit[0] ? { ...hit[0] } : null) : hit.map((r) => ({ ...r })), error: null };
    }
    if (op(q, 'delete')) {
      for (let i = rows.length - 1; i >= 0; i--) if (matches(q, rows[i])) rows.splice(i, 1);
      return { data: null, error: null };
    }
    let hit = rows.filter((r) => matches(q, r));
    const range = op(q, 'range');
    if (range) hit = hit.slice(range.args[0] as number, (range.args[1] as number) + 1);
    if (single(q)) return { data: hit[0] ? { ...hit[0] } : null, error: null };
    return { data: hit.map((r) => ({ ...r })), error: null };
  }

  return { rows, answer };
}

/** sha256 hex, as requestGuard.hashIp keys a throttle counter. */
export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A base64 32-byte PANEL_CRED_KEY for tests. */
export const TEST_PANEL_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)));

/** Loads one of the shared edge-function modules (path built at run time, so tsc doesn't follow it into Deno code). */
export async function loadShared<T>(file: string): Promise<T> {
  const path = new URL(`../../../supabase/functions/_shared/${file}`, import.meta.url).pathname;
  return (await import(/* @vite-ignore */ path)) as T;
}
