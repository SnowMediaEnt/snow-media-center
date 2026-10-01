// Quality / region tags providers put in channel names. They say nothing about
// which channel it is, so they never make an initial.
const NOISE = /^(hd|fhd|uhd|sd|4k|hevc|raw|h265|us|usa|uk|ca)$/i;

/** One or two letters for a channel with no logo: "A&E" -> "AE", "US| ESPN HD"
 *  -> "ES", "Golf Channel" -> "GC". Empty when the name has no letters/digits. */
export function channelInitials(name: string | undefined): string {
  if (!name) return '';
  // "US| ESPN", "UK: BBC One": drop a leading country/provider prefix.
  const bare = name.replace(/^[^|:]{1,12}[|:]\s*/, '');
  const words = bare.split(/[\s|:_-]+/).filter((w) => /[\p{L}\p{N}]/u.test(w) && !NOISE.test(w));
  if (!words.length) return '';
  const letters = (w: string) => w.replace(/[^\p{L}\p{N}]/gu, '');
  const first = words[0];
  const out = words.length > 1 ? letters(first).charAt(0) + letters(words[1]).charAt(0) : letters(first).slice(0, 2);
  return out.toUpperCase();
}
