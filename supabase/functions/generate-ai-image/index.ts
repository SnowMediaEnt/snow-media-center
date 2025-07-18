import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    if (!response.ok) {
      const errorData = await response.text();
      console.error('OpenAI API error:', errorData);
      throw new Error(`OpenAI API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    console.log('OpenAI response structure:', {
      hasData: !!data.data,
      dataLength: data.data?.length,
      firstItem: data.data?.[0] ? Object.keys(data.data[0]) : 'no first item',
      fullResponse: JSON.stringify(data, null, 2)
    });

    if (!data.data || !data.data[0]) {
      console.error('Invalid response structure - missing data array or first item:', data);
      throw new Error(`Invalid response format from OpenAI - missing data: ${JSON.stringify(data)}`);
    }

    const firstResult = data.data[0];
    console.log('First result keys:', Object.keys(firstResult));
    console.log('First result content:', JSON.stringify(firstResult, null, 2));
    
    let imageData;
    
    // Handle both URL and base64 response formats
    if (firstResult.b64_json) {
      imageData = `data:image/png;base64,${firstResult.b64_json}`;
    } else if (firstResult.url) {
      // If we get a URL, we need to fetch it and convert to base64
      const imageResponse = await fetch(firstResult.url);
      const imageBuffer = await imageResponse.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
      imageData = `data:image/png;base64,${base64}`;
    } else {
      console.error('No image data found in response:', firstResult);
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
      error: error.message || 'Failed to generate image' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});