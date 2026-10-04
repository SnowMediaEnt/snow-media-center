// A Plex file's frame rate from its metadata (/library/metadata), for
// frame-rate matching on the native player. Matroska — most 4K remuxes — never
// states a frame rate to the player itself, so Plex's own reading is the
// first source (SnowPlayerLoadOpts.frameRate).
//
// The video Stream's `frameRate` (23.976, 25.0 …) when the payload carries
// the streams; else the Media's `videoFrameRate`, which Plex writes as a
// label: "24p" is 23.976 (film as broadcast and on disc), "PAL" 25, "NTSC"
// 29.97, and a plain number ("60p", "50") is taken as given.

const LABELS: Record<string, number> = { '24p': 23.976, pal: 25, ntsc: 29.97 };

function usable(n: number): number | undefined {
  return Number.isFinite(n) && n > 0 && n < 200 ? Math.round(n * 1000) / 1000 : undefined;
}

/** Plex's Media.videoFrameRate label as a number; undefined when it says nothing usable. */
export function plexFrameRateLabel(label: unknown): number | undefined {
  if (typeof label === 'number') return usable(label);
  if (typeof label !== 'string') return undefined;
  const l = label.trim().toLowerCase();
  if (!l) return undefined;
  if (LABELS[l] != null) return LABELS[l];
  const m = /^(\d+(?:\.\d+)?)\s*[pi]?$/.exec(l);
  return m ? usable(Number(m[1])) : undefined;
}

/** The frame rate of one Media entry: its video stream's, else its label's. */
export function plexMediaFrameRate(media: Record<string, unknown> | undefined): number | undefined {
  if (!media) return undefined;
  const parts = Array.isArray(media.Part) ? (media.Part as Array<Record<string, unknown>>) : [];
  for (const part of parts) {
    const streams = Array.isArray(part.Stream) ? (part.Stream as Array<Record<string, unknown>>) : [];
    for (const st of streams) {
      if (Number(st.streamType) !== 1) continue;
      const fps = usable(Number(st.frameRate));
      if (fps) return fps;
    }
  }
  return plexFrameRateLabel(media.videoFrameRate);
}
