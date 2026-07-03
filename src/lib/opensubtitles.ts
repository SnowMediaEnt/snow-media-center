// Thin wrapper around the opensubtitles edge function.
// Server is authoritative — client never sees the API key or credentials.
import { supabase } from '@/integrations/supabase/client';

export interface OpenSubResult {
  id: number;
  lang: string;
  release: string;
  downloads: number;
}

export type OpenSubSearchResponse =
  | { ok: true; results: OpenSubResult[] }
  | { ok: false; reason: 'not_configured' | 'quota' | 'error' };

export type OpenSubDownloadResponse =
  | { ok: true; url: string; remaining: number | null }
  | { ok: false; reason: 'not_configured' | 'quota' | 'error' };

interface SearchArgs {
  query: string;
  year?: number;
  season?: number;
  episode?: number;
  languages?: string;
}

export async function searchOpenSubtitles(args: SearchArgs): Promise<OpenSubSearchResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('opensubtitles', {
      body: { action: 'search', ...args },
    });
    if (error || !data) return { ok: false, reason: 'error' };
    return data as OpenSubSearchResponse;
  } catch { return { ok: false, reason: 'error' }; }
}

export async function downloadOpenSubtitle(fileId: number): Promise<OpenSubDownloadResponse> {
  try {
    const { data, error } = await supabase.functions.invoke('opensubtitles', {
      body: { action: 'download', file_id: fileId },
    });
    if (error || !data) return { ok: false, reason: 'error' };
    return data as OpenSubDownloadResponse;
  } catch { return { ok: false, reason: 'error' }; }
}
