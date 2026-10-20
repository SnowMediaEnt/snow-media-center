// Settings › Add another service › Test: try an outside service before it is
// saved (lib/outsideSource). Apart from outsideSource.ts because it needs the
// Xtream client, and the client's own imports reach outsideSource.ts: kept
// here, nothing imports this but the settings page, so there is no cycle.
import { authenticate, countLiveStreams, getLiveCategories } from '@/lib/xtream';
import { lineIsActive, outsideCreds, type OutsideSource } from '@/lib/outsideSource';

/** Why a test failed, for the screen to say in plain words. */
export type OutsideTestError = 'wrongLogin' | 'unreachable' | 'notPlaylist' | 'empty' | 'inactive' | 'tooBig';
export type OutsideTestResult = { ok: true; channels: number } | { ok: false; error: OutsideTestError };

/**
 * Sign in (Xtream) or read the playlist (M3U), then load the categories and
 * count the live channels. Straight to the service, as everything about it
 * (xtream.ts sees `outside`: never the list proxy). Never throws.
 */
export async function testOutsideSource(src: OutsideSource): Promise<OutsideTestResult> {
  const c = outsideCreds(src);
  const failure = (e: unknown): OutsideTestError => {
    const err = e as { name?: string; reason?: string; status?: unknown } | null;
    if (err?.name === 'M3uError') return err.reason === 'too_big' ? 'tooBig' : 'notPlaylist';
    if (typeof err?.status === 'number') {
      if (err.status === 401 || err.status === 403) return 'wrongLogin';
      if (err.status === 404 && c.m3u) return 'notPlaylist';
    }
    return 'unreachable';
  };
  try {
    if (!c.m3u) {
      const info = await authenticate(c);
      const ui = (info as { user_info?: { auth?: unknown; status?: unknown; exp_date?: unknown } } | null)?.user_info;
      const auth = ui?.auth;
      if (!(auth === 1 || auth === '1' || auth === true)) return { ok: false, error: 'wrongLogin' };
      if (!lineIsActive({ status: String(ui?.status ?? ''), expDate: Number(ui?.exp_date) || null })) return { ok: false, error: 'inactive' };
    }
    await getLiveCategories(c);
    const { total } = await countLiveStreams(c);
    if (!total) return { ok: false, error: 'empty' };
    return { ok: true, channels: total };
  } catch (e) {
    return { ok: false, error: failure(e) };
  }
}
