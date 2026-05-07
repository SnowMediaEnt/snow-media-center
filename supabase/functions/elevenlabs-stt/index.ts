import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STT_COST = 0.02;
const OWNER_EMAIL = 'joshua.perez@snowmediaent.com';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
    if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { audio, mimeType } = await req.json();
    if (!audio) return new Response(JSON.stringify({ error: 'audio required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Decode base64 -> bytes
    const binary = atob(audio);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType || 'audio/webm' });

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
      return new Response(JSON.stringify({ error: `STT failed: ${resp.status}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const data = await resp.json();
    const text = data.text || '';

    // Deduct credits (skip owner)
    const isOwner = user.email?.toLowerCase() === OWNER_EMAIL;
    if (!isOwner) {
      await supabase.rpc('update_user_credits', {
        p_user_id: user.id,
        p_amount: STT_COST,
        p_transaction_type: 'deduction',
        p_description: 'Voice input (ElevenLabs STT)',
      });
    }

    return new Response(JSON.stringify({ text, cost: isOwner ? 0 : STT_COST }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('STT error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
