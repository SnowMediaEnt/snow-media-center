export const arcadeStorageKey = (userId: string, game: string) => `smc-arcade-session-v2:${userId}:${game}`;
export function readArcadeSession(userId: string, game: string): string | undefined {
  try { return localStorage.getItem(arcadeStorageKey(userId, game)) ?? undefined; } catch { return undefined; }
}
export function saveArcadeSession(userId: string, game: string, id?: string): void {
  try {
    if (id) localStorage.setItem(arcadeStorageKey(userId, game), id);
    else localStorage.removeItem(arcadeStorageKey(userId, game));
  } catch { /* Server sessions can still be resumed when storage is disabled. */ }
}
export function arcadeError(error?: string): string {
  if (error === 'insufficient_balance') return 'Not enough Snow Coins. Choose a smaller bet or claim your Daily Spin.';
  if (error === 'round_expired') return 'This saved round expired after 24 hours. Start a new round.';
  if (error === 'game_update_required') return 'Update Snow Media Center to play this game with Snow Coins.';
  return 'Connection interrupted. Try again to recover the same round.';
}
