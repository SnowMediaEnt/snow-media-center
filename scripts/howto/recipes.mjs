// How-to capture: how to reach each screenshot with the remote, one recipe
// per shot in src/data/howtoContract.ts (plan-howto.md §1c and §4.5).
//
//   { id, start, keys, ready, bg?, seed?, startReady?, settle? }
//   start   'home' (the app on Home, demo data) or 'stage' (/howto-stage,
//           the dev-only page that draws one component with made-up props)
//   keys    what the remote presses, in order:
//             'ArrowDown'             one press ('ArrowDown*3': three)
//             { hold: 'Enter' }       hold OK (800 ms)
//             { type: 'sum' }         type on the keyboard
//             { wait: 1500 }          let it load
//             { waitFor: 'css' }      until that is on screen
//             { press, until, arg, max }  press until until(arg) is true in the page
//             { scrollTo: 'css' }     scroll that into view (only where the remote can't);
//                                     block: 'start' puts it at the top, margin px below it (less if negative)
//           or a function (lang) => keys, for a path that depends on the language
//   ready   on screen when the picture can be taken (a data-howto hook)
//   bg      stage shots: the shot whose picture is drawn behind the dialog
//   seed    { layout: false } Live TV's look not chosen yet (first visit)
//           { pick: true }    nobody picked on "Who's watching?" yet
//   settle  extra ms before the picture (after ready and the fonts)

const hook = (id) => `[data-howto="${id}"]`;

/** Start points. */
export const START_READY = { home: '[data-home-card="0"]', stage: '#root > *' };

// Home → a card. The cards are Live TV, Plex, Support, Store; focus starts on Live TV.
const LIVE = ['Enter', { wait: 4500 }];
const PLEX = ['ArrowRight', 'Enter', { wait: 5000 }];
const SUPPORT = ['ArrowRight*2', 'Enter', { wait: 2500 }];
// Up twice reaches the header on Dashboard; Right is Settings, then Voice.
const DASHBOARD = ['ArrowUp*2', 'Enter', { wait: 2500 }];
const SETTINGS = ['ArrowUp*2', 'ArrowRight', 'Enter', { wait: 1500 }];
// In Live TV, Left opens the side menu: Live TV, Guide, Game Day, Recordings, VOD, Multi-Screen, Snow Originals, Backups.
const liveSection = (n) => [...LIVE, 'ArrowLeft', ...(n ? [`ArrowDown*${n}`] : []), 'Enter', { wait: 3000 }];
// In Support: Down reaches the tabs (Help, AI Chat, Posts), Down again the
// Help grid, two per row (Support.tsx HELP_IDS): How to use SMC | Speedtest,
// Buffering Guide | Device check, Support Videos | Submit a Ticket,
// Remote Access | Device Cleaner, Main Apps.
const helpCard = (row, col) => [...SUPPORT, `ArrowDown*${row + 2}`, ...(col ? ['ArrowRight'] : []), 'Enter', { wait: 2500 }];
/** The remote rests on this hook. */
const focusedOn = (id) => ({ press: 'ArrowDown', until: (h) => document.querySelector(`[data-howto="${h}"][data-focused="true"]`) != null, arg: id, max: 14 });

/** Settings: Down the menu until a row has the highlight (the menu opens on its
 *  first row: My account, Home screen, Backgrounds, Profiles, Phone remote,
 *  Notifications, Language, Updates), then let its page come in beside it. */
const settingsRow = (id) => ({ press: 'ArrowDown', until: (row) => !!document.querySelector(`[data-settings-row="${row}"][data-focused="true"]`), arg: id, max: 12 });

