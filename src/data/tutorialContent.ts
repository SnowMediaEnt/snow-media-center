import type { LucideIcon } from 'lucide-react';
import {
  Baby,
  BadgeCheck,
  BellRing,
  Bot,
  CalendarClock,
  CalendarDays,
  Captions,
  ChevronsUpDown,
  CircleDot,
  CircleHelp,
  Clapperboard,
  Cog,
  Compass,
  Dices,
  Download,
  FastForward,
  Film,
  Flag,
  Gamepad2,
  Gauge,
  Gem,
  HardDrive,
  Home,
  Info,
  KeyRound,
  Languages,
  Layers,
  LayoutGrid,
  LifeBuoy,
  Link,
  Link2,
  List,
  LogOut,
  Menu,
  MessageCircle,
  Mic,
  MonitorPlay,
  Newspaper,
  Palette,
  Play,
  RefreshCw,
  Rewind,
  Search,
  Settings,
  ShoppingBag,
  SkipForward,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Star,
  ToggleRight,
  Trophy,
  Tv,
  Users,
  Video,
  VolumeX,
  Wallet,
} from 'lucide-react';
import type { HowtoArt, HowtoHighlight, RemoteHint, ShotId } from '@/data/howtoContract';

// The words are translation keys (guides.howTo.<chapter>.<slide>.title | line2 | linkBtn):
// this file is read once at start-up, so the screen calls t(key) when it draws, and the
// text follows the language. The pictures are named in howtoContract.ts; a highlight's
// label is guides.howTo.labels.<labelId>.
export type TutorialDeepLink =
  | { kind: 'view'; view: string; labelKey: string }
  | { kind: 'event'; event: string; labelKey: string }
  /** Straight into Live TV or Plex, as Home's cards open them. */
  | { kind: 'player'; section: 'live' | 'movies'; labelKey: string };

export interface TutorialSlide {
  id: string;
  icon: LucideIcon;
  titleKey: string;
  line2Key?: string;
  deepLink?: TutorialDeepLink;
  art: HowtoArt;
}

export interface TutorialChapter {
  id: string;
  titleKey: string;
  subtitleKey: string;
  icon: LucideIcon;
  color: string; // tailwind classes for the chapter card accents
  slides: TutorialSlide[];
}

type LinkSpec =
  | { kind: 'view'; view: string }
  | { kind: 'event'; event: string }
  | { kind: 'player'; section: 'live' | 'movies' };

const h = (id: string, label: string): HowtoHighlight => ({ id, labelKey: 'guides.howTo.labels.' + label });

