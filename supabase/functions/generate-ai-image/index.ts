import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(JSON.stringify({ error: 'Invalid token' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const userId = user.id;
    console.log('Authenticated user:', userId);

    const { prompt, size = '1024x1024' } = await req.json();

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    console.log('Generating image with prompt:', prompt, 'size:', size);

    // Enhanced prompt for better background generation
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
        size: size,
        quality: 'hd',
        response_format: 'b64_json'
      }),
    });

    console.log('OpenAI response status:', response.status);
    console.log('OpenAI response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorData = await response.text();
      console.error('OpenAI API error:', errorData);
      throw new Error(`OpenAI API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    console.log('==== FULL OpenAI RESPONSE ====');
    console.log(JSON.stringify(data, null, 2));
    console.log('==== END RESPONSE ====');

    // Let's be very defensive about parsing the response
    if (!data) {
      console.error('No data received from OpenAI');
      throw new Error('No data received from OpenAI');
    }

    if (!data.data) {
      console.error('Response missing data property:', Object.keys(data));
      throw new Error('Response missing data property');
    }

    if (!Array.isArray(data.data)) {
      console.error('data property is not an array:', typeof data.data);
      throw new Error('data property is not an array');
    }

    if (data.data.length === 0) {
      console.error('data array is empty');
      throw new Error('data array is empty');
    }

    const firstResult = data.data[0];
    console.log('First result keys:', Object.keys(firstResult));

    let imageData;
    
    if (firstResult.b64_json) {
      console.log('Found b64_json data');
      imageData = `data:image/png;base64,${firstResult.b64_json}`;
    } else if (firstResult.url) {
      console.log('Found URL, fetching image:', firstResult.url);
      const imageResponse = await fetch(firstResult.url);
      const imageBuffer = await imageResponse.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
      imageData = `data:image/png;base64,${base64}`;
    } else {
      console.error('No image data found. Available keys:', Object.keys(firstResult));
      throw new Error('No image data found in OpenAI response');
    }

    return new Response(JSON.stringify({ 
      success: true, 
      image: imageData,
      prompt: prompt
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in generate-ai-image function:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: (error instanceof Error ? error.message : String(error)) || 'Failed to generate image' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});