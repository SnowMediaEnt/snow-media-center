import type { LucideIcon } from 'lucide-react';
import {
  Compass,
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
  Store,
  CreditCard,
  Palette,
  Users,
  Bell,
} from 'lucide-react';

export type TutorialDeepLink =
  | { kind: 'view'; view: string; label: string }
  | { kind: 'event'; event: string; label: string };

export interface TutorialSlide {
  icon: LucideIcon;
  title: string;
  line2?: string;
  deepLink?: TutorialDeepLink;
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
      { icon: Gamepad2, title: 'Move with the arrows. OK picks. Back goes back.', line2: "That's 90% of everything — you can't break anything." },
      { icon: Home, title: 'This is your Home screen.', line2: 'Four big cards: Main Apps, Support, Snow Media Store, and Player.' },
      { icon: Film, title: 'The bar up top shows movies & shows.', line2: 'Press OK on a poster to jump straight to it.' },
      { icon: Newspaper, title: 'The scrolling line at the very top is news from us.', line2: 'Deals, updates and heads-ups show there.' },
      { icon: Cog, title: 'Sign In and Settings live in the top-right corner.' },
    ],
  },
  {
    id: 'livetv',
    title: 'Player — Live TV',
    subtitle: 'Channels, guide & multi-screen',
    icon: Tv,
    color: 'bg-brand-gold/20 border-brand-gold/70 text-brand-gold',
    slides: [
      {
        icon: Tv,
        title: 'Open Player, then Live TV.',
        line2: 'Sign in with the details your seller gave you.',
        deepLink: { kind: 'view', view: 'livetv', label: 'Take me there' },
      },
      { icon: List, title: 'Pick a category on the left, then press OK on a channel to watch.' },
      { icon: Play, title: 'While watching, press OK to show the controls.', line2: 'Up and Down change the channel. Back returns to the list.' },
      { icon: CalendarDays, title: "The Guide shows what's on now and what's next." },
      { icon: LayoutGrid, title: 'Multi-Screen plays 2 or 4 channels at once.', line2: 'The sound follows the tile you highlight.' },
      { icon: Flag, title: 'Channel not working? Hold OK on it and choose Report.', line2: 'It comes straight to us so we can fix it.' },
    ],
  },
  {
    id: 'movies',
    title: 'Player — Movies & Shows',
    subtitle: 'Your movie & series library',
    icon: Clapperboard,
    color: 'bg-purple-700/60 border-purple-400/70 text-purple-100',
    slides: [
      {
        icon: Clapperboard,
        title: 'Open Player, then Movies & Shows.',
        deepLink: { kind: 'view', view: 'livetv', label: 'Take me there' },
      },
      { icon: KeyRound, title: 'Press Sign in to get a code — then SEND THE CODE TO YOUR PROVIDER.', line2: "They link it for you. You don't need your own Plex account." },
      { icon: Search, title: 'Browse Home, Search, or any category.', line2: 'OK on a poster shows details — then press Play.' },
      { icon: Captions, title: "Need subtitles? Open the Subtitles menu and pick 'Get subtitles…'." },
      { icon: VolumeX, title: "No sound? Open the Audio menu and press 'Fix audio'.", line2: 'It fixes the sound without restarting your movie.' },
      { icon: Settings, title: 'The gear tab is Settings — hide categories or sign out of Plex there.' },
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
      },
      { icon: Download, title: 'Press OK on an app, then Download to install it.', line2: "Already installed? It says 'Not installed' no more — just Open." },
      { icon: Pin, title: "Pin your favorites and they'll show right on your Home screen." },
    ],
  },
  {
    id: 'support',
    title: 'Support',
    subtitle: 'Help when you need it',
    icon: LifeBuoy,
    color: 'bg-orange-700/60 border-orange-400/70 text-orange-100',
    slides: [
      { icon: LifeBuoy, title: 'Stuck? Support has your back.' },
      { icon: Gauge, title: 'Speed Test checks if your internet is fast enough for streaming.' },
      {
        icon: CircleDot,
        title: 'TV keeps pausing? Open the Buffering Guide — it walks you through easy fixes.',
        deepLink: { kind: 'event', event: 'support:open-buffering-guide', label: 'Open it' },
      },
      {
        icon: MessageCircle,
        title: 'Submit a Ticket to reach a real person.',
        deepLink: { kind: 'event', event: 'support:open-tickets', label: 'Open tickets' },
      },
      { icon: Bot, title: 'The AI Chat tab answers questions instantly — day or night.' },
    ],
  },
  {
    id: 'store',
    title: 'Snow Media Store',
    subtitle: 'Plans & renewals',
    icon: Store,
    color: 'bg-pink-700/60 border-pink-400/70 text-pink-100',
    slides: [
      {
        icon: Store,
        title: 'The Store is where you get or renew your service.',
        deepLink: { kind: 'view', view: 'store', label: 'Take me there' },
      },
      { icon: CreditCard, title: 'Pick a plan and follow the steps — done.', line2: 'Your seller can help you anytime.' },
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
        title: 'Change how the app looks in Settings → Appearance.',
        deepLink: { kind: 'view', view: 'settings', label: 'Take me there' },
      },
      { icon: Users, title: 'Saved Accounts remembers your sign-ins so you never retype them.' },
      { icon: Bell, title: "Keep an eye on the news line up top — that's how we reach you." },
    ],
  },
];