/** One slide: its text keys follow from the chapter and slide ids. */
const slide = (
  chapter: string,
  id: string,
  icon: LucideIcon,
  shot: ShotId,
  highlights: HowtoHighlight[],
  opts: { line2?: boolean; remote?: RemoteHint; link?: LinkSpec } = {},
): TutorialSlide => {
  const base = 'guides.howTo.' + chapter + '.' + id;
  return {
    id,
    icon,
    titleKey: base + '.title',
    line2Key: opts.line2 ? base + '.line2' : undefined,
    deepLink: opts.link ? { ...opts.link, labelKey: base + '.linkBtn' } : undefined,
    art: { shot, highlights, remote: opts.remote },
  };
};

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  {
    id: 'basics',
    titleKey: 'guides.howTo.basics.title',
    subtitleKey: 'guides.howTo.basics.subtitle',
    icon: Compass,
    color: 'bg-cyan-700/60 border-cyan-400/70 text-cyan-100',
    slides: [
      slide('basics', 'remote', Gamepad2, 'remote', [h('remote.arrows', 'move'), h('remote.ok', 'okHold'), h('remote.back', 'back')], { line2: true }),
      slide('basics', 'phone', Smartphone, 'settings-remote', [h('set.remoteQr', 'scanPhone'), h('set.remoteCode', 'orCode')], { line2: true, link: { kind: 'view', view: 'settings' } }),
      slide('basics', 'home', Home, 'home', [h('home.cardLivetv', 'liveTv'), h('home.cardPlex', 'plexVod'), h('home.cardSupport', 'help')], { line2: true }),
      slide('basics', 'topbar', Settings, 'home', [h('home.clock', 'dateTime'), h('home.profile', 'whoWatching'), h('home.settings', 'settings')], { line2: true, remote: 'upDown' }),
      slide('basics', 'dashVoice', Mic, 'home', [h('home.dashboard', 'dashboard'), h('home.voice', 'voice')], { line2: true }),
      slide('basics', 'ticker', Newspaper, 'home', [h('home.ticker', 'news')], { line2: true }),
      slide('basics', 'recommended', Film, 'home-bar', [h('home.recTile', 'okPlays'), h('home.recArrows', 'more'), h('home.recDots', 'pages')], { line2: true, remote: 'leftRight' }),
    ],
  },
  {
    id: 'livetv',
    titleKey: 'guides.howTo.livetv.title',
    subtitleKey: 'guides.howTo.livetv.subtitle',
    icon: Tv,
    color: 'bg-brand-gold/20 border-brand-gold/70 text-brand-gold',
    slides: [
      slide('livetv', 'open', Tv, 'home', [h('home.cardLivetv', 'liveTv')], { line2: true, remote: 'ok', link: { kind: 'player', section: 'live' } }),
      slide('livetv', 'signin', KeyRound, 'live-signin', [h('signin.username', 'username'), h('signin.password', 'password'), h('signin.submit', 'signIn')], { line2: true }),
      slide('livetv', 'services', Layers, 'live-list', [h('live.lineGroup', 'yourServices')], { line2: true }),
      slide('livetv', 'layout', LayoutGrid, 'live-layout', [h('live.layoutCards', 'pickOne')], { line2: true, remote: 'leftRight' }),
      slide('livetv', 'menu', Menu, 'live-list', [h('live.sections', 'menu')], { line2: true }),
      slide('livetv', 'categories', List, 'live-list', [h('live.categories', 'categories'), h('live.favorites', 'favorites'), h('live.channels', 'channels')], { line2: true }),
      slide('livetv', 'preview', Play, 'live-list', [h('live.preview', 'preview'), h('live.nowNext', 'whatsOn')], { line2: true, remote: 'ok' }),
      slide('livetv', 'search', Search, 'live-search', [h('live.searchBox', 'typeHere'), h('live.channels', 'results')], { line2: true }),
      slide('livetv', 'holdMenu', Star, 'live-holdmenu', [h('menu.favorite', 'favorite'), h('menu.report', 'report'), h('menu.record', 'record')], { line2: true, remote: 'holdOk' }),
      slide('livetv', 'report', Flag, 'live-report', [h('report.reasons', 'whatsWrong')], { line2: true }),
    ],
  },
  {
    id: 'watching',
    titleKey: 'guides.howTo.watching.title',
    subtitleKey: 'guides.howTo.watching.subtitle',
    icon: MonitorPlay,
    color: 'bg-sky-700/60 border-sky-400/70 text-sky-100',
    slides: [
      slide('watching', 'bar', Play, 'live-player', [h('bar.root', 'playerBar'), h('bar.label', 'buttonName')], { line2: true, remote: 'ok' }),
      slide('watching', 'channels', ChevronsUpDown, 'live-player', [h('bar.prev', 'chDown'), h('bar.next', 'chUp')], { line2: true, remote: 'upDown' }),
      slide('watching', 'barButtons', Captions, 'live-player', [h('bar.report', 'report'), h('bar.cc', 'subtitles'), h('bar.audio', 'audio')], { line2: true }),
      slide('watching', 'top', RefreshCw, 'live-list', [h('live.updateChannels', 'updateChannels'), h('live.settingsBtn', 'settings')], { line2: true }),
      slide('watching', 'settings', Settings, 'live-settings', [h('hub.switch', 'switchAccount'), h('hub.hideCats', 'hideCategories'), h('hub.appearance', 'appearance')], { line2: true }),
      slide('watching', 'vod', Film, 'vod', [h('vod.categories', 'categories'), h('vod.grid', 'movies')], { line2: true }),
      slide('watching', 'multi', LayoutGrid, 'multi', [h('multi.layouts', 'pickLayout')], { line2: true }),
      slide('watching', 'backups', LifeBuoy, 'backups', [h('backups.list', 'backups'), h('backups.refresh', 'refresh')], { line2: true }),
    ],
  },
  {
    id: 'recording',
    titleKey: 'guides.howTo.recording.title',
    subtitleKey: 'guides.howTo.recording.subtitle',
    icon: CircleDot,
    color: 'bg-red-700/60 border-red-400/70 text-red-100',
    slides: [
      slide('recording', 'guide', CalendarDays, 'guide', [h('guide.categories', 'categories'), h('guide.channels', 'channels'), h('guide.grid', 'nowNext')], { line2: true }),
      slide('recording', 'rewind', Rewind, 'live-player', [h('bar.rew', 'back10'), h('bar.timeline', 'howFar'), h('bar.golive', 'goLive')], { line2: true }),
      slide('recording', 'record', CircleDot, 'live-record', [h('rec.length', 'howLong'), h('rec.saveTo', 'saveTo'), h('rec.start', 'start')], { line2: true, remote: 'holdOk' }),
      slide('recording', 'schedule', CalendarClock, 'guide-record', [h('rec.programmes', 'pickShow'), h('rec.start', 'recordIt')], { line2: true, remote: 'holdOk' }),
      slide('recording', 'recordings', HardDrive, 'recordings', [h('recs.list', 'yourRecordings'), h('recs.scheduled', 'scheduled'), h('recs.drive', 'freeSpace')], { line2: true, remote: 'ok' }),
      slide('recording', 'settings', Settings, 'live-settings', [h('hub.rewind', 'rewindSettings')], { line2: true }),
    ],
  },
  {
    id: 'gameday',
    titleKey: 'guides.howTo.gameday.title',
    subtitleKey: 'guides.howTo.gameday.subtitle',
    icon: Trophy,
    color: 'bg-lime-700/60 border-lime-400/70 text-lime-100',
    slides: [
      slide('gameday', 'list', Trophy, 'gameday', [h('gd.chips', 'leagues'), h('gd.game', 'todaysGames')], { line2: true }),
      slide('gameday', 'links', Link2, 'gameday-game', [h('gd.links', 'whereOn'), h('gd.serviceTag', 'whichService')], { line2: true, remote: 'ok' }),
      slide('gameday', 'picked', BadgeCheck, 'gameday-game', [h('gd.picked', 'ourPick'), h('gd.down', 'reportedDown')], { line2: true }),
      slide('gameday', 'unconfirmed', CircleHelp, 'gameday-game', [h('gd.unconfirmed', 'mayNotHave')], { line2: true }),
      slide('gameday', 'report', Flag, 'gameday-game', [h('gd.holdHint', 'holdToReport')], { line2: true, remote: 'holdOk' }),
      slide('gameday', 'remind', BellRing, 'gameday', [h('gd.remind', 'remindMe')]),
    ],
  },
  {
    id: 'movies',
    titleKey: 'guides.howTo.movies.title',
    subtitleKey: 'guides.howTo.movies.subtitle',
    icon: Clapperboard,
    color: 'bg-purple-700/60 border-purple-400/70 text-purple-100',
    slides: [
      slide('movies', 'open', Clapperboard, 'home', [h('home.cardPlex', 'plexVod')], { line2: true, remote: 'ok', link: { kind: 'player', section: 'movies' } }),
      slide('movies', 'connect', Link, 'plex-connect', [h('plexauth.connect', 'pressThis')], { line2: true, remote: 'ok' }),
      slide('movies', 'code', KeyRound, 'plex-link', [h('plexauth.code', 'yourCode'), h('plexauth.url', 'goHere')], { line2: true }),
      slide('movies', 'menu', Menu, 'plex-home', [h('plex.menu', 'menu')], { line2: true }),
      slide('movies', 'home', Home, 'plex-home', [h('plex.continue', 'continueWatching'), h('plex.recent', 'newArrivals')]),
      slide('movies', 'discover', Compass, 'plex-discover', [h('plex.discover', 'ideas')], { line2: true }),
      slide('movies', 'search', Search, 'plex-search', [h('plex.searchBox', 'typeOrTalk'), h('plex.results', 'results')], { line2: true }),
      slide('movies', 'detail', Info, 'plex-detail', [h('detail.play', 'play'), h('detail.myList', 'myList'), h('detail.cast', 'cast')], { line2: true, remote: 'ok' }),
      slide('movies', 'versions', Layers, 'plex-detail', [h('detail.version', 'version')], { line2: true, remote: 'leftRight' }),
      slide('movies', 'controls', SlidersHorizontal, 'plex-player', [h('pp.controls', 'controls'), h('pp.seek', 'seekBar')], { line2: true, remote: 'ok' }),
      slide('movies', 'skip', FastForward, 'plex-player', [h('pp.skip', 'skipIntro')], { line2: true, remote: 'ok' }),
      slide('movies', 'next', SkipForward, 'plex-upnext', [h('pp.upNext', 'nextEpisode')], { line2: true, remote: 'ok' }),
      slide('movies', 'subs', Captions, 'plex-subs', [h('pp.getSubs', 'getSubs')]),
      slide('movies', 'audio', VolumeX, 'plex-audio', [h('pp.fixAudio', 'fixAudio')], { line2: true }),
    ],
  },
  {
    id: 'apps',
    titleKey: 'guides.howTo.apps.title',
    subtitleKey: 'guides.howTo.apps.subtitle',
    icon: Smartphone,
    color: 'bg-blue-700/60 border-blue-400/70 text-blue-100',
    slides: [
      slide('apps', 'where', Smartphone, 'support-help', [h('sup.apps', 'mainApps')], { line2: true, link: { kind: 'view', view: 'apps' } }),
      slide('apps', 'pick', LayoutGrid, 'apps', [h('apps.grid', 'apps')], { remote: 'ok' }),
      slide('apps', 'download', Download, 'apps-detail', [h('apps.download', 'download')], { line2: true }),
      slide('apps', 'store', ShoppingBag, 'store', [h('store.grid', 'products')], { line2: true, link: { kind: 'view', view: 'store' } }),
    ],
  },
  {
    id: 'support',
    titleKey: 'guides.howTo.support.title',
    subtitleKey: 'guides.howTo.support.subtitle',
    icon: LifeBuoy,
    color: 'bg-orange-700/60 border-orange-400/70 text-orange-100',
    slides: [
      slide('support', 'tabs', LifeBuoy, 'support-help', [h('sup.helpTab', 'help'), h('sup.aiTab', 'aiChat'), h('sup.postsTab', 'posts')]),
      slide('support', 'ai', Bot, 'support-ai', [h('ai.input', 'askAnything')], { line2: true }),
      slide('support', 'voice', Mic, 'voice', [h('voice.mic', 'talkNow')], { line2: true }),
      slide('support', 'tickets', MessageCircle, 'tickets', [h('tickets.new', 'newTicket'), h('tickets.list', 'yourTickets')], { line2: true, link: { kind: 'event', event: 'support:open-tickets' } }),
      slide('support', 'speed', Gauge, 'speedtest', [h('speed.start', 'start')], { line2: true, remote: 'ok' }),
      slide('support', 'buffering', CircleDot, 'buffering', [h('bg.steps', 'steps')], { link: { kind: 'event', event: 'support:open-buffering-guide' } }),
      slide('support', 'videos', Video, 'videos', [h('videos.grid', 'videos')]),
      slide('support', 'posts', Newspaper, 'support-posts', [h('posts.list', 'posts')], { line2: true, link: { kind: 'event', event: 'support:open-posts' } }),
      slide('support', 'more', Sparkles, 'support-help', [h('sup.remote', 'remoteAccess'), h('sup.cleaner', 'cleaner')], { line2: true, link: { kind: 'event', event: 'support:open-cleaner' } }),
    ],
  },
  {
    id: 'account',
    titleKey: 'guides.howTo.account.title',
    subtitleKey: 'guides.howTo.account.subtitle',
    icon: Wallet,
    color: 'bg-yellow-700/60 border-yellow-400/70 text-yellow-100',
    slides: [
      slide('account', 'dashboard', Users, 'dashboard', [h('dash.player', 'liveAccount'), h('dash.services', 'devices')], { line2: true, link: { kind: 'view', view: 'user' } }),
      slide('account', 'gems', Gem, 'dashboard', [h('dash.gems', 'snowGems')]),
      slide('account', 'buyGems', Gem, 'gems', [h('gems.packs', 'pickPack')], { line2: true, link: { kind: 'view', view: 'credits' } }),
      slide('account', 'payGems', Gem, 'gems-qr', [h('gems.qr', 'scanToPay')], { link: { kind: 'view', view: 'credits' } }),
      slide('account', 'signOut', LogOut, 'dashboard', [h('dash.signOut', 'signOut')], { line2: true }),
      slide('account', 'lounge', Dices, 'dashboard', [h('dash.games', 'gameLounge')], { line2: true, link: { kind: 'view', view: 'games' } }),
    ],
  },
  {
    id: 'extras',
    titleKey: 'guides.howTo.extras.title',
    subtitleKey: 'guides.howTo.extras.subtitle',
    icon: Cog,
    color: 'bg-emerald-700/60 border-emerald-400/70 text-emerald-100',
    slides: [
      slide('extras', 'language', Languages, 'settings-language', [h('set.language', 'language')], { line2: true, link: { kind: 'view', view: 'settings' } }),
      slide('extras', 'wallpaper', Palette, 'settings-media', [h('set.wallpaper', 'wallpaper')], { line2: true }),
      slide('extras', 'switches', ToggleRight, 'settings-switches', [h('set.contentBar', 'recommendedRow'), h('set.postNotify', 'postAlerts'), h('set.alerts', 'serviceAlerts')], { line2: true }),
      slide('extras', 'profiles', Users, 'profiles-pick', [h('prof.list', 'profiles'), h('prof.manage', 'manage')], { line2: true }),
      slide('extras', 'kids', Baby, 'profile-edit', [h('prof.kidsLevel', 'ageLevel'), h('prof.pinBtn', 'pin')], { line2: true }),
      slide('extras', 'updates', Download, 'settings-ui', [h('set.updatesTab', 'updates')], { line2: true }),
    ],
  },
];
