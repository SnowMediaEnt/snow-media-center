import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Authentication helper
async function authenticateUser(req: Request): Promise<{ userId: string | null; error: Response | null }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { 
      userId: null, 
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    };
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
    return { 
      userId: null, 
      error: new Response(JSON.stringify({ error: 'Invalid token' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    };
  }

  return { userId: user.id, error: null };
}

interface VimeoVideo {
  uri: string;
  name: string;
  description: string;
  duration: number;
  pictures: {
    sizes: Array<{
      width: number;
      height: number;
      link: string;
    }>;
  };
  player_embed_url: string;
  created_time: string;
  tags: Array<{
    name: string;
    canonical: string;
  }>;
}

interface VimeoResponse {
  data: VimeoVideo[];
  page: number;
  per_page: number;
  paging: {
    next?: string;
    previous?: string;
    first: string;
    last: string;
  };
  total: number;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Support videos are public - no authentication required
    // This allows basic support videos to be viewed without signing in
    console.log('Vimeo videos function called - public access');

    // Get Vimeo credentials from Supabase secrets
    const vimeoToken = Deno.env.get('VIMEO_ACCESS_TOKEN');
    
    if (!vimeoToken) {
      console.error('Missing VIMEO_ACCESS_TOKEN');
      return new Response(
        JSON.stringify({ error: 'Vimeo credentials not configured' }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('Fetching videos from Vimeo API...');

    // Add cache-busting parameter to force fresh data
    const cacheBuster = Date.now();
    const vimeoResponse = await fetch(`https://api.vimeo.com/me/videos?per_page=100&sort=date&fields=uri,name,description,duration,pictures,player_embed_url,created_time,tags&_cb=${cacheBuster}`, {
      headers: {
        'Authorization': `Bearer ${vimeoToken}`,
        'Accept': 'application/vnd.vimeo.*+json;version=3.4',
        'Cache-Control': 'no-cache',
      },
    });

    if (!vimeoResponse.ok) {
      console.error('Vimeo API error:', vimeoResponse.status, vimeoResponse.statusText);
      const errorText = await vimeoResponse.text();
      console.error('Vimeo API error details:', errorText);
      
      return new Response(
        JSON.stringify({ 
          error: 'Failed to fetch videos from Vimeo',
          details: errorText 
        }),
        { 
          status: vimeoResponse.status, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    const vimeoData: VimeoResponse = await vimeoResponse.json();
    console.log(`Successfully fetched ${vimeoData.data.length} videos from Vimeo`);

    // Transform Vimeo data to our format
    const transformedVideos = vimeoData.data.map(video => {
      // Format duration from seconds to MM:SS
      const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      };

      // Get the best thumbnail (largest available)
      const thumbnail = video.pictures?.sizes?.length > 0 
        ? video.pictures.sizes[video.pictures.sizes.length - 1].link
        : '/placeholder.svg';

      return {
        id: video.uri.split('/').pop(),
        title: video.name || 'Untitled Video',
        description: video.description || 'No description available',
        duration: formatDuration(video.duration),
        thumbnail: thumbnail,
        embed_url: video.player_embed_url,
        created_at: video.created_time,
        tags: video.tags?.map(tag => tag.name) || [],
      };
    });

    return new Response(
      JSON.stringify({ 
        videos: transformedVideos,
        total: vimeoData.total 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error in vimeo-videos function:', error);
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error)
      }),
      {
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});