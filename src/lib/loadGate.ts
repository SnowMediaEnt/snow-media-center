// Global pause gate for background loading (Plex library paging). While a
// detail page or the player owns the screen, background fetch loops park on
// waitForResume() instead of competing with foreground loads for the PMS
// socket pool. Pages already fetched stay in state/cache — pausing only
// stops the NEXT page. The gate can never dead-lock: every waitForResume()
// sits inside a loop whose exit conditions (cancelled / seq / loaded<total)
// are re-checked immediately after resume, and resumeLoading() is guaranteed
// by closeDetail() and by PlexSection's unmount cleanup.
let paused = false;
let waiters: Array<() => void> = [];

export function pauseLoading(): void { paused = true; }

export function resumeLoading(): void {
  if (!paused) return;
  paused = false;
  const w = waiters;
  waiters = [];
  for (const r of w) r();
}

export function isLoadingPaused(): boolean { return paused; }

export function waitForResume(): Promise<void> {
  if (!paused) return Promise.resolve();
  return new Promise<void>((r) => { waiters.push(r); });
}
