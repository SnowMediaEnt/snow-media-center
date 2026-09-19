import type { LucideIcon } from 'lucide-react';
import {
  Compass,
  Sparkles,
  Gamepad2,
  Home,
  Film,
  Newspaper,
  Cog,
  Tv,
  List,
  Play,
  CalendarDays,
  LayoutGrid,
  Flag,
  Clapperboard,
  KeyRound,
  Search,
  Captions,
  VolumeX,
  Settings,
  Smartphone,
  Download,
  Pin,
  LifeBuoy,
  Gauge,
  CircleDot,
  MessageCircle,
  Bot,
  CreditCard,
  Palette,
  Users,
  Bell,
  EyeOff,
  Wallet,
  Gem,
  Dices,
} from 'lucide-react';

export type TutorialDeepLink =
  | { kind: 'view'; view: string; label: string }
  | { kind: 'event'; event: string; label: string };

export interface TutorialArt {
  screen: string;
  highlight?: string;
}

export interface TutorialSlide {
  icon: LucideIcon;
  title: string;
  line2?: string;
  deepLink?: TutorialDeepLink;
  art?: TutorialArt;
}

export interface TutorialChapter {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  color: string; // tailwind classes for the chapter card accents
  slides: TutorialSlide[];
}

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  {
    id: 'basics',
    title: 'The Basics',
    subtitle: 'Your remote + the Home screen',
    icon: Compass,
    color: 'bg-cyan-700/60 border-cyan-400/70 text-cyan-100',
    slides: [
      { icon: Gamepad2, title: 'Move with the arrows. OK picks. Back goes back.', line2: "That's 90% of everything — you can't break anything.", art: { screen: 'remote', highlight: 'dpad' } },
      { icon: Home, title: 'This is your Home screen.', line2: 'Big cards: Player, Main Apps, Support and the Store.', art: { screen: 'home' } },
      { icon: Film, title: 'The bar up top is yours.', line2: 'What you were watching, your live channels with what\'s on now, and picks based on what you watch. OK jumps straight in.', art: { screen: 'home', highlight: 'contentbar' } },
      { icon: Newspaper, title: 'The scrolling line at the very top is news from us.', line2: 'Deals, updates and heads-ups show there.', art: { screen: 'home', highlight: 'ticker' } },
      { icon: Cog, title: 'My Account and Settings live in the top-right corner.', art: { screen: 'home', highlight: 'header' } },
    ],
  },
  {
    id: 'livetv',
    title: 'Player — Live TV',
    subtitle: 'Channels, layouts, guide & multi-screen',
    icon: Tv,
    color: 'bg-brand-gold/20 border-brand-gold/70 text-brand-gold',
    slides: [
      {
        icon: Tv,
        title: 'Open Player, then Live TV.',
        line2: 'Sign in with the details your seller gave you. Every account you add shows in one list.',
        deepLink: { kind: 'view', view: 'livetv', label: 'Take me there' },
        art: { screen: 'home', highlight: 'player-card' },
      },
      { icon: LayoutGrid, title: 'Pick your look: Classic, Compact or Grid.', line2: 'Live TV asks the first time. Change it any time under Player Settings → Appearance.', art: { screen: 'livetv', highlight: 'list' } },
      { icon: List, title: 'Pick a category, then a channel.', line2: 'In Compact, the categories are one press to the LEFT. Back from the channels goes to the categories.', art: { screen: 'livetv', highlight: 'list' } },
      { icon: Play, title: 'Rest on a channel and it plays in the preview box. OK goes full screen.', line2: 'In Grid, OK plays right away. While watching, OK shows the controls; Up and Down change the channel.', art: { screen: 'controls', highlight: 'bar' } },
      { icon: CalendarDays, title: "The Guide shows what's on now and what's next.", art: { screen: 'guide', highlight: 'grid' } },
      { icon: LayoutGrid, title: 'Multi-Screen plays 2 or 4 channels at once.', line2: 'The sound follows the tile you highlight.', art: { screen: 'multiscreen', highlight: 'tiles' } },
      { icon: Flag, title: 'Channel not working? Hold OK on it.', line2: 'Report a problem, add it to Favorites, or refresh a favorite whose link changed. Reports come straight to us.', art: { screen: 'livetv', highlight: 'list' } },
    ],
  },
  {
    id: 'movies',
    title: 'Player — Plex',
    subtitle: 'Movies & Series',
    icon: Clapperboard,
    color: 'bg-purple-700/60 border-purple-400/70 text-purple-100',
    slides: [
      {
        icon: Clapperboard,
        title: 'Open Player, then Plex (Movies & Series).',
        deepLink: { kind: 'view', view: 'livetv', label: 'Take me there' },
        art: { screen: 'chooser', highlight: 'movies-card' },
      },
      { icon: KeyRound, title: 'Signed into Live TV? Plex connects by itself — no code to send.', line2: "Not signed in yet? Press Connect with Live TV. You don't need your own Plex account.", art: { screen: 'plex-code', highlight: 'code' } },
      { icon: Search, title: 'The menu down the left: Home, Discover, your libraries, Search, Request.', line2: 'OK on a poster opens the title page — then press Play.', art: { screen: 'plex-grid', highlight: 'grid' } },
      { icon: Compass, title: "Not sure what to watch? Discover has Hidden Gems, Surprise Me, genres and decades.", line2: 'Home shows what you were watching, new arrivals and Most Watched.', art: { screen: 'plex-grid', highlight: 'grid' } },
      { icon: EyeOff, title: "Don't want a library? Hold OK on it in the menu to hide it.", line2: 'Bring it back under Settings → Hidden.', art: { screen: 'plex-grid', highlight: 'settings-tab' } },
      { icon: Captions, title: "Need subtitles? Open the Subtitles menu and pick 'Get subtitles…'.", art: { screen: 'controls', highlight: 'subs-menu' } },
      { icon: VolumeX, title: "No sound? Open the Audio menu and press 'Fix audio'.", line2: 'It fixes the sound without restarting your movie.', art: { screen: 'controls', highlight: 'audio-menu' } },
    ],
  },
  {
    id: 'apps',
    title: 'Main Apps',
    subtitle: 'Get & manage your apps',
    icon: Smartphone,
    color: 'bg-blue-700/60 border-blue-400/70 text-blue-100',
    slides: [
      {
        icon: Smartphone,
        title: 'Main Apps has every extra app you might need — all in one safe place.',
        deepLink: { kind: 'view', view: 'apps', label: 'Take me there' },
        art: { screen: 'apps', highlight: 'grid' },
      },
      { icon: Download, title: 'Press OK on an app, then Download to install it.', line2: "Already installed? It just says Open.", art: { screen: 'apps', highlight: 'popup' } },
      { icon: Pin, title: "Pin your favorites and they'll show right on your Home screen.", art: { screen: 'apps', highlight: 'pin' } },
    ],
  },
  {
    id: 'support',
    title: 'Support',
    subtitle: 'Help, AI and Posts',
    icon: LifeBuoy,
    color: 'bg-orange-700/60 border-orange-400/70 text-orange-100',
    slides: [
      { icon: LifeBuoy, title: 'Stuck? Support has your back.', line2: 'Three tabs: Help, AI Chat and Posts.', art: { screen: 'support' } },
      { icon: Gauge, title: 'Speed Test checks if your internet is fast enough for streaming.', art: { screen: 'support', highlight: 'speedtest' } },
      {
        icon: CircleDot,
        title: 'TV keeps pausing? Open the Buffering Guide — it walks you through easy fixes.',
        deepLink: { kind: 'event', event: 'support:open-buffering-guide', label: 'Open it' },
        art: { screen: 'support', highlight: 'guide-card' },
      },
      {
        icon: MessageCircle,
        title: 'Submit a Ticket to reach a real person.',
        line2: 'A count shows on the Support card when we answer.',
        deepLink: { kind: 'event', event: 'support:open-tickets', label: 'Open tickets' },
        art: { screen: 'support', highlight: 'tickets' },
      },
      {
        icon: Sparkles,
        title: 'Box running slow or out of space? Device Cleaner frees it up.',
        line2: "It empties every app's cache, closes background apps, and lists apps nobody opens.",
        deepLink: { kind: 'event', event: 'support:open-cleaner', label: 'Open the cleaner' },
        art: { screen: 'support' },
      },
      {
        icon: Bot,
        title: 'AI Chat answers instantly — and can do things for you.',
        line2: 'Ask it to open a screen, change your Live TV look, report a channel, install an app, or make you a wallpaper.',
        art: { screen: 'support', highlight: 'ai-tab' },
      },
      {
        icon: Newspaper,
        title: 'Posts: every email we send lands here too.',
        line2: 'Dated, marked New until you open it, readable full screen. Links become a code you scan with your phone.',
        deepLink: { kind: 'event', event: 'support:open-posts', label: 'Open Posts' },
        art: { screen: 'support' },
      },
    ],
  },
  {
    id: 'account',
    title: 'My Account & Snow Gems',
    subtitle: 'Dashboard, gems & games',
    icon: Wallet,
    color: 'bg-yellow-700/60 border-yellow-400/70 text-yellow-100',
    slides: [
      {
        icon: Users,
        title: 'My Account is your Dashboard — everything on one screen.',
        line2: 'Your streaming account, devices and services, and your Snow Gems. Prefer it bigger? Settings → UI → Large dashboard.',
        deepLink: { kind: 'view', view: 'user', label: 'Take me there' },
        art: { screen: 'settings' },
      },
      { icon: Gem, title: 'Snow Gems power Premium AI and Image Gen.', line2: 'Purchase Snow Gems: pick a pack, scan the code with your phone, pay there — the gems land on your account by themselves.', art: { screen: 'store' } },
      {
        icon: Dices,
        title: 'The Game Lounge: Blackjack, Roulette, Slots, Plinko, Dice, Video Poker, Trivia and the Daily Spin.',
        line2: 'Play for Snow Coins and climb the leaderboard. Never real money.',
        deepLink: { kind: 'view', view: 'games', label: 'Open the lounge' },
        art: { screen: 'home' },
      },
    ],
  },
  {
    id: 'extras',
    title: 'Settings & Extras',
    subtitle: 'Make it yours',
    icon: Cog,
    color: 'bg-emerald-700/60 border-emerald-400/70 text-emerald-100',
    slides: [
      {
        icon: Palette,
        title: 'Change your wallpaper under Settings → Media.',
        line2: 'Upload your own, or describe one and let AI make it.',
        deepLink: { kind: 'view', view: 'settings', label: 'Take me there' },
        art: { screen: 'settings', highlight: 'appearance' },
      },
      { icon: Bell, title: 'Settings → UI has the switches.', line2: 'Content bar on or off, Large dashboard, Post notifications, and alerts on this device.', art: { screen: 'settings' } },
      { icon: Users, title: 'Saved Accounts remembers your sign-ins so you never retype them.', art: { screen: 'settings', highlight: 'accounts' } },
    ],
  },
];
