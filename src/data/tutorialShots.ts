/**
 * Real screenshots for the "How to use SMC" tutorial.
 *
 * Drop JPGs into src/assets/tutorial/ and register them below. Expected filenames:
 *   home.jpg, support.jpg, chooser.jpg, store.jpg, livetv.jpg, controls.jpg,
 *   guide.jpg, multiscreen.jpg, plex-grid.jpg, plex-code.jpg, apps.jpg, settings.jpg
 *
 * Example:
 *   import home from '@/assets/tutorial/home.jpg';
 *   export const TUTORIAL_SHOTS = { home };
 *
 * Any screen without an entry automatically falls back to the schematic mock.
 */
export const TUTORIAL_SHOTS: Partial<Record<string, string>> = {};

/** Spotlight windows, in PERCENT of the screenshot frame: screen -> highlight -> rect. */
export const SPOT_RECTS: Record<
  string,
  Record<string, { left: number; top: number; width: number; height: number }>
> = {
  home: {
    header: { left: 82, top: 1, width: 17, height: 9 },
    ticker: { left: 0, top: 10, width: 100, height: 7 },
    contentbar: { left: 2, top: 35, width: 96, height: 24 },
    cards: { left: 9, top: 61, width: 82, height: 27 },
    'player-card': { left: 71, top: 61, width: 20, height: 27 },
  },
  support: {
    'ai-tab': { left: 37, top: 12, width: 26, height: 8 },
    howto: { left: 27, top: 25, width: 46, height: 10 },
    speedtest: { left: 27, top: 37, width: 46, height: 10 },
    'guide-card': { left: 27, top: 48, width: 46, height: 10 },
    videos: { left: 27, top: 59, width: 46, height: 10 },
    tickets: { left: 27, top: 70, width: 46, height: 10 },
  },
  chooser: {
    'movies-card': { left: 50, top: 36, width: 26, height: 33 },
  },
  store: {
    grid: { left: 7, top: 42, width: 87, height: 54 },
  },
  livetv: {
    list: { left: 24, top: 18, width: 50, height: 76 },
    sidebar: { left: 1, top: 12, width: 21, height: 82 },
  },
  controls: {
    bar: { left: 10, top: 78, width: 80, height: 16 },
    'subs-menu': { left: 12, top: 40, width: 26, height: 36 },
    'audio-menu': { left: 62, top: 40, width: 26, height: 36 },
  },
  guide: {
    grid: { left: 2, top: 12, width: 96, height: 84 },
  },
  multiscreen: {
    tiles: { left: 2, top: 4, width: 96, height: 92 },
  },
  'plex-grid': {
    tabs: { left: 2, top: 2, width: 96, height: 9 },
    'settings-tab': { left: 84, top: 2, width: 14, height: 9 },
    grid: { left: 2, top: 14, width: 96, height: 82 },
  },
  'plex-code': {
    code: { left: 33, top: 34, width: 34, height: 26 },
  },
  apps: {
    grid: { left: 4, top: 8, width: 92, height: 86 },
    popup: { left: 30, top: 28, width: 40, height: 44 },
    pin: { left: 60, top: 10, width: 10, height: 12 },
  },
  settings: {
    appearance: { left: 30, top: 48, width: 40, height: 12 },
    accounts: { left: 30, top: 34, width: 40, height: 12 },
  },
};
