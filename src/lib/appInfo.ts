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
