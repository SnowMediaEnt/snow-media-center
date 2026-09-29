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

// The words are translation keys (guides.howTo.<chapter>.<...>): this file is read
// once at start-up, so the screen calls t(key) when it draws, and the text follows
// the language.
export type TutorialDeepLink =
  | { kind: 'view'; view: string; labelKey: string }
  | { kind: 'event'; event: string; labelKey: string }
  /** Straight into Live TV or Plex, as Home's cards open them. */
  | { kind: 'player'; section: 'live' | 'movies'; labelKey: string };

export interface TutorialArt {
  screen: string;
  highlight?: string;
}

export interface TutorialSlide {
  icon: LucideIcon;
  titleKey: string;
  line2Key?: string;
  deepLink?: TutorialDeepLink;
  art?: TutorialArt;
}

export interface TutorialChapter {
  id: string;
  titleKey: string;
  subtitleKey: string;
  icon: LucideIcon;
  color: string; // tailwind classes for the chapter card accents
  slides: TutorialSlide[];
}

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  {
    id: 'basics',
    titleKey: 'guides.howTo.basics.title',
    subtitleKey: 'guides.howTo.basics.subtitle',
    icon: Compass,
    color: 'bg-cyan-700/60 border-cyan-400/70 text-cyan-100',
    slides: [
      { icon: Gamepad2, titleKey: 'guides.howTo.basics.s0.title', line2Key: 'guides.howTo.basics.s0.line2', art: { screen: 'remote', highlight: 'dpad' } },
      { icon: Home, titleKey: 'guides.howTo.basics.s1.title', line2Key: 'guides.howTo.basics.s1.line2', art: { screen: 'home' } },
      { icon: Film, titleKey: 'guides.howTo.basics.s2.title', line2Key: 'guides.howTo.basics.s2.line2', art: { screen: 'home', highlight: 'contentbar' } },
      { icon: Newspaper, titleKey: 'guides.howTo.basics.s3.title', line2Key: 'guides.howTo.basics.s3.line2', art: { screen: 'home', highlight: 'ticker' } },
      { icon: Cog, titleKey: 'guides.howTo.basics.s4.title', art: { screen: 'home', highlight: 'header' } },
    ],
  },
  {
    id: 'livetv',
    titleKey: 'guides.howTo.livetv.title',
    subtitleKey: 'guides.howTo.livetv.subtitle',
    icon: Tv,
    color: 'bg-brand-gold/20 border-brand-gold/70 text-brand-gold',
    slides: [
      {
        icon: Tv,
        titleKey: 'guides.howTo.livetv.s0.title',
        line2Key: 'guides.howTo.livetv.s0.line2',
        deepLink: { kind: 'player', section: 'live', labelKey: 'guides.howTo.livetv.s0.linkBtn' },
        art: { screen: 'home', highlight: 'player-card' },
      },
      { icon: LayoutGrid, titleKey: 'guides.howTo.livetv.s1.title', line2Key: 'guides.howTo.livetv.s1.line2', art: { screen: 'livetv', highlight: 'list' } },
      { icon: List, titleKey: 'guides.howTo.livetv.s2.title', line2Key: 'guides.howTo.livetv.s2.line2', art: { screen: 'livetv', highlight: 'list' } },
      { icon: Play, titleKey: 'guides.howTo.livetv.s3.title', line2Key: 'guides.howTo.livetv.s3.line2', art: { screen: 'controls', highlight: 'bar' } },
      { icon: CalendarDays, titleKey: 'guides.howTo.livetv.s4.title', art: { screen: 'guide', highlight: 'grid' } },
      { icon: LayoutGrid, titleKey: 'guides.howTo.livetv.s5.title', line2Key: 'guides.howTo.livetv.s5.line2', art: { screen: 'multiscreen', highlight: 'tiles' } },
      { icon: Flag, titleKey: 'guides.howTo.livetv.s6.title', line2Key: 'guides.howTo.livetv.s6.line2', art: { screen: 'livetv', highlight: 'list' } },
    ],
  },
  {
    id: 'movies',
    titleKey: 'guides.howTo.movies.title',
    subtitleKey: 'guides.howTo.movies.subtitle',
    icon: Clapperboard,
    color: 'bg-purple-700/60 border-purple-400/70 text-purple-100',
    slides: [
      {
        icon: Clapperboard,
        titleKey: 'guides.howTo.movies.s0.title',
        deepLink: { kind: 'player', section: 'movies', labelKey: 'guides.howTo.movies.s0.linkBtn' },
        art: { screen: 'chooser', highlight: 'movies-card' },
      },
      { icon: KeyRound, titleKey: 'guides.howTo.movies.s1.title', line2Key: 'guides.howTo.movies.s1.line2', art: { screen: 'plex-code', highlight: 'code' } },
      { icon: Search, titleKey: 'guides.howTo.movies.s2.title', line2Key: 'guides.howTo.movies.s2.line2', art: { screen: 'plex-grid', highlight: 'grid' } },
      { icon: Compass, titleKey: 'guides.howTo.movies.s3.title', line2Key: 'guides.howTo.movies.s3.line2', art: { screen: 'plex-grid', highlight: 'grid' } },
      { icon: EyeOff, titleKey: 'guides.howTo.movies.s4.title', line2Key: 'guides.howTo.movies.s4.line2', art: { screen: 'plex-grid', highlight: 'settings-tab' } },
      { icon: Captions, titleKey: 'guides.howTo.movies.s5.title', art: { screen: 'controls', highlight: 'subs-menu' } },
      { icon: VolumeX, titleKey: 'guides.howTo.movies.s6.title', line2Key: 'guides.howTo.movies.s6.line2', art: { screen: 'controls', highlight: 'audio-menu' } },
    ],
  },
  {
    id: 'apps',
    titleKey: 'guides.howTo.apps.title',
    subtitleKey: 'guides.howTo.apps.subtitle',
    icon: Smartphone,
    color: 'bg-blue-700/60 border-blue-400/70 text-blue-100',
    slides: [
      {
        icon: Smartphone,
        titleKey: 'guides.howTo.apps.s0.title',
        line2Key: 'guides.howTo.apps.s0.line2',
        deepLink: { kind: 'view', view: 'apps', labelKey: 'guides.howTo.apps.s0.linkBtn' },
        art: { screen: 'apps', highlight: 'grid' },
      },
      { icon: Download, titleKey: 'guides.howTo.apps.s1.title', line2Key: 'guides.howTo.apps.s1.line2', art: { screen: 'apps', highlight: 'popup' } },
    ],
  },
  {
    id: 'support',
    titleKey: 'guides.howTo.support.title',
    subtitleKey: 'guides.howTo.support.subtitle',
    icon: LifeBuoy,
    color: 'bg-orange-700/60 border-orange-400/70 text-orange-100',
    slides: [
      { icon: LifeBuoy, titleKey: 'guides.howTo.support.s0.title', line2Key: 'guides.howTo.support.s0.line2', art: { screen: 'support' } },
      { icon: Gauge, titleKey: 'guides.howTo.support.s1.title', art: { screen: 'support', highlight: 'speedtest' } },
      {
        icon: CircleDot,
        titleKey: 'guides.howTo.support.s2.title',
        deepLink: { kind: 'event', event: 'support:open-buffering-guide', labelKey: 'guides.howTo.support.s2.linkBtn' },
        art: { screen: 'support', highlight: 'guide-card' },
      },
      {
        icon: MessageCircle,
        titleKey: 'guides.howTo.support.s3.title',
        line2Key: 'guides.howTo.support.s3.line2',
        deepLink: { kind: 'event', event: 'support:open-tickets', labelKey: 'guides.howTo.support.s3.linkBtn' },
        art: { screen: 'support', highlight: 'tickets' },
      },
      {
        icon: Sparkles,
        titleKey: 'guides.howTo.support.s4.title',
        line2Key: 'guides.howTo.support.s4.line2',
        deepLink: { kind: 'event', event: 'support:open-cleaner', labelKey: 'guides.howTo.support.s4.linkBtn' },
        art: { screen: 'support' },
      },
      {
        icon: Bot,
        titleKey: 'guides.howTo.support.s5.title',
        line2Key: 'guides.howTo.support.s5.line2',
        art: { screen: 'support', highlight: 'ai-tab' },
      },
      {
        icon: Newspaper,
        titleKey: 'guides.howTo.support.s6.title',
        line2Key: 'guides.howTo.support.s6.line2',
        deepLink: { kind: 'event', event: 'support:open-posts', labelKey: 'guides.howTo.support.s6.linkBtn' },
        art: { screen: 'support' },
      },
    ],
  },
  {
    id: 'account',
    titleKey: 'guides.howTo.account.title',
    subtitleKey: 'guides.howTo.account.subtitle',
    icon: Wallet,
    color: 'bg-yellow-700/60 border-yellow-400/70 text-yellow-100',
    slides: [
      {
        icon: Users,
        titleKey: 'guides.howTo.account.s0.title',
        line2Key: 'guides.howTo.account.s0.line2',
        deepLink: { kind: 'view', view: 'user', labelKey: 'guides.howTo.account.s0.linkBtn' },
        art: { screen: 'settings' },
      },
      { icon: Gem, titleKey: 'guides.howTo.account.s1.title', line2Key: 'guides.howTo.account.s1.line2', art: { screen: 'store' } },
      {
        icon: Dices,
        titleKey: 'guides.howTo.account.s2.title',
        line2Key: 'guides.howTo.account.s2.line2',
        deepLink: { kind: 'view', view: 'games', labelKey: 'guides.howTo.account.s2.linkBtn' },
        art: { screen: 'home' },
      },
    ],
  },
  {
    id: 'extras',
    titleKey: 'guides.howTo.extras.title',
    subtitleKey: 'guides.howTo.extras.subtitle',
    icon: Cog,
    color: 'bg-emerald-700/60 border-emerald-400/70 text-emerald-100',
    slides: [
      {
        icon: Palette,
        titleKey: 'guides.howTo.extras.s0.title',
        line2Key: 'guides.howTo.extras.s0.line2',
        deepLink: { kind: 'view', view: 'settings', labelKey: 'guides.howTo.extras.s0.linkBtn' },
        art: { screen: 'settings', highlight: 'appearance' },
      },
      { icon: Bell, titleKey: 'guides.howTo.extras.s1.title', line2Key: 'guides.howTo.extras.s1.line2', art: { screen: 'settings' } },
      { icon: Users, titleKey: 'guides.howTo.extras.s2.title', art: { screen: 'settings', highlight: 'accounts' } },
    ],
  },
];
