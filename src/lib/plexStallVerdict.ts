// Plex-specific reading of a stall. The general diagnostics (bufferDiagnostics)
// measure the internet and the stream but know nothing about what is being
// played. Plex tells us how many Mb/s the file needs and which route the box
// takes to the server, and those settle most "is it me or the server?"
// questions on their own:
//   • The connection dropped (offline, or the internet check failing twice
//     running): said first, whatever else the numbers say.
//   • Relay: Plex's relay caps the speed whatever the internet does.
//   • Nothing arriving from the server: it has paused (or is slow to
//     answer). Said as that, never as a speed.
//   • What the server delivered during the stall (stallEvidence: bytes as
//     they arrived at the player) short of what the video needs: the
//     server's upload, its converting, or the line to it is the bottleneck,
//     and a lower quality helps.
//   • Internet quick check slower than the file needs: a lower quality can.
// Only that delivered number is proof that the server or the line can't
// keep up. The quick checks (256 KB from Cloudflare) read low on a fast
// line, and the general verdict's "server" and "ISP throttling" come from
// them, so with the internet check well above what the video needs and no
// such proof, the card names no culprit and suggests no quality.
// Returns null when there is nothing Plex-specific to add.
import i18n from '@/i18n';
import { formatMbps, type ClassifyResult, type DiagSnapshot } from '@/lib/bufferDiagnostics';
import { PLEX_QUALITY_PRESETS, type PlexQualityPreset, type PlexRoute } from '@/lib/plex';
import { RELAY_PRESET } from '@/lib/plexAutoQuality';

/** Nothing from the server for this long mid-stall is said plainly
 *  (stallEvidence counts it only once a report was due in the stall). */
export const QUIET_SAY_MS = 2_000;

export interface PlexStallContext {
  /** Average bitrate of the file, kbps. */
  fileKbps?: number;
  /** Chosen quality cap when converting, kbps. */
  targetKbps?: number;
  transcoding: boolean;
  route?: PlexRoute;
  /** What the server sent flat out during this stall, or a fresh read of the
   *  file, kbps (stallEvidence's `kbps`): the only proof that it can't keep
   *  up. Null or unset when there is none. */
  serverKbps?: number | null;
  /** How long nothing has arrived from the server in this stall, ms
   *  (stallEvidence's `quietMs`). */
  quietMs?: number;
  /** What automatic quality will lower to if this goes on (a label); unset
   *  when it has nothing lower (or is off). */
  autoNext?: string | null;
  /** It lowers to `autoNext` within seconds, not on more stalls: this
   *  stall's evidence shows the file played as it is too big for what the
   *  server sends, and the early drop for that is still to come. */
  autoSoon?: boolean;
}

/** A Plex reading of a stall; `autoSaid` when its advice already says what
 *  automatic quality will do, `dropped` when it is the general "connection
 *  dropped" (the last internet check is then not current). */
export type PlexStallExplanation = ClassifyResult & { autoSaid?: boolean; dropped?: boolean };

/**
 * The general verdict says the connection dropped: offline, or the internet
 * check failed twice running (an Android TV keeps navigator.onLine true when
 * the internet past the router is gone). Its only other internet verdict is
 * a slow check, which names its number instead.
 */
export function connectionDropped(snap: Pick<DiagSnapshot, 'verdict' | 'online' | 'dropped'>): boolean {
  return snap.verdict === 'internet' && (!snap.online || !!snap.dropped);
}

/** The best quality preset that fits comfortably in `kbps`. */
export function fitPreset(kbps: number): PlexQualityPreset {
  const fit = PLEX_QUALITY_PRESETS
    .filter((p) => p.maxVideoBitrateKbps && p.maxVideoBitrateKbps <= kbps * 0.75)
    .sort((a, b) => (b.maxVideoBitrateKbps ?? 0) - (a.maxVideoBitrateKbps ?? 0))[0];
  return fit ?? PLEX_QUALITY_PRESETS[PLEX_QUALITY_PRESETS.length - 1];
}
export const presetFor = (kbps: number): string => fitPreset(kbps).label;

const relayPreset = (): PlexQualityPreset | undefined => PLEX_QUALITY_PRESETS.find((p) => p.key === RELAY_PRESET);

