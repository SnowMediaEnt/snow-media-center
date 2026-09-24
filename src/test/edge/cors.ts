// Stand-in for 'npm:@supabase/supabase-js@2/cors' when an edge function is
// loaded in a test (see vitest.config.ts).
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
