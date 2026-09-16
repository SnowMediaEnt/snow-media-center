// Public, read-only delivery for the curated Snow Media trivia bank.
//
// The service-role client can read public.trivia_questions, but the response
// exposes only published gameplay fields. It never queries knowledge_documents
// or the private knowledge-base storage bucket.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

type TriviaRow = {
  slug: string;
  topic: 'devices' | 'service' | 'app' | 'history';
  prompt: string;
  answers: string[];
  correct_index: number;
  fact: string;
  points: number;
  published_at: string | null;
  updated_at: string;
};

const TOPIC_LABEL: Record<TriviaRow['topic'], string> = {
  devices: 'Devices',
  service: 'Service',
  app: 'App',
  history: 'History',
};

const responseHeaders = {
  ...corsHeaders,
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: responseHeaders });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'GET' && request.method !== 'POST') return json({ ok: false }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false }, 503);

  let requestedLimit = 100;
  if (request.method === 'POST') {
    try {
      const body = await request.json() as { limit?: unknown };
      if (typeof body.limit === 'number' && Number.isInteger(body.limit)) requestedLimit = body.limit;
    } catch {
      // An empty or malformed body simply uses the safe default.
    }
  }
  const limit = Math.max(10, Math.min(100, requestedLimit));

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from('trivia_questions')
    .select('slug,topic,prompt,answers,correct_index,fact,points,published_at,updated_at')
    .eq('is_published', true)
    .order('sort_order', { ascending: true })
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.error('[trivia-questions] published read failed:', error.message);
    return json({ ok: false }, 503);
  }

  const rows = (data ?? []) as TriviaRow[];
  const questions = rows
    .filter((row) => (
      typeof row.slug === 'string' &&
      typeof row.prompt === 'string' &&
      typeof row.fact === 'string' &&
      Array.isArray(row.answers) &&
      row.answers.length === 4 &&
      Number.isInteger(row.correct_index) &&
      row.correct_index >= 0 && row.correct_index <= 3 &&
      row.topic in TOPIC_LABEL
    ))
    .map((row) => ({
      id: row.slug,
      topic: row.topic,
      categoryLabel: `Snow Media · ${TOPIC_LABEL[row.topic]}`,
      prompt: row.prompt,
      answers: row.answers,
      correct: row.correct_index,
      fact: row.fact,
      points: Math.max(25, Math.min(500, row.points)),
    }));

  const updatedAt = rows.reduce<string | null>((latest, row) => {
    const candidate = row.updated_at || row.published_at;
    if (!candidate) return latest;
    return !latest || candidate > latest ? candidate : latest;
  }, null);

  return json({ ok: true, questions, updatedAt });
});