export const RECIPES = [
  // ── Home ──
  { id: 'home', start: 'home', keys: [], ready: hook('home.cardLivetv') },
  { id: 'home-bar', start: 'home', keys: ['ArrowUp', 'ArrowRight', { wait: 800 }], ready: hook('home.recTile') },
  // OK held on the Live TV tile: its menu (Move, Change shortcut, Reset, Cancel).
  { id: 'home-tilemenu', start: 'home', keys: [{ hold: 'Enter', ms: 1100 }, { wait: 600 }], ready: hook('home.tileMove') },
  // Settings' menu stands in a column; the page beside it follows the highlight.
  { id: 'settings-remote', start: 'home', keys: [...SETTINGS, settingsRow('remote'), { wait: 2000 }], ready: hook('set.remoteQr') },

  // ── Live TV ──
  { id: 'live-signin', start: 'stage', keys: [{ wait: 800 }], ready: hook('signin.username') },
  // Right from the username field reaches "Sign in with a PIN"; OK opens the PIN screen.
  { id: 'live-pin', start: 'stage', stage: 'live-signin', keys: [{ wait: 800 }, 'ArrowRight', 'Enter', { wait: 800 }], ready: hook('signin.pinInput') },
  { id: 'live-layout', start: 'home', seed: { layout: false }, keys: ['Enter', { wait: 3000 }], ready: hook('live.layoutCards') },
  // Classic, both services, the Sports category, the second channel focused.
  { id: 'live-list', start: 'home', keys: [...LIVE, 'ArrowDown', 'ArrowRight', 'ArrowDown', { wait: 2000 }], ready: hook('live.channels'), settle: 600 },
  // Up from the first category reaches Search above the list.
  { id: 'live-search', start: 'home', keys: [...LIVE, { press: 'ArrowUp', until: () => !!document.querySelector('[data-howto="live.searchBtn"][data-focused="true"]'), max: 12 }, 'Enter', { wait: 600 }, { type: 'sum' }, { wait: 1500 }], ready: hook('live.searchBox') },
  { id: 'live-holdmenu', start: 'stage', bg: 'live-list', keys: [{ wait: 800 }], ready: hook('menu.report') },
  // The same dialog; OK on "Report a problem" (OK, OK) shows the reasons.
  { id: 'live-report', start: 'stage', bg: 'live-list', keys: [{ wait: 800 }, 'Enter', { wait: 400 }, 'Enter', { wait: 800 }], ready: hook('report.reasons') },
  { id: 'live-player', start: 'stage', keys: [{ wait: 1000 }], ready: hook('bar.rec') },
  { id: 'live-record', start: 'stage', bg: 'live-list', keys: [{ wait: 800 }], ready: hook('rec.start') },
  { id: 'guide', start: 'home', keys: [...liveSection(1), { wait: 1000 }], ready: hook('guide.grid') },
  { id: 'guide-record', start: 'stage', bg: 'guide', keys: [{ wait: 800 }], ready: hook('rec.programmes') },
  // Its list comes from the recorder's web fallback (stageFixtures) in a capture run.
  { id: 'recordings', start: 'home', keys: [...liveSection(3), { wait: 1500 }], ready: hook('recs.list') },
  { id: 'gameday', start: 'home', keys: [...liveSection(2), { wait: 1500 }], ready: hook('gd.game') },
  { id: 'gameday-game', start: 'home', keys: [...liveSection(2), { wait: 1500 }, 'Enter', { wait: 3500 }], ready: hook('gd.links') },
  { id: 'multi', start: 'stage', bg: 'live-list', keys: [{ wait: 800 }], ready: hook('multi.layouts') },
  { id: 'backups', start: 'home', keys: [...liveSection(7), { wait: 1000 }], ready: hook('backups.list') },
  // VOD opens on Movies or Series (Movies highlighted on a fresh box): OK
  // opens Movies, then Right goes into the posters (the first category's load waits for that).
  { id: 'vod', start: 'home', keys: [...liveSection(4), { waitFor: '[data-vod-kind="movies"]' }, 'Enter', { wait: 2000 }, 'ArrowRight', { wait: 2500 }], ready: `${hook('vod.grid')} img`, settle: 800 },
  { id: 'vod-holdmenu', start: 'stage', bg: 'vod', keys: [{ wait: 800 }], ready: hook('menu.report') },
  // Up from the side menu reaches the header: Back, Update Channels, Settings.
  // The menu is a little taller than the screen and follows the highlight:
  // down to Sign Out brings it on screen, then back up to Add service.
  { id: 'live-settings', start: 'home', keys: [...LIVE, 'ArrowLeft', 'ArrowUp', 'ArrowRight*2', 'Enter', { wait: 1500 },
    { press: 'ArrowDown', until: () => document.querySelector('[data-howto="hub.signOut"]')?.getAttribute('data-focused') === 'true', max: 10 },
    { press: 'ArrowUp', until: () => document.querySelector('[data-howto="hub.services"]')?.getAttribute('data-focused') === 'true', max: 8 },
    { wait: 600 }], ready: hook('hub.services') },
  // My Account beside the menu: Right goes into the page, the remote on "Show sign-in PIN"; OK shows the digits.
  { id: 'live-account', start: 'home', keys: [...LIVE, 'ArrowLeft', 'ArrowUp', 'ArrowRight*2', 'Enter', { wait: 1500 },
    focusedOn('hub.account'), { wait: 1200 }, 'ArrowRight', { wait: 600 },
    { press: 'ArrowDown', until: () => document.querySelector('[data-howto="acct.pinBtn"]')?.getAttribute('data-focused') === 'true', max: 6 },
    'Enter', { wait: 1500 }], ready: hook('acct.pin') },
  // Player beside the menu: Right goes into the page, Down to the Live buffer row.
  { id: 'live-player-page', start: 'home', keys: [...LIVE, 'ArrowLeft', 'ArrowUp', 'ArrowRight*2', 'Enter', { wait: 1500 },
    focusedOn('hub.player'), { wait: 1200 }, 'ArrowRight', { wait: 600 },
    { press: 'ArrowDown', until: () => document.querySelector('[data-howto="player.liveBuffer"]')?.getAttribute('data-focused') === 'true', max: 6 },
    { wait: 400 }], ready: hook('player.liveBuffer') },

  // ── Plex ──
  { id: 'plex-connect', start: 'stage', keys: [{ wait: 800 }], ready: hook('plexauth.connect') },
  { id: 'plex-link', start: 'stage', keys: [{ wait: 800 }], ready: hook('plexauth.code') },
  // Plex opens on the side menu; Right goes into Plex's own menu (Home first).
  { id: 'plex-home', start: 'home', keys: [...PLEX, 'ArrowRight', { wait: 1500 }], ready: hook('plex.continue'), settle: 600 },
  { id: 'plex-discover', start: 'home', keys: [...PLEX, 'ArrowRight', { wait: 800 }, 'ArrowDown', { wait: 3000 }], ready: hook('plex.discover'), settle: 600 },
  { id: 'plex-search', start: 'home', keys: [...PLEX, 'ArrowRight', { wait: 800 }, 'ArrowDown*2', 'Enter', { wait: 800 }, { type: 'star' }, { wait: 2000 }], ready: hook('plex.results'), settle: 600 },
  // Recently Added starts with Starfall Harbor, the movie with a 4K and a 1080p version.
  { id: 'plex-detail', start: 'home', keys: [...PLEX, 'ArrowRight', { wait: 800 }, 'ArrowRight', 'ArrowDown', 'Enter', { wait: 3000 }], ready: hook('detail.play'), settle: 600 },
  // Down from the buttons past the versions and the cast to the related rows.
  { id: 'plex-related', start: 'home', keys: [...PLEX, 'ArrowRight', { wait: 800 }, 'ArrowRight', 'ArrowDown', 'Enter', { wait: 3000 },
    { press: 'ArrowDown', until: () => document.querySelector('[data-plex-related-row] [data-focused="true"]') != null, max: 8 },
    { wait: 800 }], ready: hook('detail.related'), settle: 600 },
  { id: 'plex-player', start: 'stage', keys: [{ wait: 1000 }], ready: hook('pp.skip') },
  { id: 'plex-upnext', start: 'stage', keys: [{ wait: 1000 }], ready: hook('pp.upNext') },
  // The control bar is up: Subtitles is 3 to the right, Audio 2.
  { id: 'plex-subs', start: 'stage', keys: [{ wait: 1000 }, 'ArrowRight*3', 'Enter', { wait: 800 }], ready: hook('pp.getSubs') },
  { id: 'plex-audio', start: 'stage', keys: [{ wait: 1000 }, 'ArrowRight*2', 'Enter', { wait: 800 }], ready: hook('pp.fixAudio') },

  // ── Main Apps, Store, account ──
  // Main Apps opens on Featured; Down reaches the tabs, Right is All.
  { id: 'apps', start: 'home', keys: [...helpCard(4, 0), 'ArrowDown', 'ArrowRight', 'Enter', { wait: 1000 }], ready: hook('apps.grid') },
  { id: 'apps-detail', start: 'home', keys: [...helpCard(4, 0), 'ArrowDown', 'ArrowRight', 'Enter', { wait: 800 }, 'ArrowDown', 'Enter', { wait: 1500 }], ready: hook('apps.download') },
  // The Store opens on "Build a setup"; Right, OK is the Devices shelf.
  { id: 'store', start: 'home', keys: ['ArrowRight*3', 'Enter', { wait: 3000 }, 'ArrowRight', 'Enter', { wait: 1500 }], ready: hook('store.grid') },
  // Dashboard: Down reaches Purchase Snow Gems.
  { id: 'gems', start: 'home', keys: [...DASHBOARD, 'ArrowDown', 'Enter', { wait: 2500 }], ready: hook('gems.packs') },
  // OK on a pack shows its pay code.
  { id: 'gems-qr', start: 'home', keys: [...DASHBOARD, 'ArrowDown', 'Enter', { wait: 2500 }, 'ArrowDown', 'Enter', { wait: 2500 }], ready: hook('gems.qr') },
  { id: 'dashboard', start: 'home', keys: [...DASHBOARD], ready: hook('dash.player') },

  // ── Support ──
  { id: 'support-help', start: 'home', keys: [...SUPPORT], ready: hook('sup.helpTab') },
  { id: 'support-ai', start: 'home', keys: [...SUPPORT, 'ArrowDown', 'ArrowRight', 'Enter', { wait: 1500 }], ready: hook('ai.input') },
  { id: 'support-posts', start: 'home', keys: [...SUPPORT, 'ArrowDown', 'ArrowRight*2', 'Enter', { wait: 1500 }], ready: hook('posts.list') },
  { id: 'voice', start: 'home', keys: ['ArrowUp*2', 'ArrowRight*2', 'Enter', { wait: 2500 }], ready: hook('voice.mic') },
  { id: 'tickets', start: 'home', keys: [...helpCard(2, 1)], ready: hook('tickets.list') },
  // The scan runs by itself; the picture waits for its rating.
  { id: 'device-check', start: 'home', keys: [...helpCard(1, 1), { waitFor: '[data-device-scan-overall]:not([data-device-scan-overall="none"])' }, { wait: 1200 }], ready: hook('ds.picks'), settle: 400 },
  // The speed test starts by itself; the picture is taken when it is done.
  { id: 'speedtest', start: 'home', keys: [...helpCard(0, 1), { wait: 26000 }], ready: hook('speed.start') },
  { id: 'buffering', start: 'home', keys: [...helpCard(1, 0)], ready: hook('bg.steps') },
  { id: 'videos', start: 'home', keys: [...helpCard(2, 0), { wait: 1000 }], ready: hook('videos.grid'), settle: 600 },

  // ── Settings and profiles ──
  // The menu with My account beside it (the Updates row is in the menu).
  { id: 'settings-ui', start: 'home', keys: [...SETTINGS, { wait: 1000 }], ready: hook('set.updatesTab') },
  // Home screen, the remote on "Content bar: show from" (Right into the page, Down one row).
  { id: 'settings-home', start: 'home', keys: [...SETTINGS, settingsRow('home'), { wait: 800 }, 'ArrowRight', 'ArrowDown', { wait: 600 }], ready: hook('set.barSource') },
  // Notifications, the remote on Post notifications: its two switches, with the
  // Home screen row (where the content bar's switch lives) in the menu beside them.
  { id: 'settings-switches', start: 'home', keys: [...SETTINGS, settingsRow('notifications'), 'ArrowRight', { wait: 800 }], ready: hook('set.alerts') },
  {
    id: 'settings-language', start: 'home',
    // OK on Language puts the remote on the language in use.
    keys: (lang) => [...SETTINGS, settingsRow('language'), 'ArrowRight',
      { waitFor: `[data-settings-focus="ui-language-${lang}"][data-focused="true"]` },
      { wait: 600 }],
    ready: hook('set.language'),
  },
  { id: 'settings-media', start: 'home', keys: [...SETTINGS, settingsRow('backgrounds'), { wait: 1500 }], ready: hook('set.wallpaper') },
  { id: 'profiles-pick', start: 'home', seed: { pick: true }, startReady: 'body', keys: [{ wait: 3000 }], ready: hook('prof.list') },
  // Manage profiles → Kids → its PIN (1234, see seed.mjs) → the editor.
  { id: 'profile-edit', start: 'home', seed: { pick: true }, startReady: 'body', keys: [{ wait: 3000 }, 'ArrowDown', 'Enter', { wait: 1500 }, 'ArrowRight*2', 'Enter', { wait: 1500 }, { type: '1234' }, { wait: 2000 },
    // The PIN button sits just under the fold; the highlight stays on the name.
    { scrollTo: hook('prof.pinBtn') }, { wait: 400 }], ready: hook('prof.kidsLevel') },
];

/** --review: open the guide from Support (How to use SMC), open chapter n, then Right through its slides. */
export const REVIEW_GUIDE = {
  open: [...SUPPORT, 'ArrowDown*2', 'Enter', { wait: 1500 }],
  maxChapters: 10,
  openChapter: (n) => [...(n ? [`ArrowDown*${n}`] : []), 'Enter', { wait: 800 }],
  next: ['ArrowRight'],
};
