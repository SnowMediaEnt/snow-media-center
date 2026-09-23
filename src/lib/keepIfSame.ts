// Keep the previous value when a refetch returns the same thing.
//
// A poll or a realtime refetch that sets a freshly parsed array re-renders
// every consumer even when nothing changed. For the alert lists and the
// stored player account that meant re-rendering the Player — and with it
// all of Plex — on every admin edit to any alert and every account refresh.
// The values are small, so a JSON comparison is cheap next to that.
export function keepIfSame<T>(prev: T, next: T): T {
  if (prev === next) return prev;
  try {
    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
  } catch {
    return next;
  }
}
