// Which sound track a Live TV film or episode starts on (VodPlayer, native player).
//
// A film from the line's panel often carries several sound tracks (English
// 5.1, a dub, commentary). The player's own choice is the track the file
// marks as its default, which is usually the first. When the viewer's
// language is there too and isn't the one playing, switch to it once, at the
// start; otherwise leave the player's choice alone.
import type { VideoTrackInfo } from '@/components/livetv/VideoPlayer';

// ISO 639-2 (three letters, both the B and T forms) for the app's languages
// and a few common dubs. Media3 already turns most of these into two letters;
// files and panels that slip through still match.
const THREE_TO_TWO: Record<string, string> = {
  eng: 'en', spa: 'es', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', ara: 'ar',
  ita: 'it', por: 'pt', nld: 'nl', dut: 'nl', tur: 'tr', rus: 'ru', pol: 'pl',
  hin: 'hi', jpn: 'ja', kor: 'ko', zho: 'zh', chi: 'zh',
};

/** "en", "en-US", "eng", "ENG" → "en". Empty for no language or "und". */
export function baseLanguage(code: string | null | undefined): string {
  const first = String(code ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (!first || first === 'und' || first === 'mul' || first === 'zxx') return '';
  return THREE_TO_TWO[first] ?? first;
}

/**
 * The index of the track to switch to, or null to keep what is playing:
 * with one track or none, when the playing one is already in `lang`, or when
 * no track is in `lang` (the file's own default, normally the first, stays).
 */
export function pickAudioTrack(tracks: readonly VideoTrackInfo[], lang: string): number | null {
  if (tracks.length < 2) return null;
  const want = baseLanguage(lang);
  if (!want) return null;
  const active = tracks.find((t) => t.active);
  if (active && baseLanguage(active.language) === want) return null;
  const match = tracks.find((t) => baseLanguage(t.language) === want);
  return match ? match.id : null;
}
