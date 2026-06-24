import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import {
  checkPause,
  logUsage,
  enforceThreshold,
  isOwnerEmail,
  resolveCaller,
  freeAllowed,
  recordFree,
  ANON_IMAGE_COST_USD,
} from '../_shared/ai-guard.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { caller, body } = await resolveCaller(req);

    if (!caller.authed) {
      if (!caller.deviceId) {
        return new Response(
          JSON.stringify({ error: 'Unauthorized', details: 'Please sign in to generate images.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
        );
      }
      const gate = await freeAllowed(caller.deviceId, 'image');
      if (!gate.allowed) {
        return new Response(
          JSON.stringify({ blocked: true, reason: gate.reason }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    const userId = caller.authed ? caller.userId : null;
    const userEmail = caller.authed ? caller.userEmail : null;
    const anonDeviceId = caller.authed ? null : caller.deviceId;
    console.log('[generate-hf-image] caller:', caller.authed ? `user:${userId}` : `anon:${anonDeviceId}`);

    // Safety pause check (admins bypass)
    if (!isOwnerEmail(userEmail)) {
      const pause = await checkPause();
      if (pause.blocked) {
        return new Response(
          JSON.stringify({ error: 'AI temporarily paused', details: pause.reason }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const { prompt } = body as { prompt?: string };

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: 'Prompt is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }


    console.log(`Generating image with Lovable AI Gateway (Gemini), prompt:`, prompt)

    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY is not set')
    }

    // Use Lovable AI Gateway for image generation, with automatic fallback
    // between models so a single bad model day doesn't break the feature.
    const MODELS = [
      'google/gemini-2.5-flash-image',
      'google/gemini-3.1-flash-image-preview', // nano banana 2 fallback
    ];

    let imageUrl: string | undefined;
    let lastErrorStatus = 0;
    let lastErrorBody = '';
    let lastRefusal: string | undefined;
    let usedModel = MODELS[0];

    for (const model of MODELS) {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          modalities: ['image', 'text'],
        }),
      });

      if (!response.ok) {
        lastErrorStatus = response.status;
        lastErrorBody = await response.text();
        console.error(`[generate-hf-image] gateway error (${model}):`, response.status, lastErrorBody);
        // 402/429 are global — bailing out early is correct.
        if (response.status === 429 || response.status === 402) break;
        continue;
      }

      const data = await response.json();
      const candidate = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      lastRefusal = data.choices?.[0]?.message?.content;
      if (candidate) {
        imageUrl = candidate;
        usedModel = model;
        break;
      }
      console.warn(`[generate-hf-image] no image from ${model}, trying next. refusal:`, lastRefusal);
    }

    if (!imageUrl) {
      if (lastErrorStatus === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limited', details: 'Too many image requests. Please wait a moment and try again.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (lastErrorStatus === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted', details: 'The AI image service is out of credits. Please contact the admin.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const details = lastRefusal
        || (lastErrorBody ? `Gateway ${lastErrorStatus}: ${lastErrorBody.slice(0, 300)}` : 'The image generator did not return an image. Try rephrasing your prompt.');
      try {
        await logUsage({
          user_id: userId, user_email: userEmail, feature: 'image',
          model: usedModel, prompt, response_preview: '', total_tokens: 0,
          cost_credits: 0, status: 'error', error_message: details.slice(0, 500),
        });
      } catch (_) { /* swallow */ }
      return new Response(
        JSON.stringify({ error: 'Image generation failed', details, refusal: lastRefusal }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    console.log(`[generate-hf-image] success via ${usedModel} for user:`, userId);

    try {
      await logUsage({
        user_id: userId,
        user_email: userEmail,
        feature: 'image',
        model: usedModel,
        prompt,
        response_preview: imageUrl.slice(0, 200),
        total_tokens: 1500, // approximate per-image budget for threshold accounting
        cost_credits: isOwnerEmail(userEmail) ? 0 : 0.10,
        status: 'ok',
      });
      await enforceThreshold();
    } catch (e) {
      console.error('[generate-hf-image] log/threshold failed:', e);
    }

    return new Response(
      JSON.stringify({ image: imageUrl, isAdmin: isOwnerEmail(userEmail) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in generate-hf-image function:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to generate image', details: error instanceof Error ? error.message : String(error) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
