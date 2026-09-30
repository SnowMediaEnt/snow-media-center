// The How-to guide's shared contract (plan: .claude/plan-howto.md, section 1).
// The single list of screenshots and the areas each one can highlight. Only
// the orchestrator changes it; the capture script, the picture view and the
// chapters all read it.

export const HOWTO_LANGS = ['en', 'es', 'fr', 'de', 'ar'] as const;
export type HowtoLang = (typeof HOWTO_LANGS)[number];
export type RemoteHint = 'ok' | 'holdOk' | 'back' | 'upDown' | 'leftRight';

/** Drawn in code (no screenshot): only 'remote'. */
export const HOWTO_DIAGRAMS = { remote: ['remote.arrows', 'remote.ok', 'remote.back', 'remote.home', 'remote.mic'] } as const;

/** Shot id -> the highlight ids it can show. A highlight id is a DOM hook,
 *  data-howto="<id>"; several elements with one id are measured as one box. */
export const HOWTO_SHOTS = {
  'home': ['home.clock', 'home.profile', 'home.dashboard', 'home.settings', 'home.voice', 'home.ticker', 'home.recommended', 'home.cards', 'home.cardLivetv', 'home.cardPlex', 'home.cardSupport', 'home.cardStore'], // Home, focus on Live TV card
  'home-bar': ['home.recommended', 'home.recTile', 'home.recArrows', 'home.recDots'], // Home, focus in Recommended (2nd tile)
  'settings-remote': ['set.remoteQr', 'set.remoteCode', 'set.remoteSteps'], // Settings → Phone Remote
  'live-signin': ['signin.username', 'signin.password', 'signin.submit', 'signin.note'], // stage (CredentialsForm)
  'live-layout': ['live.layoutCards'], // Live TV, first visit (layout chooser)
  'live-list': ['live.back', 'live.updateChannels', 'live.settingsBtn', 'live.sections', 'live.lineGroup', 'live.categories', 'live.favorites', 'live.searchBtn', 'live.recordingsBtn', 'live.channels', 'live.preview', 'live.nowNext'], // Live TV, Classic, 2 services, "Sports" category, channel 2 focused
  'live-search': ['live.searchBox', 'live.channels'], // Live TV, Search open, "sum" typed
  'live-holdmenu': ['menu.favorite', 'menu.report', 'menu.record'], // stage over live-list (ReportChannelDialog with Record row)
  'live-report': ['report.reasons'], // stage, same dialog on "Report a problem"
  'live-player': ['bar.root', 'bar.channel', 'bar.timeline', 'bar.prev', 'bar.rew', 'bar.play', 'bar.fwd', 'bar.golive', 'bar.next', 'bar.rec', 'bar.report', 'bar.cc', 'bar.audio', 'bar.vol', 'bar.label'], // stage (PlayerControlBar: rewind + record on, focus Record, 45 s behind)
  'live-record': ['rec.length', 'rec.saveTo', 'rec.start'], // stage over live-list (RecordDialog)
  'guide': ['guide.categories', 'guide.channels', 'guide.grid'], // Live TV → Guide
  'guide-record': ['rec.programmes', 'rec.start'], // stage over guide (RecordDialog, programme mode)
  'recordings': ['recs.list', 'recs.scheduled', 'recs.drive'], // stage over live-list (RecordingsScreen)
  'gameday': ['gd.chips', 'gd.game', 'gd.remind'], // Live TV → Game Day
  'gameday-game': ['gd.links', 'gd.serviceTag', 'gd.picked', 'gd.down', 'gd.unconfirmed', 'gd.holdHint'], // Game Day, first game opened
  'multi': ['multi.layouts'], // stage (Multi-Screen layout picker)
  'backups': ['backups.list', 'backups.refresh'], // Live TV → Backups
  'vod': ['vod.categories', 'vod.grid'], // Live TV → VOD
  'live-settings': ['hub.switch', 'hub.hideCats', 'hub.appearance', 'hub.rewind', 'hub.signOut'], // Live TV → Settings (hub menu)
  'plex-connect': ['plexauth.connect', 'plexauth.ownServer'], // stage (PlexAuthScreen, signed out, line saved)
  'plex-link': ['plexauth.code', 'plexauth.url'], // stage (PlexAuthScreen, link code)
  'plex-home': ['plex.menu', 'plex.continue', 'plex.recent'], // Plex card → Plex Home
  'plex-discover': ['plex.discover'], // Plex → Discover
  'plex-search': ['plex.searchBox', 'plex.results'], // Plex → Search, "star" typed
  'plex-detail': ['detail.play', 'detail.myList', 'detail.version', 'detail.cast'], // Plex, a movie with 2 versions
  'plex-player': ['pp.skip', 'pp.seek', 'pp.controls', 'pp.subs', 'pp.audio'], // stage (PlexPlayerOverlay, Skip Intro prompt, controls shown)
  'plex-upnext': ['pp.upNext'], // stage (Up next prompt)
  'plex-subs': ['pp.getSubs'], // stage (Subtitles menu open)
  'plex-audio': ['pp.fixAudio'], // stage (Audio menu open)
  'apps': ['apps.grid'], // Support → Main Apps
  'apps-detail': ['apps.download'], // Main Apps, OK on an app
  'store': ['store.grid'], // Home → Store
  'gems': ['gems.packs', 'gems.qr'], // Dashboard → Snow Gems (view `credits`)
  'dashboard': ['dash.player', 'dash.services', 'dash.gems', 'dash.games', 'dash.signOut'], // Home → Dashboard (demo signed-in user)
  'support-help': ['sup.helpTab', 'sup.aiTab', 'sup.postsTab', 'sup.howto', 'sup.speed', 'sup.guide', 'sup.videos', 'sup.tickets', 'sup.remote', 'sup.cleaner', 'sup.apps'], // Support, Help tab
  'support-ai': ['ai.input'], // Support, AI Chat tab
  'support-posts': ['posts.list'], // Support, Posts tab
  'voice': ['voice.mic'], // Home, voice panel open (listening)
  'tickets': ['tickets.new', 'tickets.list'], // Support → Submit a Ticket
  'speedtest': ['speed.start'], // Support → Speedtest (before Start)
  'buffering': ['bg.steps'], // Support → Buffering Guide, step 1
  'videos': ['videos.grid'], // Support → Support Videos
  'settings-ui': ['set.tabs', 'set.updatesTab', 'set.contentBar', 'set.postNotify', 'set.alerts'], // Settings → UI (top)
  'settings-language': ['set.language'], // Settings → UI, scrolled to Language, current language focused
  'settings-media': ['set.wallpaper'], // Settings → Media Manager
  'profiles-pick': ['prof.list', 'prof.kids', 'prof.manage'], // "Who's watching?" (Me, Sam, Kids profile with PIN)
  'profile-edit': ['prof.kidsLevel', 'prof.pinBtn'], // Manage profiles → edit the Kids profile
} as const;

export type ShotId = keyof typeof HOWTO_SHOTS | keyof typeof HOWTO_DIAGRAMS;
/** `id` must be in the shot's list. */
export interface HowtoHighlight { id: string; labelKey: string }
/** 0-3 highlights. */
export interface HowtoArt { shot: ShotId; highlights?: HowtoHighlight[]; remote?: RemoteHint }
/** [left, top, width, height] in percent of the frame, 2 decimals. */
export type ShotRect = [number, number, number, number];
export interface HowtoRectsFile {
  version: 1; width: 1024; height: 576;
  langs: Partial<Record<HowtoLang, Record<string, { bytes: number; rects: Record<string, ShotRect> }>>>;
}

/** public/howto/<lang>/<shot>.webp */
export const HOWTO_IMAGE_DIR = 'howto';
/** DOM hook: data-howto="<highlight id>" */
export const HOWTO_ATTR = 'data-howto';
