import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { checkPause, logUsage, enforceThreshold, isOwnerEmail } from '../_shared/ai-guard.ts';

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
    const userEmail = user.email ?? null;
    console.log('Authenticated user:', userId);

    // Safety pause check (admins bypass)
    if (!isOwnerEmail(userEmail)) {
      const pause = await checkPause();
      if (pause.blocked) {
        return new Response(
          JSON.stringify({ error: 'AI temporarily paused', message: pause.reason }),
          { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const {
      message,
      conversationId: incomingConversationId,
      saveConversation = false,
      currentVersion: clientCurrentVersion,
    } = await req.json();

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
    let savedConversationId: string | null = null;

    if (saveConversation) {
      if (incomingConversationId) {
        const { data: existingConversation, error: existingError } = await supabaseAdmin
          .from('ai_conversations')
          .select('id')
          .eq('id', incomingConversationId)
          .eq('user_id', userId)
          .maybeSingle();

        if (existingError) throw existingError;
        savedConversationId = existingConversation?.id ?? null;
      }

      if (!savedConversationId) {
        const title = message.slice(0, 50) + (message.length > 50 ? '...' : '');
        const { data: conversation, error: conversationError } = await supabaseAdmin
          .from('ai_conversations')
          .insert({ user_id: userId, title: title || 'New Conversation' })
          .select('id')
          .single();

        if (conversationError) throw conversationError;
        savedConversationId = conversation.id;
      }

      const { error: userMessageError } = await supabaseAdmin
        .from('ai_messages')
        .insert({
          conversation_id: savedConversationId,
          sender_type: 'user',
          message,
        });

      if (userMessageError) throw userMessageError;

      await supabaseAdmin
        .from('ai_conversations')
        .update({ updated_at: new Date().toISOString(), last_message_at: new Date().toISOString() })
        .eq('id', savedConversationId);
    }
    
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

    // ---- LIVE WEB SEARCH (Perplexity) for time-sensitive queries ----
    // Triggers on PPV / sports / live / upcoming / schedule / "tonight" / "this week" etc.
    let liveContext = '';
    let liveCitations: string[] = [];
    const liveTriggers = /\b(ppv|pay[- ]?per[- ]?view|tonight|today|tomorrow|this week|this weekend|upcoming|schedule|live|stream(ing)?\s+(now|tonight|today)|score|fight card|main event|kickoff|tip[- ]?off|game time|when (is|does)|what time|airs?\s+(on|tonight|today)|epg|channel\s+\d+|nfl|nba|mlb|nhl|ufc|wwe|aew|boxing|formula\s*1|f1|premier league|champions league|world cup)\b/i;
    if (liveTriggers.test(message)) {
      const PERPLEXITY_API_KEY = Deno.env.get('PERPLEXITY_API_KEY');
      if (PERPLEXITY_API_KEY) {
        try {
          const pplxRes = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${PERPLEXITY_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'sonar',
              messages: [
                { role: 'system', content: 'Answer with current, accurate facts. Include dates, times (with time zone), channels/streaming services, and prices when relevant. Be concise.' },
                { role: 'user', content: message }
              ],
              temperature: 0.2,
              max_tokens: 500,
              search_recency_filter: 'week',
            }),
          });
          if (pplxRes.ok) {
            const pplx = await pplxRes.json();
            liveContext = pplx?.choices?.[0]?.message?.content ?? '';
            liveCitations = pplx?.citations ?? [];
            console.log('[perplexity] context length:', liveContext.length, 'citations:', liveCitations.length);
          } else {
            console.log('[perplexity] non-ok:', pplxRes.status, await pplxRes.text());
          }
        } catch (e) {
          console.log('[perplexity] error:', e);
        }
      } else {
        console.log('[perplexity] PERPLEXITY_API_KEY not configured');
      }
    }

    // System prompt with Snow Media context and app control functions
    const systemPrompt = `You are Snow Media AI, an intelligent assistant for the Snow Media Center (SMC) Android app. You are knowledgeable about:

SNOW MEDIA KNOWLEDGE:
- Streaming apps, Android TV apps, APKs
- Snow Media tutorials, guides, and content
- App installations, troubleshooting, and setup
- Streaming services, IPTV, media content
- Android TV devices, Fire TV, smart TV setup

WHERE TO WATCH SPORTS / PPV (CRITICAL ROUTING RULES — always answer with these, never recommend ESPN, Fubo, Hulu, Sling, YouTube TV, MLB.tv, NBA League Pass, Peacock, Paramount+, etc.):
- The user watches sports inside Snow Media's two supported services: **DreamStreams** and **VibezTV**. Ask which one they use ONLY if it isn't obvious from context.
- MLB / Baseball → "DreamStreams → MLB Zone" OR "VibezTV → MLB"
- NBA / Basketball → "DreamStreams → NBA Zone" OR "VibezTV → NBA"
- NFL / Football → "DreamStreams → NFL Zone" OR "VibezTV → NFL"
- NHL / Hockey → "DreamStreams → NHL Zone" OR "VibezTV → NHL"
- UFC / Boxing / PPV fights → "DreamStreams → PPV / Fight Night" OR "VibezTV → PPV"
- WWE / AEW / Wrestling → "DreamStreams → Wrestling" OR "VibezTV → Wrestling"
- Soccer / Premier League / Champions League → "DreamStreams → Soccer" OR "VibezTV → Soccer"
- Always phrase it like: "Catch it in **DreamStreams → MLB Zone** (or **VibezTV → MLB** if that's your service)." Then offer to open the app via the open_app / find_support_video function if relevant.

${knowledgeContext ? `\nKNOWLEDGE BASE DOCUMENTS:\n${knowledgeContext}\n` : ''}
${liveContext ? `\nLIVE WEB RESULTS (real-time, use these as the source of truth for upcoming events / PPV / sports / schedules):\n${liveContext}\n${liveCitations.length ? `Sources: ${liveCitations.slice(0,5).join(', ')}` : ''}\n` : ''}

APP CONTROL FUNCTIONS:
You can control the SMC app through function calls:
- navigate_to_section: Navigate to different app sections
- find_content: Search for specific content
- open_app: Open installed apps
- manage_settings: Adjust app settings
- show_tutorials: Display relevant tutorials

IMPORTANT: All users are accessing you through the SMC Android app. Provide helpful, concise responses about snow media topics and offer to perform app actions when relevant. When LIVE WEB RESULTS are present, ground your answer in them and cite the date/time clearly.

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
    const assistantContent = aiMessage.content || "I can help with that.";
    let functionCall = null;

    if (aiMessage.function_call) {
      functionCall = {
        name: aiMessage.function_call.name,
        arguments: JSON.parse(aiMessage.function_call.arguments)
      };
    }

    // Log usage + enforce platform-wide token threshold
    try {
      await logUsage({
        user_id: userId,
        user_email: userEmail,
        feature: 'chat',
        model: 'gpt-4o-mini',
        prompt: message,
        response_preview: assistantContent,
        prompt_tokens: data.usage?.prompt_tokens ?? 0,
        completion_tokens: data.usage?.completion_tokens ?? 0,
        total_tokens: data.usage?.total_tokens ?? 0,
        cost_credits: isOwnerEmail(userEmail) ? 0 : 0.01,
        status: 'ok',
      });
      await enforceThreshold();
    } catch (e) {
      console.error('[snow-media-ai] log/threshold failed:', e);
    }


    if (saveConversation && savedConversationId) {
      const { error: assistantMessageError } = await supabaseAdmin
        .from('ai_messages')
        .insert({
          conversation_id: savedConversationId,
          sender_type: 'assistant',
          message: assistantContent,
        });

      if (assistantMessageError) throw assistantMessageError;

      await supabaseAdmin
        .from('ai_conversations')
        .update({ updated_at: new Date().toISOString(), last_message_at: new Date().toISOString() })
        .eq('id', savedConversationId);
    }

    return new Response(JSON.stringify({ 
      message: assistantContent,
      response: assistantContent,
      conversationId: savedConversationId,
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
