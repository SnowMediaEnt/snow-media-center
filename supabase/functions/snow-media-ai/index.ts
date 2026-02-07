import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

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
    // Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', message: 'Please sign in to use the AI assistant.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    // Create client with user's auth token
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verify the JWT and get user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    
    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized', message: 'Invalid or expired session. Please sign in again.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = user.id;
    console.log('Authenticated user:', userId);

    const { message } = await req.json();

    if (!message) {
      throw new Error('Message is required');
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Use service role for fetching knowledge documents
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    let knowledgeContext = '';
    try {
      const { data: docs, error } = await supabaseAdmin
        .from('knowledge_documents')
        .select('title, description, content_preview, category')
        .eq('is_active', true)
        .limit(10);
      
      if (!error && docs) {
        knowledgeContext = docs.map(doc => 
          `Title: ${doc.title}\nCategory: ${doc.category}\nDescription: ${doc.description || 'N/A'}\nContent: ${doc.content_preview || 'See full document'}\n---`
        ).join('\n\n');
      }
    } catch (error) {
      console.log('Could not fetch knowledge documents:', error);
    }

    // System prompt with Snow Media context and app control functions
    const systemPrompt = `You are Snow Media AI, an intelligent assistant for the Snow Media Center (SMC) Android app. You are knowledgeable about:

SNOW MEDIA KNOWLEDGE:
- Streaming apps, Android TV apps, APKs
- Snow Media tutorials, guides, and content
- App installations, troubleshooting, and setup
- Streaming services, IPTV, media content
- Android TV devices, Fire TV, smart TV setup

${knowledgeContext ? `\nKNOWLEDGE BASE DOCUMENTS:\n${knowledgeContext}\n` : ''}

APP CONTROL FUNCTIONS:
You can control the SMC app through function calls:
- navigate_to_section: Navigate to different app sections
- find_content: Search for specific content
- open_app: Open installed apps
- manage_settings: Adjust app settings
- show_tutorials: Display relevant tutorials

IMPORTANT: All users are accessing you through the SMC Android app. Provide helpful, concise responses about snow media topics and offer to perform app actions when relevant.

Be friendly, knowledgeable, and always ready to help with both snow media questions and app navigation. Use the knowledge base documents above to provide accurate, up-to-date information.`;

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
                  enum: ['home', 'apps', 'install-apps', 'media', 'store', 'credits', 'support', 'chat', 'settings', 'user'],
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
            name: 'find_support_video',
            description: 'Navigate to support videos and search for specific videos',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'What video to search for (e.g., "dreamstreams install", "streaming setup")'
                },
                app_name: {
                  type: 'string',
                  description: 'Specific app name if mentioned (e.g., "Dreamstreams", "Netflix", "Kodi")'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'change_background',
            description: 'Help user change the app background or theme',
            parameters: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['open_settings', 'suggest_themes', 'upload_custom'],
                  description: 'What background action to take'
                }
              },
              required: ['action']
            }
          },
          {
            name: 'open_store_section',
            description: 'Navigate to store and optionally search for specific items',
            parameters: {
              type: 'object',
              properties: {
                section: {
                  type: 'string',
                  enum: ['credits', 'media', 'apps'],
                  description: 'Which store section to open'
                },
                search_term: {
                  type: 'string',
                  description: 'Optional search term for store items'
                }
              },
              required: ['section']
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
                  enum: ['balance', 'purchase', 'usage', 'history'],
                  description: 'What credit information to show'
                }
              },
              required: ['action']
            }
          },
          {
            name: 'help_with_installation',
            description: 'Guide user through app installation process',
            parameters: {
              type: 'object',
              properties: {
                app_name: {
                  type: 'string',
                  description: 'Name of the app to install'
                },
                device_type: {
                  type: 'string',
                  enum: ['android_tv', 'fire_tv', 'android_phone', 'generic'],
                  description: 'Type of device for installation'
                }
              },
              required: ['app_name']
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
    console.log('AI Response for user', userId, ':', data.usage);

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
      usage: data.usage || { total_tokens: 0 }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in snow-media-ai function:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : String(error),
      message: "I'm having trouble right now. Please try again in a moment."
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
