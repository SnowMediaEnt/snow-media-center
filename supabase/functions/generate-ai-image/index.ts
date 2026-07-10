import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  checkPause,
  logUsage,
  enforceThreshold,
  isOwnerEmail,
  resolveCaller,
  isAuthError,
  hashClientIp,
  reserveFree,
  settleFree,
  storeGeneratedImage,
  DALLE3_HD_1024_COST_USD,
} from '../_shared/ai-guard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Hoisted for outer-catch release on failure.
  let anonReserved = false;
  let anonSettled = false;
  let anonDeviceIdForSettle: string | null = null;
  let anonIpHashForSettle: string | null = null;
  const ANON_EST_COST_USD = DALLE3_HD_1024_COST_USD;

  try {
    const { caller, body } = await resolveCaller(req);

    // Fail closed on auth.
    if (isAuthError(caller)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized', details: 'Your session expired. Please sign in again.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const ipHash = await hashClientIp(req);

    // Force 1024x1024 for anon callers (higher sizes cost more).
    const requestedSize = typeof (body as { size?: unknown }).size === 'string'
      ? (body as { size?: string }).size as string
      : '1024x1024';

    if (!caller.authed) {
      if (!caller.deviceId) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (requestedSize !== '1024x1024') {
        return new Response(
          JSON.stringify({ success: false, error: 'Unsupported size for free tier. Please sign in for HD widescreen.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      const gate = await reserveFree({
        deviceId: caller.deviceId,
        ipHash,
        feature: 'image',
        estCostUsd: ANON_EST_COST_USD,
        estImages: 1,
      });
      if (!gate.allowed) {
        try {
          const denyPrompt = typeof (body as { prompt?: unknown }).prompt === 'string'
            ? ((body as { prompt?: string }).prompt as string)
            : '';
          await logUsage({
            user_id: null,
            user_email: `anon:${caller.deviceId}`,
            feature: 'image',
            prompt: denyPrompt,
            response_preview: '',
            cost_credits: 0,
            status: 'blocked',
            error_message: gate.reason || 'denied',
          });
        } catch (_) { /* swallow */ }
        return new Response(
          JSON.stringify({ blocked: true, reason: gate.reason }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      anonReserved = true;
      anonDeviceIdForSettle = caller.deviceId;
      anonIpHashForSettle = ipHash;
    }

    const userId = caller.authed ? caller.userId : null;
    const userEmail = caller.authed ? caller.userEmail : null;
    const anonDeviceId = caller.authed ? null : caller.deviceId;
    console.log('[generate-ai-image] caller:', caller.authed ? `user:${userId}` : `anon:${anonDeviceId}`);

    if (!isOwnerEmail(userEmail)) {
      const pause = await checkPause();
      if (pause.blocked) {
        try {
          const denyPrompt = typeof (body as { prompt?: unknown }).prompt === 'string'
            ? ((body as { prompt?: string }).prompt as string)
            : '';
          await logUsage({
            user_id: userId,
            user_email: caller.authed ? userEmail : `anon:${anonDeviceId}`,
            feature: 'image',
            prompt: denyPrompt,
            response_preview: '',
            cost_credits: 0,
            status: 'blocked',
            error_message: pause.reason || 'paused',
          });
        } catch (_) { /* swallow */ }
        return new Response(JSON.stringify({ success: false, error: pause.reason }), {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const { prompt } = body as { prompt?: string };
    // Anon: force the cheap size regardless of what was passed.
    const size = caller.authed ? requestedSize : '1024x1024';

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    console.log('Generating image with prompt:', prompt, 'size:', size);

    const enhancedPrompt = `Ultra high resolution background image: ${prompt}. Professional, cinematic quality, suitable for desktop wallpaper.`;

    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: enhancedPrompt,
        n: 1,
        size,
        quality: 'hd',
        response_format: 'b64_json',
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('OpenAI API error:', errorData);
      throw new Error(`OpenAI API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    if (!data?.data || !Array.isArray(data.data) || data.data.length === 0) {
      throw new Error('No image data in OpenAI response');
    }

    const firstResult = data.data[0];
    let imageData: string;
    if (firstResult.b64_json) {
      imageData = `data:image/png;base64,${firstResult.b64_json}`;
    } else if (firstResult.url) {
      const imageResponse = await fetch(firstResult.url);
      const imageBuffer = await imageResponse.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
      imageData = `data:image/png;base64,${base64}`;
    } else {
      throw new Error('No image data found in OpenAI response');
    }

    try {
      await logUsage({
        user_id: userId,
        user_email: caller.authed ? userEmail : `anon:${anonDeviceId}`,
        feature: 'image',
        model: 'dall-e-3',
        prompt,
        response_preview: '[image]',
        total_tokens: 2000,
        cost_credits: isOwnerEmail(userEmail) ? 0 : (caller.authed ? 0.10 : DALLE3_HD_1024_COST_USD),
        status: 'ok',
      });
      await enforceThreshold();
    } catch (e) {
      console.error('[generate-ai-image] log/threshold failed:', e);
    }

    // Settle anon reservation at the TRUE per-image price (no delta).
    if (!caller.authed && anonReserved) {
      await settleFree({
        deviceId: anonDeviceIdForSettle,
        ipHash: anonIpHashForSettle,
        feature: 'image',
        estCostUsd: ANON_EST_COST_USD,
        estImages: 1,
        actualCostUsd: DALLE3_HD_1024_COST_USD,
        actualImages: 1,
        succeeded: true,
      });
      anonSettled = true;
    }

    return new Response(JSON.stringify({
      success: true,
      image: imageData,
      prompt,
      isAdmin: isOwnerEmail(userEmail),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in generate-ai-image function:', error);
    if (anonReserved && !anonSettled) {
      await settleFree({
        deviceId: anonDeviceIdForSettle,
        ipHash: anonIpHashForSettle,
        feature: 'image',
        estCostUsd: ANON_EST_COST_USD,
        estImages: 1,
        actualCostUsd: 0,
        actualImages: 0,
        succeeded: false,
      });
    }
    return new Response(JSON.stringify({
      success: false,
      error: (error instanceof Error ? error.message : String(error)) || 'Failed to generate image',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
