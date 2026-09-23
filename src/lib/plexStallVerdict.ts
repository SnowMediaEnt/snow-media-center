// Plex-specific reading of a stall. The general diagnostics (bufferDiagnostics)
// measure the internet and the stream but know nothing about what is being
// played. Plex tells us how many Mb/s the file needs and which route the box
// takes to the server, and those settle most "is it me or the server?"
// questions on their own:
//   • Relay: Plex's relay caps the speed whatever the internet does.
//   • Internet slower than the file needs: nothing upstream can fix that; a
//     lower quality can.
//   • Internet fast, stream slow while the file needs more: the server's
//     upload (or its converting) is the bottleneck.
// Returns null when there is nothing Plex-specific to add.
import { formatMbps, type ClassifyResult, type DiagSnapshot } from '@/lib/bufferDiagnostics';
import { PLEX_QUALITY_PRESETS, type PlexRoute } from '@/lib/plex';

export interface PlexStallContext {
  /** Average bitrate of the file, kbps. */
  fileKbps?: number;
  /** Chosen quality cap when converting, kbps. */
  targetKbps?: number;
  transcoding: boolean;
  route?: PlexRoute;
}

/** The best quality preset that fits comfortably in `kbps`. */
export function presetFor(kbps: number): string {
  const fit = PLEX_QUALITY_PRESETS
    .filter((p) => p.maxVideoBitrateKbps && p.maxVideoBitrateKbps <= kbps * 0.75)
    .sort((a, b) => (b.maxVideoBitrateKbps ?? 0) - (a.maxVideoBitrateKbps ?? 0))[0];
  return (fit ?? PLEX_QUALITY_PRESETS[PLEX_QUALITY_PRESETS.length - 1]).label;
}

export function explainPlexStall(snap: DiagSnapshot, ctx: PlexStallContext): ClassifyResult | null {
  if (snap.verdict === 'ok') return null;
  // Gone offline says it all.
  if (snap.verdict === 'internet' && !snap.online) return null;
  const need = ctx.transcoding ? (ctx.targetKbps ?? ctx.fileKbps) : ctx.fileKbps;
  const net = snap.probeKbps;
  const got = snap.hostKbps ?? snap.streamKbps;
  const needs = need ? ` This video needs about ${formatMbps(need)}.` : '';

  if (ctx.route === 'relay') {
    return {
      verdict: 'server',
      headline: 'Plex Relay is limiting the speed',
      detail: `This TV can't reach the Plex server directly, so Plex sends it through its relay, which caps the speed.${needs} Pick 720p · 3 Mbps in the player menu.`,
    };
  }

  if (need && net != null && net < need * 1.1) {
    return {
      verdict: 'internet',
      headline: `Your internet (${formatMbps(net)}) is slower than this video needs`,
      detail: `It needs about ${formatMbps(need)}. Pick ${presetFor(net)} in the player menu.`,
    };
  }

  // A fall from a fast start with good internet is the ISP, not the server.
  if (snap.verdict === 'throttling') return null;

  if (need && net != null && net >= need * 1.3 && got != null && got < need) {
    return ctx.transcoding
      ? {
        verdict: 'server',
        headline: "The Plex server can't convert this fast enough",
        detail: `Your internet is fine (${formatMbps(net)}), but the server is only managing ${formatMbps(got)} while converting. Try a lower quality, or Original.`,
      }
      : {
        verdict: 'server',
        headline: "The Plex server can't send this fast enough",
        detail: `Your internet is fine (${formatMbps(net)}), but the server is only sending ${formatMbps(got)} and this video needs about ${formatMbps(need)}. Its upload is busy or too slow — pick ${presetFor(got)}.`,
      };
  }

  if (ctx.transcoding && snap.verdict === 'unknown') {
    return {
      verdict: 'unknown',
      headline: 'The Plex server is converting this video',
      detail: `It can take a few seconds to get ahead.${needs}`,
    };
  }

  // Nothing Plex-specific: the general verdict, with the size of the file.
  if (!needs) return null;
  return { verdict: snap.verdict, headline: snap.headline, detail: snap.detail ? `${snap.detail}.${needs}` : needs.trim() };
}
