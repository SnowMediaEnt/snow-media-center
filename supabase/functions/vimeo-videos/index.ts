import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // Fetch videos from Vimeo API
    const vimeoResponse = await fetch('https://api.vimeo.com/me/videos?per_page=10&sort=date', {
      headers: {
        'Authorization': `Bearer ${vimeoToken}`,
        'Accept': 'application/vnd.vimeo.*+json;version=3.4',
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
        message: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});