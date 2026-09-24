import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STT_COST = 0.04; // 2x cost (charge double)
const OWNER_EMAIL = 'joshua.perez@snowmediaent.com';
// ElevenLabs bills by audio length while this charges a flat STT_COST, so the
// clip size is capped. The app records at most 12 seconds, far below this.
const MAX_AUDIO_BASE64_CHARS = 2_000_000;

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Set once the gems are taken, so a failure after that gives them back.
  let refund: (() => Promise<void>) | null = null;

  try {
    const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
    if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Unauthorized' }, 401);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

    const { audio, mimeType } = await req.json();
    if (!audio || typeof audio !== 'string') return jsonResponse({ error: 'audio required' }, 400);
    if (audio.length > MAX_AUDIO_BASE64_CHARS) return jsonResponse({ error: 'audio_too_large' }, 413);

    // Decode base64 -> bytes
    const binary = atob(audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: typeof mimeType === 'string' && mimeType ? mimeType : 'audio/webm' });

    // Pay first (skip owner). update_user_credits answers false, and takes
    // nothing, when the balance is too low: then ElevenLabs is never asked.
    const isOwner = user.email?.toLowerCase() === OWNER_EMAIL;
    if (!isOwner) {
      const { data: charged, error: chargeErr } = await supabase.rpc('update_user_credits', {
        p_user_id: user.id,
        p_amount: STT_COST,
        p_transaction_type: 'deduction',
        p_description: 'Voice input (ElevenLabs STT)',
      });
      if (chargeErr) {
        console.error('STT charge failed:', chargeErr.message);
        return jsonResponse({ error: 'charge_failed' }, 500);
      }
      if (charged !== true) {
        return jsonResponse({
          error: 'insufficient_gems',
          needed: STT_COST,
          message: `Voice input needs ${STT_COST} Snow Gems. Top up from the Dashboard.`,
        }, 402);
      }
      let given = false;
      refund = async () => {
        if (given) return;
        given = true;
        try {
          await supabase.rpc('update_user_credits', {
            p_user_id: user.id,
            p_amount: STT_COST,
            p_transaction_type: 'refund',
            p_description: 'Refund — voice input (ElevenLabs STT)',
          });
        } catch (e) {
          console.error('STT refund failed:', e instanceof Error ? e.message : String(e));
        }
      };
    }

    const fd = new FormData();
    fd.append('file', blob, 'audio.webm');
    fd.append('model_id', 'scribe_v1');

    const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': ELEVENLABS_API_KEY },
      body: fd,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('ElevenLabs STT failed:', resp.status, errText);
      if (refund) await refund();
      return jsonResponse({ error: `STT failed: ${resp.status}` }, 500);
    }

    const data = await resp.json();
    const text = data.text || '';

    return jsonResponse({ text, cost: isOwner ? 0 : STT_COST });
  } catch (e) {
    console.error('STT error:', e);
    if (refund) await refund();
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});
