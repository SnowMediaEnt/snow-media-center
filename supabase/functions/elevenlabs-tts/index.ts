import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TTS_COST_PER_1K = 0.10; // 0.10 credits per ~1000 chars (2x cost)
const DEFAULT_VOICE_ID = 'nwHExYD0xaabDwxhumpc';
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

    const { text, voiceId } = await req.json();
    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'text required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const trimmed = text.slice(0, 4000);

    const vId = voiceId || DEFAULT_VOICE_ID;
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${vId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: trimmed,
          model_id: 'eleven_flash_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.8, use_speaker_boost: true },
        }),
      },
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('ElevenLabs TTS failed:', resp.status, errText);
      return new Response(JSON.stringify({ error: `TTS failed: ${resp.status}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const audioBuffer = await resp.arrayBuffer();
    const audioBase64 = base64Encode(new Uint8Array(audioBuffer));

    const cost = Math.max(0.01, +(((trimmed.length / 1000) * TTS_COST_PER_1K).toFixed(3)));
    const isOwner = user.email?.toLowerCase() === OWNER_EMAIL;
    if (!isOwner) {
      await supabase.rpc('update_user_credits', {
        p_user_id: user.id,
        p_amount: cost,
        p_transaction_type: 'deduction',
        p_description: `Voice reply (ElevenLabs TTS, ${trimmed.length} chars)`,
      });
    }

    return new Response(JSON.stringify({ audioContent: audioBase64, cost: isOwner ? 0 : cost }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('TTS error:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
