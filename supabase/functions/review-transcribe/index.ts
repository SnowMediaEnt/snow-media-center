// review-transcribe: turns a voice review (public.app_reviews.audio_path, in
// the private `review-audio` bucket) into text, once.
//
//   POST { review_id }   with the reviewer's own JWT (verify_jwt = true)
//   → { ok: true, status: 'done' }
//   | { ok: false, reason: unauthorized | bad_request | not_found | no_audio
//                        | already | limit | paused | error }
//
// The box calls this right after it saved a voice review and does not wait
// for it. Rules:
//   * the review must be the caller's own and have a voice note in the
//     caller's own folder ('<user_id>/…');
//   * one transcription per review: the row is claimed by moving
//     transcript_status 'none' → 'pending' in one conditional update, so two
//     calls at once cannot both run;
//   * 10 transcriptions a day per account;
//   * the owner's global AI pause (ai_safety_state, _shared/ai-guard.ts)
//     stops it before anything is claimed, so the review can be transcribed
//     after the pause;
//   * every run is logged in ai_usage_log (feature 'review_stt').
//
// Speech to text uses what the server already has: ElevenLabs Scribe (the
// key elevenlabs-stt uses) when ELEVENLABS_API_KEY is set, otherwise OpenAI
// (OPENAI_API_KEY, as snow-media-ai). No key ever reaches the app.
//
// Logs carry status codes and short reasons only: never the audio, its path
// or a signed URL, a token, or the words of the review.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { checkPause, enforceThreshold } from '../_shared/ai-guard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

export const BUCKET = 'review-audio';
export const PER_USER_DAY = 10;
/** The bucket's own limit; checked again so a bad row can't run up a bill. */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_TRANSCRIPT = 8000;
const STT_TIMEOUT_MS = 45_000;
const DAY_MS = 24 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** USD per second of audio, for the usage log. */
const COST_PER_SEC: Record<string, number> = {
  scribe_v1: 0.40 / 3600,     // ElevenLabs Scribe, ~$0.40 an hour
  'whisper-1': 0.006 / 60,    // OpenAI, $0.006 a minute
};

const MIME_BY_EXT: Record<string, string> = {
  m4a: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', webm: 'audio/webm', ogg: 'audio/ogg',
};

type Admin = ReturnType<typeof createClient>;

interface ReviewRow {
  id: string;
  user_id: string | null;
  audio_path: string | null;
  audio_ms: number | null;
  transcript_status: string;
}

class SttError extends Error {}

