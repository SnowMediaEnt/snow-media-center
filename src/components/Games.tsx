import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Coins, Trophy, Lock, Sparkles, Dice5, Gift, LogIn, Loader2, WifiOff } from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import DailySpin from './games/DailySpin';

interface GamesProps {
  onBack: () => void;
}

const hubTiles = [
  {
    id: 'daily-spin',
    name: 'Daily Spin',
    tagline: 'Free chips every 24 hours',
    icon: Gift,
    badge: 'Play now',
  },
  {
    id: 'chip-games',
    name: 'Chip Games',
    tagline: 'Casino-style games, just for fun',
    icon: Dice5,
    badge: 'Coming soon',
  },
  {
    id: 'leaderboard',
    name: 'Leaderboard',
    tagline: 'Climb the ranks — bragging rights only',
    icon: Trophy,
    badge: 'Coming soon',
  },
];

const upcomingGames = [
  { id: 'poker', name: "Texas Hold'em Poker", icon: '♠️', description: 'Classic poker' },
  { id: 'slots', name: 'Lucky Slots', icon: '🎰', description: 'Spin the reels' },
  { id: 'blackjack', name: 'Blackjack 21', icon: '🃏', description: 'Beat the dealer' },
  { id: 'plinko', name: 'Plinko Drop', icon: '⚪', description: 'Drop the puck' },
  { id: 'roulette', name: 'Roulette', icon: '🎡', description: 'Spin the wheel' },
  { id: 'dice', name: 'Lucky Dice', icon: '🎲', description: 'Roll the bones' },
];

