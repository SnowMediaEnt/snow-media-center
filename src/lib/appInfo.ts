import { loadVersion } from '@/hooks/useVersion';

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

/**
 * The lines the support team reads at the top of a ticket: which build of the
 * app the box runs, and on what. Always English (staff text), e.g.
 *   App: Snow Media Center 1.8.0 (build 55)
 *   Device: AFTMM, Android 9
 * Whatever is unknown is left out; never throws, never carries a token.
 */
export async function buildAppInfoLines(): Promise<string> {
  let version = '';
  let code = 0;
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
  return lines.join('\n');
}

/** `body` with the app/device lines in front. */
export async function withAppInfo(body: string): Promise<string> {
  const info = await buildAppInfoLines();
  return `${info}\n\n${body}`;
}
