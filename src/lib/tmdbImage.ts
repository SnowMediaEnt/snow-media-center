// Poster URLs from panels and admins are often TMDB "original" images —
// about 2000x3000, ≈24 MB once decoded — shown in a card 150-250 px wide.
// Chromium 66 ignores loading="lazy", so every mounted card decodes at once.
// TMDB serves the same picture at fixed widths; ask for one near the card.
// Anything that is not a TMDB URL is returned untouched.
export function tmdbSized(url: string | undefined | null, width: 'w185' | 'w342' | 'w500' = 'w342'): string | undefined {
  if (!url) return undefined;
  return url.replace(/(image\.tmdb\.org\/t\/p\/)(original|w\d{3,4})\//, (m, base: string, size: string) => {
    if (size === 'original') return `${base}${width}/`;
    const have = Number(size.slice(1));
    const want = Number(width.slice(1));
    return have > want ? `${base}${width}/` : m;
  });
}
