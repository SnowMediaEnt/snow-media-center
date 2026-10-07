import { loadVersion } from '@/hooks/useVersion';
import type { XtreamCreds } from '@/lib/xtream';

/** Best-effort device model / Android version from the WebView UA. */
export const parseDeviceInfo = (): { model: string | null; android: string | null } => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const android = /Android\s+([\d.]+)/i.exec(ua)?.[1] ?? null;
  let model: string | null = null;
  const m = /Android\s+[\d.]+;\s*([^;)]+?)(?:\s+Build\/|\s*\)|;|\s*$)/i.exec(ua);
  if (m && m[1]) model = m[1].trim() || null;
  return { model, android };
};

/**
 * tv / phone / tablet, from the WebView UA. SMC is a remote-only TV app, so
 * an Android UA with nothing that says "phone" or "tablet" (most streaming
 * boxes: onn, Chromecast, Mi Box, Shield) counts as a TV.
 */
export const parseFormFactor = (
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '',
): 'tv' | 'phone' | 'tablet' => {
  if (/Android TV|GoogleTV|Google TV|BRAVIA|SmartTV|\bAFT[A-Z0-9]+\b|Fire ?TV|FireOS|\bTV\b/i.test(ua)) return 'tv';
  // Fire tablets (KFxxxx), Samsung Tab, or any Android UA that is not "Mobile" but says tablet.
  if (/\bKF[A-Z]{2,}\b|Tablet|\bSM-T\d|\bTab\b/i.test(ua)) return 'tablet';
  if (/Mobile/i.test(ua)) return 'phone';
  return 'tv';
};

/** Never wait long on the native call: a ticket must not be held up by it. */
const VERSION_WAIT_MS = 2500;

/** The Live TV line(s): those given (a report about a channel on that
 *  line), else the line in use, else the saved ones (lib/lineInfo). Loaded
 *  on demand so this file stays light; '' on any trouble. */
const lineInfoLines = async (lines?: XtreamCreds[]): Promise<string> => {
  try {
    const m = await import('@/lib/lineInfo');
    if (!lines?.length) return await m.buildLineInfoLines();
    const all = await Promise.all(lines.map((l) => m.lineStatus(l)));
    return all.map(m.formatLine).join('\n');
  } catch {
    return '';
  }
};

/**
 * The lines the support team reads at the top of a ticket: which build of the
 * app the box runs, on what, and the Live TV line. Always English (staff
 * text), e.g.
 *   App: Snow Media Center 1.8.0 (build 55)
 *   Device: AFTMM, Android 9
 *   Line: jsmith (DreamStreams) · connections 2/3 · expires 2026-12-01
 * Whatever is unknown is left out; never throws, never carries a token or a
 * password (the line's username, service, connection counts and expiry only).
 * The version and the line are asked at the same time, each with its own
 * short limit (2.5 s, 3 s), so a ticket waits ~3 s at worst.
 */
export async function buildAppInfoLines(opts: { lines?: XtreamCreds[] } = {}): Promise<string> {
  let version = '';
  let code = 0;
  const linePart = lineInfoLines(opts.lines);
  try {
    const v = await Promise.race([
      loadVersion(),
      new Promise<null>((resolve) => { setTimeout(() => resolve(null), VERSION_WAIT_MS); }),
    ]);
    if (v) {
      version = v.version || '';
      code = Number(v.versionCode) || 0;
    }
  } catch { /* fall through with what we have */ }

  const lines: string[] = [];
  const app = ['Snow Media Center', version, code > 0 ? `(build ${code})` : ''].filter(Boolean).join(' ');
  lines.push(`App: ${app}`);

  try {
    const { model, android } = parseDeviceInfo();
    const dev = [model, android ? `Android ${android}` : ''].filter(Boolean).join(', ');
    if (dev) lines.push(`Device: ${dev}`);
  } catch { /* device line is optional */ }
  const lineText = await linePart;
  if (lineText) lines.push(lineText);
  return lines.join('\n');
}

/** `body` with the app/device/line lines in front. `lines`: the Live TV
 *  line(s) the ticket is about, when the caller knows (a channel report). */
export async function withAppInfo(body: string, opts: { lines?: XtreamCreds[] } = {}): Promise<string> {
  const info = await buildAppInfoLines(opts);
  return `${info}\n\n${body}`;
}
