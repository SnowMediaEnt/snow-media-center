import { encode as base64Encode } from 'https://deno.land/std@0.168.0/encoding/base64.ts';
import {
  getAdminClient,
  isOwnerEmail,
  resolveCaller,
  isAuthError,
  hashClientIp,
  reserveFree,
  settleFree,
} from '../_shared/ai-guard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Signed-in Gems credit cost (kept from original behavior).
const TTS_COST_PER_1K_CREDITS = 0.10;
// ElevenLabs Flash v2.5 USD rate for free-budget metering (~$0.10 / 1k chars).
const TTS_USD_PER_1K_CHARS = 0.10;
const DEFAULT_VOICE_ID = 'nwHExYD0xaabDwxhumpc';
// An ElevenLabs voice id is 20 letters and digits. Anything else is ignored:
// the id goes into the request path, where '../' or '?' would point the
// owner's key at a different ElevenLabs endpoint. (The app never sends one.)
const VOICE_ID = /^[A-Za-z0-9]{20}$/;

function ttsUsdCost(chars: number): number {
  return Math.max(0, (chars / 1000) * TTS_USD_PER_1K_CHARS);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Track anon reservation for settlement in the outer catch.
  let anonReserved = false;
  let anonReservationSettled = false;
  let anonEstCostUsd = 0;
  let anonActualCostUsd = 0;
  let anonDeviceIdForSettle: string | null = null;
  let anonIpHashForSettle: string | null = null;
  let anonSucceeded = false;
  // Set once a signed-in caller's gems are taken, so a failure after that
  // gives them back.
  let refund: (() => Promise<void>) | null = null;

  try {
    const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
    if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY not configured');

    const { caller, body } = await resolveCaller(req);

    // Fail closed on a real signed-in user with expired/invalid token.
    if (isAuthError(caller)) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', message: 'Your session expired. Please sign in again.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { text, voiceId } = (body ?? {}) as { text?: string; voiceId?: string };
    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'text required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const trimmed = text.slice(0, 4000);
    const vId = typeof voiceId === 'string' && VOICE_ID.test(voiceId) ? voiceId : DEFAULT_VOICE_ID;

    const ipHash = await hashClientIp(req);

    // Anonymous branch: meter against free-AI budget. Owner-flag controlled.
    if (!caller.authed) {
      if (!caller.deviceId) {
        return new Response(
          JSON.stringify({ blocked: true, reason: 'disabled' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      anonEstCostUsd = ttsUsdCost(trimmed.length);
      const gate = await reserveFree({
        deviceId: caller.deviceId,
        ipHash,
        feature: 'chat', // TTS spend bucketed under chat budget
        estCostUsd: anonEstCostUsd,
        estImages: 0,
      });
      if (!gate.allowed) {
        return new Response(
          JSON.stringify({ blocked: true, reason: gate.reason }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      anonReserved = true;
      anonDeviceIdForSettle = caller.deviceId;
      anonIpHashForSettle = ipHash;
    }

    // Signed in: pay first (the owner never pays). update_user_credits
    // answers false, and takes nothing, when the balance is too low; then
    // ElevenLabs is never asked. The app shows `reason` to a signed-in caller.
    let creditCost = 0;
    if (caller.authed && !isOwnerEmail(caller.userEmail)) {
      creditCost = Math.max(0.01, +(((trimmed.length / 1000) * TTS_COST_PER_1K_CREDITS).toFixed(3)));
      const admin = getAdminClient();
      const { data: charged, error: chargeErr } = await admin.rpc('update_user_credits', {
        p_user_id: caller.userId,
        p_amount: creditCost,
        p_transaction_type: 'deduction',
        p_description: `Voice reply (ElevenLabs TTS, ${trimmed.length} chars)`,
      });
      if (chargeErr) {
        console.error('[elevenlabs-tts] charge failed:', chargeErr.message);
        return new Response(JSON.stringify({ error: 'charge_failed' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (charged !== true) {
        return new Response(
          JSON.stringify({
            blocked: true,
            error: 'insufficient_gems',
            needed: creditCost,
            reason: `A voice reply needs ${creditCost} Snow Gems. Top up from the Dashboard.`,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const userId = caller.userId;
      const cost = creditCost;
      let given = false;
      refund = async () => {
        if (given) return;
        given = true;
        try {
          await admin.rpc('update_user_credits', {
            p_user_id: userId,
            p_amount: cost,
            p_transaction_type: 'refund',
            p_description: `Refund — voice reply (ElevenLabs TTS, ${trimmed.length} chars)`,
          });
        } catch (e) {
          console.error('[elevenlabs-tts] refund failed:', e instanceof Error ? e.message : String(e));
        }
      };
    }

    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vId)}?output_format=mp3_44100_128`,
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
      // The catch gives the gems back and releases a free reservation.
      throw new Error(`TTS failed: ${resp.status}`);
    }

    const audioBuffer = await resp.arrayBuffer();
    const audioBase64 = base64Encode(new Uint8Array(audioBuffer));

    if (!caller.authed) {
      anonActualCostUsd = ttsUsdCost(trimmed.length);
      anonSucceeded = true;
    }

    // Settle anonymous reservation before responding.
    if (anonReserved && !anonReservationSettled) {
      anonReservationSettled = true;
      await settleFree({
        deviceId: anonDeviceIdForSettle,
        ipHash: anonIpHashForSettle,
        feature: 'chat',
        estCostUsd: anonEstCostUsd,
        estImages: 0,
        actualCostUsd: anonActualCostUsd,
        actualImages: 0,
        succeeded: anonSucceeded,
      });
    }

    return new Response(JSON.stringify({ audioContent: audioBase64, cost: creditCost }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('TTS error:', e);
    if (refund) await refund();
    // Release any unsettled anon reservation.
    if (anonReserved && !anonReservationSettled) {
      anonReservationSettled = true;
      try {
        await settleFree({
          deviceId: anonDeviceIdForSettle,
          ipHash: anonIpHashForSettle,
          feature: 'chat',
          estCostUsd: anonEstCostUsd,
          estImages: 0,
          actualCostUsd: 0,
          actualImages: 0,
          succeeded: false,
        });
      } catch (settleErr) {
        console.error('[elevenlabs-tts] settle release failed:', settleErr);
      }
    }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
