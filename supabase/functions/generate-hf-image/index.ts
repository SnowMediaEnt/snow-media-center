import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

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
    // Verify authentication header exists
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: 'Please sign in to generate images.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Create Supabase client with auth context
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Verify JWT using getUser (validates signature and returns user)
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      console.error('JWT verification failed:', userError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: 'Invalid or expired token. Please sign in again.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    const userId = user.id;
    const userEmail = user.email;
    
    if (!userId) {
      console.error('No user ID in verified claims');
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: 'Invalid token format.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    console.log('Authenticated user:', userId, 'email:', userEmail);

    const { prompt } = await req.json()

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

    // Use Lovable AI Gateway with Gemini for image generation
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-image',
        messages: [
          {
            role: 'user',
            content: `Generate a high quality wallpaper background image: ${prompt}. Ultra detailed, professional wallpaper quality, suitable for desktop background. Safe for work, family-friendly.`
          }
        ],
        modalities: ['image', 'text']
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lovable AI Gateway error:', response.status, errorText);
      throw new Error(`Lovable AI Gateway error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    // Check if the model refused the request (content moderation)
    const messageContent = data.choices?.[0]?.message?.content;
    const imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    
    if (!imageUrl) {
      console.error('No image in response:', JSON.stringify(data));
      
      // Check if it was a content moderation refusal
      if (messageContent && (
        messageContent.toLowerCase().includes('cannot fulfill') ||
        messageContent.toLowerCase().includes('cannot generate') ||
        messageContent.toLowerCase().includes('sorry') ||
        messageContent.toLowerCase().includes('unable to')
      )) {
        return new Response(
          JSON.stringify({ 
            error: 'Content not allowed', 
            details: 'This image prompt was blocked by content moderation. Please try a different prompt without political figures, celebrities, or sensitive content.',
            refusal: messageContent
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }
      
      throw new Error('No image generated in response');
    }

    console.log('Successfully generated image with Lovable AI Gateway for user:', userId);

    return new Response(
      JSON.stringify({ image: imageUrl }),
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
