import { useCallback, useEffect, useState } from 'react';
import { Preferences } from '@capacitor/preferences';
import {
  SnowPlayer, SCREEN_FORMAT_KEY, type ScreenFormat,
} from '@/capacitor/SnowPlayer';

/**
 * The viewer's screen-format choice, remembered across sessions.
 *
 * 'fit' is the default and it is a CORRECTION, not a taste setting: the video
 * is drawn into a full-screen surface, so without it every picture is stretched
 * to the panel and anything that is not 16:9 comes out the wrong shape. The
 * other three exist because no automatic rule gets every file right — a stream
 * that reports the wrong shape needs a human to say "this is widescreen".
 */
export function useScreenFormat(active: boolean) {
  const [format, setFormat] = useState<ScreenFormat>('fit');
  const [loaded, setLoaded] = useState(false);

  // Read the stored choice once.
  useEffect(() => {
    let cancelled = false;
    void Preferences.get({ key: SCREEN_FORMAT_KEY })
      .then(({ value }) => {
        if (cancelled) return;
        if (value === 'fit' || value === 'fill' || value === 'zoom' || value === 'wide') {
          setFormat(value);
        }
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  // Re-apply whenever a stream starts. The native side resets to its own
  // default per player instance, so a remembered choice has to be pushed back
  // every time rather than only when the viewer changes it.
  useEffect(() => {
    if (!active || !loaded) return;
    void SnowPlayer.setResizeMode({ mode: format }).catch(() => undefined);
  }, [active, loaded, format]);

  const change = useCallback(async (next: ScreenFormat) => {
    setFormat(next);
    try { await SnowPlayer.setResizeMode({ mode: next }); } catch { /* web build */ }
    try { await Preferences.set({ key: SCREEN_FORMAT_KEY, value: next }); } catch { /* ignore */ }
  }, []);

  return { format, setFormat: change };
}
