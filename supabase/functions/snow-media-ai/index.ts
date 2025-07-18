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
    const { message, userId } = await req.json();

    if (!message) {
      throw new Error('Message is required');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // System prompt with Snow Media context and app control functions
    const systemPrompt = `You are Snow Media AI, an intelligent assistant for the Snow Media Center (SMC) Android app. You are knowledgeable about:

SNOW MEDIA KNOWLEDGE:
- Streaming apps, Android TV apps, APKs
- Snow Media tutorials, guides, and content
- App installations, troubleshooting, and setup
- Streaming services, IPTV, media content
- Android TV devices, Fire TV, smart TV setup

APP CONTROL FUNCTIONS:
You can control the SMC app through function calls:
- navigate_to_section: Navigate to different app sections
- find_content: Search for specific content
- open_app: Open installed apps
- manage_settings: Adjust app settings
- show_tutorials: Display relevant tutorials

IMPORTANT: All users are accessing you through the SMC Android app. Provide helpful, concise responses about snow media topics and offer to perform app actions when relevant.

Be friendly, knowledgeable, and always ready to help with both snow media questions and app navigation.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        functions: [
          {
            name: 'navigate_to_section',
            description: 'Navigate user to a specific section of the app',
            parameters: {
              type: 'object',
              properties: {
                section: {
                  type: 'string',
                  enum: ['home', 'apps', 'install-apps', 'media-store', 'videos', 'chat', 'settings', 'credits'],
                  description: 'The app section to navigate to'
                },
                reason: {
                  type: 'string',
                  description: 'Why you are navigating to this section'
                }
              },
              required: ['section', 'reason']
            }
          },
          {
            name: 'find_content',
            description: 'Search for specific content in the app',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'What to search for'
                },
                type: {
                  type: 'string',
                  enum: ['app', 'video', 'tutorial', 'general'],
                  description: 'Type of content to search for'
                }
              },
              required: ['query', 'type']
            }
          },
          {
            name: 'show_credits_info',
            description: 'Show information about user credits and usage',
            parameters: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['balance', 'purchase', 'usage'],
                  description: 'What credit information to show'
                }
              },
              required: ['action']
            }
          }
        ],
        function_call: 'auto',
        temperature: 0.7,
        max_tokens: 500
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('OpenAI API error:', errorData);
      throw new Error('Failed to get AI response');
    }

    const data = await response.json();
    console.log('AI Response:', data);

    const aiMessage = data.choices[0].message;
    let functionCall = null;

    if (aiMessage.function_call) {
      functionCall = {
        name: aiMessage.function_call.name,
        arguments: JSON.parse(aiMessage.function_call.arguments)
      };
    }

    return new Response(JSON.stringify({ 
      message: aiMessage.content,
      functionCall,
      usage: data.usage
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in snow-media-ai function:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      message: "I'm having trouble right now. Please try again in a moment."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});