const Games = ({ onBack }: GamesProps) => {
  const { user } = useAuth();
  const { status, balance, errorMessage } = useGameSocket();
  const [focusIndex, setFocusIndex] = useState(0);
  const [screen, setScreen] = useState<'hub' | 'daily-spin'>('hub');

  // Focusable items: back (0), then 3 hub tiles (1-3), then upcoming games (4..)
  const totalFocusable = 1 + hubTiles.length + upcomingGames.length;

  const openTile = (id: string) => {
    if (id === 'daily-spin') setScreen('daily-spin');
  };

  useEffect(() => {
    if (screen !== 'hub') return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4) {
        e.preventDefault();
        onBack();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        const hubStart = 1;
        if (focusIndex >= hubStart && focusIndex < hubStart + hubTiles.length) {
          const tile = hubTiles[focusIndex - hubStart];
          openTile(tile.id);
        } else if (focusIndex === 0) {
          onBack();
        }
        return;
      }
      if (e.key === 'ArrowRight') {
        setFocusIndex((i) => Math.min(totalFocusable - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        setFocusIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowDown') {
        setFocusIndex((i) => Math.min(totalFocusable - 1, i + 3));
      } else if (e.key === 'ArrowUp') {
        setFocusIndex((i) => Math.max(0, i - 3));
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onBack, totalFocusable, screen, focusIndex]);

  // Scroll focused tile into view
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-game-focus="${focusIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusIndex]);

  const renderChipBadge = () => {
    if (!user) {
      return (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-amber-200 text-sm font-semibold">
          Sign in to load your Play Chips
        </div>
      );
    }
    if (status === 'connecting' || (status === 'connected' && balance === null)) {
      return (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-emerald-100 text-sm font-semibold">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading chips…
        </div>
      );
    }
    if (status === 'error' || status === 'reconnecting') {
      return (
        <div className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-amber-100 text-sm font-semibold">
          <WifiOff className="w-4 h-4" /> Couldn't load your chips — reconnecting…
        </div>
      );
    }
    return (
      <div
        className="flex items-center gap-3 rounded-xl border border-emerald-300/50 bg-gradient-to-br from-emerald-500/25 to-emerald-700/25 px-5 py-3 shadow-[0_8px_28px_-12px_rgba(16,185,129,0.6)] backdrop-blur"
        aria-label="Play Chips balance"
      >
        <Coins className="w-6 h-6 text-amber-300 drop-shadow" />
        <div className="flex flex-col leading-tight">
          <span className="text-[11px] uppercase tracking-wider text-emerald-200/90 font-semibold">Free chips</span>
          <span className="text-2xl font-extrabold text-white tabular-nums">
            {balance !== null ? balance.toLocaleString() : '—'}
          </span>
        </div>
      </div>
    );
  };

  if (screen === 'daily-spin') {
    return <DailySpin onBack={() => setScreen('hub')} />;
  }

  return (
    <div
      className="tv-scroll-container tv-safe text-white relative"
      style={{
        background:
          'radial-gradient(1200px 600px at 20% -10%, rgba(34,197,94,0.18), transparent 60%),' +
          'radial-gradient(900px 500px at 90% 10%, rgba(56,189,248,0.12), transparent 60%),' +
          'linear-gradient(135deg, #0a1628 0%, #0b1f1a 50%, #07111c 100%)',
      }}
    >
      <div className="max-w-6xl mx-auto pb-16 px-4 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
          <Button
            data-game-focus={0}
            onClick={onBack}
            variant="gold"
            size="lg"
            className={`transition-all duration-200 ${focusIndex === 0 ? 'ring-4 ring-amber-300/70 scale-110 shadow-[0_0_24px_rgba(252,211,77,0.6)]' : ''}`}
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back
          </Button>
          {renderChipBadge()}
        </div>

        {/* Hero */}
        <Card className="relative overflow-hidden border-emerald-400/20 bg-gradient-to-br from-slate-900/80 to-emerald-950/70 p-8 mb-10 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]">
          <div className="absolute inset-0 pointer-events-none opacity-30"
               style={{ background: 'radial-gradient(600px 200px at 50% 0%, rgba(250,204,21,0.25), transparent 70%)' }} />
          <div className="relative text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 mb-4 rounded-full bg-emerald-500/15 border border-emerald-300/30 text-emerald-200 text-xs font-semibold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              Game Room
            </div>
            <h1 className="text-5xl md:text-6xl font-black text-white mb-3 drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
              Welcome to the Lounge
            </h1>
            <p className="text-lg md:text-xl text-slate-100/90 max-w-2xl mx-auto font-medium">
              Play with free Play Chips. Earn them daily, climb the leaderboard, and have fun —
              just for bragging rights.
            </p>
          </div>
        </Card>

        {/* Hub tiles */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10" style={{ perspective: '1200px' }}>
          {hubTiles.map((tile, idx) => {
            const focusPos = 1 + idx;
            const focused = focusIndex === focusPos;
            const Icon = tile.icon;
            return (
              <Card
                key={tile.id}
                data-game-focus={focusPos}
                tabIndex={0}
                onFocus={() => setFocusIndex(focusPos)}
                onMouseEnter={() => setFocusIndex(focusPos)}
                className={`relative overflow-hidden cursor-pointer border-emerald-400/20 bg-gradient-to-br from-slate-900/90 to-slate-950/90 p-6 transition-all duration-300 outline-none
                  ${focused
                    ? 'scale-[1.04] border-emerald-300/70 shadow-[0_24px_60px_-15px_rgba(16,185,129,0.55),inset_0_0_0_1px_rgba(255,255,255,0.06)] ring-2 ring-emerald-300/60'
                    : 'shadow-[0_12px_32px_-12px_rgba(0,0,0,0.7),inset_0_0_0_1px_rgba(255,255,255,0.03)] hover:scale-[1.02]'}
                `}
                style={{ transformStyle: 'preserve-3d' }}
              >
                <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-emerald-400/10 blur-2xl" />
                <div className="relative flex items-start gap-4">
                  <div className="rounded-xl p-3 bg-gradient-to-br from-emerald-500/30 to-emerald-700/30 border border-emerald-300/30">
                    <Icon className="w-8 h-8 text-amber-300" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="text-xl font-bold text-white">{tile.name}</h3>
                      <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-200 border border-amber-300/40 whitespace-nowrap">
                        {tile.badge}
                      </span>
                    </div>
                    <p className="text-sm text-slate-100/90 font-medium">{tile.tagline}</p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {/* Upcoming games */}
        <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
          <Lock className="w-5 h-5 text-emerald-300" />
          Coming Soon
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4" style={{ perspective: '1200px' }}>
          {upcomingGames.map((game, idx) => {
            const focusPos = 1 + hubTiles.length + idx;
            const focused = focusIndex === focusPos;
            return (
              <Card
                key={game.id}
                data-game-focus={focusPos}
                tabIndex={0}
                onFocus={() => setFocusIndex(focusPos)}
                onMouseEnter={() => setFocusIndex(focusPos)}
                className={`relative overflow-hidden border-slate-600/40 bg-gradient-to-br from-slate-800/80 to-slate-950/90 p-6 transition-all duration-300 outline-none
                  ${focused
                    ? 'scale-[1.05] border-emerald-300/70 shadow-[0_18px_44px_-12px_rgba(16,185,129,0.55)] ring-2 ring-emerald-300/60'
                    : 'shadow-[0_10px_24px_-12px_rgba(0,0,0,0.7)] hover:scale-[1.02]'}
                `}
              >
                <div className="absolute top-2 right-2">
                  <Lock className="w-4 h-4 text-slate-300" />
                </div>
                <div className="text-center">
                  <div className="text-5xl mb-3 drop-shadow">{game.icon}</div>
                  <h3 className="text-lg font-bold text-white mb-1">{game.name}</h3>
                  <p className="text-sm text-slate-200/90 font-medium">{game.description}</p>
                  <div className="mt-3">
                    <span className="text-xs font-semibold bg-emerald-500/25 text-emerald-100 px-2 py-1 rounded-full border border-emerald-300/30">
                      Coming Soon
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {!user && (
          <Card className="mt-8 p-6 bg-slate-900/70 border-amber-400/40 flex items-center justify-center gap-3 text-amber-100 font-semibold">
            <LogIn className="w-5 h-5" />
            Sign in to start collecting Play Chips.
          </Card>
        )}

        {errorMessage && user && (status === 'error' || status === 'reconnecting') && (
          <p className="mt-6 text-center text-xs text-slate-400">Server: {errorMessage}</p>
        )}
      </div>
    </div>
  );
};

export default Games;