export function explainPlexStall(snap: DiagSnapshot, ctx: PlexStallContext): PlexStallExplanation | null {
  if (snap.verdict === 'ok') return null;
  // The connection dropped says it all, ahead of the server going quiet
  // (which is what a dropped line looks like from here). The general verdict
  // as it is, flagged: its last internet number is from before the drop.
  if (connectionDropped(snap)) return { verdict: snap.verdict, headline: snap.headline, detail: snap.detail, dropped: true };
  const need = ctx.transcoding ? (ctx.targetKbps ?? ctx.fileKbps) : ctx.fileKbps;
  const net = snap.probeKbps;
  // Proof of what the server sends flat out; the quick probes and the rate
  // arriving right now are not (see the top of this file).
  const server = ctx.serverKbps != null && ctx.serverKbps > 0 ? ctx.serverKbps : null;
  const needs = need ? ` ${i18n.t('plex.stall.needs', { speed: formatMbps(need) })}` : '';
  const netFine = !!need && net != null && net >= need * 1.3;
  const auto = ctx.autoNext || null;
  // With automatic quality on, what it will do (and when); otherwise what to
  // pick.
  const advice = (label: string): string => (auto
    ? (ctx.autoSoon ? i18n.t('plex.stall.adviceSoon', { quality: auto }) : i18n.t('plex.stall.adviceAuto', { quality: auto }))
    : i18n.t('plex.stall.advicePick', { quality: label }));
  // Nothing proven, the internet fine: no culprit.
  const fine = (): PlexStallExplanation => ({ verdict: 'unknown', headline: i18n.t('plex.buffering.headline'), detail: `${i18n.t('plex.stall.internetFine', { speed: formatMbps(net) })}${needs}` });

  if (ctx.route === 'relay') {
    const relay = relayPreset();
    // Already at (or under) the relay-sized quality: nothing to pick.
    const atRelay = !!relay?.maxVideoBitrateKbps && ctx.transcoding && !!ctx.targetKbps && ctx.targetKbps <= relay.maxVideoBitrateKbps;
    const tip = auto || (relay && !atRelay) ? ` ${advice(relay?.label ?? '')}` : '';
    return {
      verdict: 'server',
      headline: i18n.t('plex.stall.relayHeadline'),
      detail: `${i18n.t('plex.stall.relayDetail')}${needs}${tip}`,
      autoSaid: !!auto,
    };
  }

  // Nothing is arriving: the server has paused or is slow to answer. That is
  // not a speed, so no culprit's speed and no quality to pick.
  const quiet = ctx.quietMs ?? 0;
  if (quiet >= QUIET_SAY_MS) {
    return {
      verdict: 'unknown',
      headline: i18n.t('plex.stall.waitingHeadline'),
      detail: i18n.t('plex.stall.waitingDetail', { seconds: Math.round(quiet / 1000) }),
    };
  }

  if (server != null && need) {
    // It sends enough flat out: a hiccup, not the speed.
    if (server >= need) {
      return {
        verdict: 'unknown',
        headline: i18n.t('plex.buffering.headline'),
        detail: i18n.t('plex.stall.sendingEnough', { speed: formatMbps(server) }),
      };
    }
    if (netFine) {
      return ctx.transcoding
        ? {
          verdict: 'server',
          headline: i18n.t('plex.stall.convertHeadline'),
          detail: `${i18n.t('plex.stall.convertDetail', { server: formatMbps(server), speed: formatMbps(net) })} ${auto ? advice('') : i18n.t('plex.stall.tryLower')}`,
          autoSaid: !!auto,
        }
        : {
          verdict: 'server',
          headline: i18n.t('plex.stall.sendHeadline'),
          detail: `${i18n.t('plex.stall.sendDetail', { server: formatMbps(server), need: formatMbps(need), speed: formatMbps(net) })} ${advice(presetFor(server))}`,
          autoSaid: !!auto,
        };
    }
    // Short, but whether of the server's upload or of the line is not known.
    return {
      verdict: 'server',
      headline: i18n.t('plex.stall.slowLineHeadline'),
      detail: `${i18n.t('plex.stall.slowLineDetail', { server: formatMbps(server), need: formatMbps(need) })} ${advice(presetFor(server))}`,
      autoSaid: !!auto,
    };
  }

  // No proof from the server either way from here on.
  if (need && net != null && net < need * 1.1) {
    return {
      verdict: 'internet',
      headline: i18n.t('plex.stall.quickHeadline', { speed: formatMbps(net) }),
      detail: `${i18n.t('plex.stall.quickDetail', { need: formatMbps(need) })} ${advice(presetFor(net))}`,
      autoSaid: !!auto,
    };
  }

  // "ISP throttling" is a fall in 64 KB samples of the stream: with the
  // internet check fine and nothing from the server to go by, not proof
  // either. Otherwise the general verdict stands.
  if (snap.verdict === 'throttling') return netFine ? fine() : null;

  if (ctx.transcoding && snap.verdict === 'unknown') {
    return {
      verdict: 'unknown',
      headline: i18n.t('plex.stall.convertingHeadline'),
      detail: `${i18n.t('plex.stall.convertingDetail')}${needs}`,
    };
  }

  // The general verdict blames the server on a quick 64 KB probe of it: not
  // proof. Say what is known instead.
  if (snap.verdict === 'server') {
    return netFine ? fine() : { verdict: 'unknown', headline: i18n.t('plex.buffering.headline'), detail: `${i18n.t('plex.stall.checking')}${needs}` };
  }

  // Nothing Plex-specific: the general verdict, with the size of the file.
  if (!needs) return null;
  return { verdict: snap.verdict, headline: snap.headline, detail: snap.detail ? `${snap.detail}.${needs}` : needs.trim() };
}