async function transcribe(audio: Blob, fileName: string): Promise<{ text: string; model: string }> {
  const eleven = Deno.env.get('ELEVENLABS_API_KEY');
  const openai = Deno.env.get('OPENAI_API_KEY');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STT_TIMEOUT_MS);
  try {
    if (eleven) {
      const fd = new FormData();
      fd.append('file', audio, fileName);
      fd.append('model_id', 'scribe_v1');
      // Laughter, music and the like are not part of a review.
      fd.append('tag_audio_events', 'false');
      const r = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': eleven },
        body: fd,
        signal: ctrl.signal,
      });
      if (!r.ok) throw new SttError(`elevenlabs ${r.status}`);
      const data = await r.json() as { text?: unknown };
      return { text: typeof data.text === 'string' ? data.text : '', model: 'scribe_v1' };
    }
    if (openai) {
      const fd = new FormData();
      fd.append('file', audio, fileName);
      fd.append('model', 'whisper-1');
      fd.append('response_format', 'json');
      const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${openai}` },
        body: fd,
        signal: ctrl.signal,
      });
      if (!r.ok) throw new SttError(`openai ${r.status}`);
      const data = await r.json() as { text?: unknown };
      return { text: typeof data.text === 'string' ? data.text : '', model: 'whisper-1' };
    }
    throw new SttError('no speech-to-text key configured');
  } catch (e) {
    if (e instanceof SttError) throw e;
    throw new SttError((e as Error)?.name === 'AbortError' ? 'timeout' : 'request failed');
  } finally {
    clearTimeout(timer);
  }
}

async function logRun(admin: Admin, p: {
  userId: string; email: string | null; model: string; seconds: number; chars: number; ok: boolean; error?: string;
}) {
  try {
    const cost = Math.round(p.seconds * (COST_PER_SEC[p.model] ?? 0) * 1e6) / 1e6;
    await admin.from('ai_usage_log').insert({
      user_id: p.userId,
      user_email: p.email,
      feature: 'review_stt',
      model: p.model,
      prompt: `Voice review transcription (${p.seconds}s of audio)`,
      response_preview: p.ok ? `${p.chars} characters` : '',
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cost_credits: cost,
      status: p.ok ? 'ok' : 'error',
      error_message: p.ok ? null : (p.error ?? 'failed').slice(0, 200),
    });
  } catch (e) {
    console.error('[review-transcribe] usage log failed:', (e as Error)?.message ?? 'unknown');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ ok: false, reason: 'error' }, 500);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Who is asking. verify_jwt already refused a missing or forged token; this
  // turns it into a user (an anon key has none).
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json({ ok: false, reason: 'unauthorized' }, 401);
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  const user = who?.user;
  if (whoErr || !user) return json({ ok: false, reason: 'unauthorized' }, 401);

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) ?? {}; } catch { /* empty */ }
  const reviewId = typeof body.review_id === 'string' ? body.review_id.trim() : '';
  if (!UUID.test(reviewId)) return json({ ok: false, reason: 'bad_request' }, 400);

  try {
    const { data: row, error: rowErr } = await admin
      .from('app_reviews')
      .select('id, user_id, audio_path, audio_ms, transcript_status')
      .eq('id', reviewId)
      .maybeSingle();
    if (rowErr) {
      console.error('[review-transcribe] read failed:', rowErr.message);
      return json({ ok: false, reason: 'error' }, 500);
    }
    const review = row as ReviewRow | null;
    // Someone else's review looks exactly like a missing one.
    if (!review || review.user_id !== user.id) return json({ ok: false, reason: 'not_found' }, 404);
    const path = review.audio_path ?? '';
    if (!path || !path.startsWith(`${user.id}/`) || path.includes('..')) {
      return json({ ok: false, reason: 'no_audio' }, 400);
    }
    if (review.transcript_status !== 'none') return json({ ok: false, reason: 'already' }, 409);

    // The owner's AI pause: nothing claimed, so it can run after the pause.
    const pause = await checkPause();
    if (pause.blocked) return json({ ok: false, reason: 'paused' }, 503);

    // 10 a day per account: reviews of the last 24 h that were transcribed
    // (or tried). A review is transcribed right after it is sent.
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const { count, error: countErr } = await admin
      .from('app_reviews')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .neq('transcript_status', 'none')
      .gte('created_at', since);
    if (countErr) {
      console.error('[review-transcribe] count failed:', countErr.message);
      return json({ ok: false, reason: 'error' }, 500);
    }
    if ((count ?? 0) >= PER_USER_DAY) return json({ ok: false, reason: 'limit' }, 429);

    // Claim it: only one call gets past this.
    const { data: claimed, error: claimErr } = await admin
      .from('app_reviews')
      .update({ transcript_status: 'pending' })
      .eq('id', reviewId)
      .eq('user_id', user.id)
      .eq('transcript_status', 'none')
      .select('id');
    if (claimErr) {
      console.error('[review-transcribe] claim failed:', claimErr.message);
      return json({ ok: false, reason: 'error' }, 500);
    }
    if (!Array.isArray(claimed) || claimed.length === 0) return json({ ok: false, reason: 'already' }, 409);

    const finish = async (patch: { transcript: string | null; transcript_status: 'done' | 'failed' }) => {
      const { error } = await admin.from('app_reviews').update(patch).eq('id', reviewId);
      if (error) console.error('[review-transcribe] save failed:', error.message);
    };
    const seconds = Math.max(0, Math.round((review.audio_ms ?? 0) / 1000));
    const modelGuess = Deno.env.get('ELEVENLABS_API_KEY') ? 'scribe_v1' : 'whisper-1';

    const { data: file, error: dlErr } = await admin.storage.from(BUCKET).download(path);
    if (dlErr || !file) {
      console.error('[review-transcribe] audio not readable');
      await finish({ transcript: null, transcript_status: 'failed' });
      await logRun(admin, { userId: user.id, email: user.email ?? null, model: modelGuess, seconds, chars: 0, ok: false, error: 'audio not readable' });
      return json({ ok: false, reason: 'error' }, 500);
    }
    if (file.size === 0 || file.size > MAX_AUDIO_BYTES) {
      await finish({ transcript: null, transcript_status: 'failed' });
      await logRun(admin, { userId: user.id, email: user.email ?? null, model: modelGuess, seconds, chars: 0, ok: false, error: 'audio size' });
      return json({ ok: false, reason: 'error' }, 400);
    }

    const ext = (path.split('.').pop() ?? '').toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? (file.type || 'audio/webm');
    const audio = file.type ? file : new Blob([await file.arrayBuffer()], { type: mime });

    try {
      const { text, model } = await transcribe(audio, `review.${MIME_BY_EXT[ext] ? ext : 'webm'}`);
      const clean = text.trim().slice(0, MAX_TRANSCRIPT);
      await finish({ transcript: clean, transcript_status: 'done' });
      await logRun(admin, { userId: user.id, email: user.email ?? null, model, seconds, chars: clean.length, ok: true });
      try { await enforceThreshold(); } catch { /* best effort */ }
      return json({ ok: true, status: 'done' });
    } catch (e) {
      const why = e instanceof SttError ? e.message : 'failed';
      console.error('[review-transcribe] speech to text failed:', why);
      await finish({ transcript: null, transcript_status: 'failed' });
      await logRun(admin, { userId: user.id, email: user.email ?? null, model: modelGuess, seconds, chars: 0, ok: false, error: why });
      return json({ ok: false, reason: 'error' }, 502);
    }
  } catch (e) {
    console.error('[review-transcribe] error:', (e as Error)?.message ?? 'unknown');
    return json({ ok: false, reason: 'error' }, 500);
  }
});
