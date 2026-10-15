// Service-role Supabase client. This key BYPASSES Row-Level Security, so it
// only ever lives in the server's .env — never in the app, never in git.
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { env } from './config.js';

// supabase-js constructs a Realtime client on init, which needs a global
// WebSocket. Node 20 (this VPS) has none; Node 22+ does. We don't use realtime
// here — just satisfy the constructor so createClient doesn't throw.
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

export const supabase = createClient(
  env.supabaseUrl,
  env.supabaseServiceRoleKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);
