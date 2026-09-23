// Who is watching: the key per-viewer things are stored under (Plex resume
// points, My List). The signed-in Snow Media account's id, else 'device' for
// the box itself. Profiles will extend this key; everything keyed by it
// follows automatically.
import { supabase } from '@/integrations/supabase/client';

let viewer = 'device';
let resolved: Promise<string> | null = null;
const listeners = new Set<(v: string) => void>();

/** The current viewer key (may still be 'device' before resolveViewer). */
export const viewerKey = (): string => viewer;

/** True when the viewer is a signed-in account (things can be copied to it). */
export const viewerIsAccount = (): boolean => viewer !== 'device';

/** Resolves the viewer once and follows sign-in / sign-out after that. */
export function resolveViewer(): Promise<string> {
  resolved ??= (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      viewer = data.session?.user?.id ?? 'device';
    } catch { viewer = 'device'; }
    try {
      supabase.auth.onAuthStateChange((_e, session) => {
        const next = session?.user?.id ?? 'device';
        if (next === viewer) return;
        viewer = next;
        for (const cb of listeners) { try { cb(viewer); } catch { /* ignore */ } }
      });
    } catch { /* no auth in this build */ }
    return viewer;
  })();
  return resolved;
}

/** Called with the new key whenever the viewer changes. Returns an unsubscribe. */
export function onViewerChange(cb: (v: string) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Tests only. */
export function __setViewerForTests(v: string): void {
  viewer = v;
  resolved = Promise.resolve(v);
}
