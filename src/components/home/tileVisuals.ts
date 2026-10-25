// How each Home tile destination looks: its icon and its card colour.
import {
  Activity, Bot, Clapperboard, CircleDot, Film, Gamepad2, Gauge, Grid2X2, LayoutGrid, LifeBuoy,
  MonitorPlay, Search, Settings as SettingsIcon, Star, Store, Trophy, Tv, type LucideIcon,
} from 'lucide-react';
import type { TileColor, TileDest } from '@/lib/homeTiles';

export const TILE_ICONS: Record<TileDest, LucideIcon> = {
  livetv: Tv,
  plex: Film,
  support: LifeBuoy,
  store: Store,
  'kids-games': Gamepad2,
  guide: LayoutGrid,
  gameday: Trophy,
  multi: Grid2X2,
  favorites: Star,
  recordings: CircleDot,
  movies: Clapperboard,
  series: MonitorPlay,
  search: Search,
  settings: SettingsIcon,
  speedtest: Gauge,
  buffering: Activity,
  'ai-chat': Bot,
};

/** The card's background (Tailwind arbitrary values: whole literals, so the
 *  build keeps them; the focus glow in index.css keys off the first four). */
export const TILE_BG: Record<TileColor, string> = {
  navy: '[background:var(--gradient-navy)]',
  blue: '[background:var(--gradient-blue)]',
  gold: '[background:var(--gradient-gold)]',
  purple: '[background:var(--gradient-purple)]',
  teal: '[background:var(--gradient-teal)]',
  green: '[background:var(--gradient-green)]',
  slate: '[background:var(--gradient-slate)]',
  rose: '[background:var(--gradient-rose)]',
  red: '[background:var(--gradient-red)]',
  orange: '[background:var(--gradient-orange)]',
  indigo: '[background:var(--gradient-indigo)]',
};
