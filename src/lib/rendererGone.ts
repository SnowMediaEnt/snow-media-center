// The page's renderer died under the app (MainActivity.onRenderProcessGone).
// On an old box's WebView (an X96's Chrome 66) a renderer that runs out of
// memory takes the page with it, while the native player under the page
// played on: a black screen with the channel's sound and no player bar (owner,
// 2026-10-11). The activity is made again and the app starts over on Home;
// the native side keeps a small record of the death (RendererGone.kt), and the
// next page hands it to analytics once, here: how often, on which boxes and
// WebViews, how short of memory, and whether a stream was playing. Device
// facts only: never an address, a line, a username or a password.
import { Capacitor } from '@capacitor/core';
import { AppManager, type RendererGoneRecord } from '@/capacitor/AppManager';

type Track = (name: string, category?: string, properties?: Record<string, unknown>) => void;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v.slice(0, 80) : null);

/** The event's properties: the record's device facts, field by field, and
 *  nothing else (a field the record does not have is null). */
export function rendererGoneProps(r: RendererGoneRecord, legacyWebView: boolean): Record<string, unknown> {
  const at = num(r.at);
  return {
    gone_at: at && at > 0 ? new Date(at).toISOString() : null,
    did_crash: r.didCrash === true,
    priority: num(r.priority),
    player_active: r.playerActive === true,
    model: text(r.model),
    sdk: num(r.sdk),
    total_mem_mb: num(r.totalMemMb),
    avail_mem_mb: num(r.availMemMb),
    low_memory: r.lowMemory === true,
    webview: text(r.webView),
    count: num(r.count) ?? 1,
    legacy_webview: legacyWebView,
  };
}

/** Once per start, from analytics' own start (it is only recording by then):
 *  the last renderer death, if there was one, as 'webview_gone'. Never throws. */
export async function reportRendererGone(track: Track): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { gone } = await AppManager.takeRendererGone();
    if (!gone) return;
    const legacy = typeof document !== 'undefined' && document.documentElement.classList.contains('legacy-webview');
    track('webview_gone', 'app', rendererGoneProps(gone, legacy));
  } catch { /* an older build has no such call; nothing to say */ }
}
