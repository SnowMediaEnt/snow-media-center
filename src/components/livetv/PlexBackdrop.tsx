// The highlighted title's art behind the Plex rails (Home, Discover, the
// seasonal collection, a library's rows), as the Plex app's own home does.
//
// What it costs, and why it is shaped this way (1–2 GB sticks, Chromium 66):
//   - Nothing happens on a key press but resetting one timer (focusBackdrop).
//     The rails tell this module where the highlight is; no React state
//     changes, so nothing re-renders. Only when the highlight has rested
//     SETTLE_MS does the art load.
//   - The art is the server's photo transcode at a small size (960×540, or
//     640×360 on html.native-low-memory): ~40–90 KB, ~2 MB decoded (0.9 MB
//     small). The raw art is the agent's original, often 1920×1080 or 4K.
//   - It is loaded off-screen (new Image), decoded (img.decode where the
//     WebView has it), and only then put on screen — the very element that
//     was decoded, so it is not decoded twice. The next move cancels a load
//     still in flight.
//   - Strong boxes cross-fade: the new image fades in over the old on
//     opacity only (a compositor animation), then the old one is dropped.
//     Low-memory boxes swap at once and keep a single image.
//   - The layer is fixed behind the rails in its own compositing layer
//     (translateZ), with the scrim painted once over it; rails scrolling
//     over it do not re-raster the art. No blur, no filter.
//   - Turned off with PLEX_BACKDROP (lib/plexBackdrop.ts): the component
//     renders nothing and focusBackdrop returns at once.
import { memo, useEffect, useRef } from 'react';
import { plexPhotoTranscodeUrl, type PlexItem } from '@/lib/plex';
import { backdropPaths, onBackdropFocus, PLEX_BACKDROP } from '@/lib/plexBackdrop';

const FADE_MS = 350;

const lowMemory = () => typeof document !== 'undefined' && document.documentElement.classList.contains('native-low-memory');

interface Props { base: string; token: string }

const PlexBackdrop = memo(({ base, token }: Props) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!PLEX_BACKDROP) return;
    const small = lowMemory();
    const w = small ? 640 : 960;
    const h = small ? 360 : 540;
    const box = boxRef.current;
    let seq = 0;
    let lastKey: string | null = null;
    let loading: HTMLImageElement | null = null;
    const fades: number[] = [];

    const cancelLoad = () => {
      if (!loading) return;
      loading.onload = null; loading.onerror = null;
      // An empty src stops the request on Chromium.
      loading.removeAttribute('src');
      loading = null;
    };

    const show = (img: HTMLImageElement) => {
      const scrim = scrimRef.current;
      if (!box || !scrim) return;
      img.className = 'plex-backdrop-img';
      img.alt = '';
      const old = Array.prototype.slice.call(box.querySelectorAll('img.plex-backdrop-img')) as HTMLImageElement[];
      if (small || old.length === 0) {
        box.insertBefore(img, scrim);
        for (const o of old) box.removeChild(o);
        return;
      }
      // Only the image on top stays under the new one; anything older (a
      // fade still running) goes now.
      for (const o of old.slice(0, -1)) box.removeChild(o);
      const under = old.slice(-1);
      img.style.opacity = '0';
      // Its own layer for the fade only, so the fade runs on the compositor
      // instead of repainting the art each frame; dropped when it is done.
      img.style.willChange = 'opacity';
      box.insertBefore(img, scrim);
      // Commit the starting opacity, then fade: one style flush per change
      // of art, not per key press.
      void img.offsetWidth;
      img.style.transition = `opacity ${FADE_MS}ms ease-out`;
      img.style.opacity = '1';
      fades.push(window.setTimeout(() => {
        for (const o of under) if (o.parentNode === box) box.removeChild(o);
        img.style.transition = '';
        img.style.willChange = '';
      }, FADE_MS + 50));
    };

    const load = (it: PlexItem) => {
      const paths = backdropPaths(it);
      const id = `${it.ratingKey}|${paths[0] ?? ''}`;
      if (!paths.length || id === lastKey) return;
      cancelLoad();
      const my = ++seq;
      const attempt = (i: number) => {
        if (my !== seq || i >= paths.length) return;
        const img = new Image();
        loading = img;
        const done = () => {
          if (my !== seq) return;
          loading = null;
          lastKey = id;
          show(img);
        };
        img.onload = () => {
          img.onload = null; img.onerror = null;
          // Decoded before it is shown, so the swap never paints half an image
          // or stalls a frame on the decode.
          if (typeof img.decode === 'function') img.decode().then(done, done);
          else done();
        };
        img.onerror = () => { img.onload = null; img.onerror = null; if (my === seq) attempt(i + 1); };
        img.src = plexPhotoTranscodeUrl(base, paths[i], token, w, h);
      };
      attempt(0);
    };

    const off = onBackdropFocus(load);
    return () => {
      off();
      seq += 1;
      cancelLoad();
      for (const f of fades) window.clearTimeout(f);
      if (box) for (const o of Array.prototype.slice.call(box.querySelectorAll('img.plex-backdrop-img')) as HTMLImageElement[]) box.removeChild(o);
    };
  }, [base, token]);

  if (!PLEX_BACKDROP) return null;
  return (
    <div ref={boxRef} className="plex-backdrop" aria-hidden="true">
      <div ref={scrimRef} className="plex-backdrop-scrim" />
    </div>
  );
});
PlexBackdrop.displayName = 'PlexBackdrop';
export default PlexBackdrop;
