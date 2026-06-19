import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  ArrowLeft,
  Coins,
  Trophy,
  Lock,
  Sparkles,
  Gift,
  LogIn,
  Loader2,
  WifiOff,
} from 'lucide-react';
import { useGameSocket } from '@/hooks/useGameSocket';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';

interface GamesProps {
  onBack: () => void;
  onOpenGame: (view: string) => void;
}

type GameCard = {
  id: string;
  nameKey: string;
  taglineKey: string;
  emoji: string;
  badgeKey: string;
  playable: boolean;
};

const GAMES: GameCard[] = [
  { id: 'daily-spin', nameKey: 'games.hub.gameDailySpinName', taglineKey: 'games.hub.gameDailySpinTagline', emoji: '🎁', badgeKey: 'games.hub.badgePlayNow', playable: true },
  { id: 'slots', nameKey: 'games.hub.gameSlotsName', taglineKey: 'games.hub.gameSlotsTagline', emoji: '🎰', badgeKey: 'games.hub.badgePlayNow', playable: true },
  { id: 'blackjack', nameKey: 'games.hub.gameBlackjackName', taglineKey: 'games.hub.gameBlackjackTagline', emoji: '🃏', badgeKey: 'games.hub.badgePlayNow', playable: true },
  { id: 'video-poker', nameKey: 'games.hub.gameVideoPokerName', taglineKey: 'games.hub.gameVideoPokerTagline', emoji: '♠️', badgeKey: 'games.hub.badgePlayNow', playable: true },
  { id: 'roulette', nameKey: 'games.hub.gameRouletteName', taglineKey: 'games.hub.gameRouletteTagline', emoji: '🎡', badgeKey: 'games.hub.badgePlayNow', playable: true },
  { id: 'casino-holdem', nameKey: 'games.hub.gameCasinoHoldemName', taglineKey: 'games.hub.gameCasinoHoldemTagline', emoji: '♣️', badgeKey: 'games.hub.badgePlayNow', playable: true },
  { id: 'leaderboard', nameKey: 'games.hub.gameLeaderboardName', taglineKey: 'games.hub.gameLeaderboardTagline', emoji: '🏆', badgeKey: 'games.hub.badgeComingSoon', playable: false },
];

const COLS = 3;

const VIEW_BY_ID: Record<string, string> = {
  'daily-spin': 'game-daily-spin',
  'slots': 'game-slots',
  'blackjack': 'game-blackjack',
  'video-poker': 'game-video-poker',
  'roulette': 'game-roulette',
  'casino-holdem': 'game-casino-holdem',
};

const Games = ({ onBack, onOpenGame }: GamesProps) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { status, balance, errorMessage } = useGameSocket();
  const [focusIndex, setFocusIndex] = useState(1); // start on first game card

  // Focusable items: back (0), then GAMES.length game cards (1..)
  const totalFocusable = 1 + GAMES.length;

  const openCard = (card: GameCard) => {
    if (!card.playable) return;
    const view = VIEW_BY_ID[card.id];
    if (view) onOpenGame(view);
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        if (focusIndex === 0) {
          onBack();
        } else {
          const card = GAMES[focusIndex - 1];
          if (card) openCard(card);
        }
        return;
      }
      if (e.key === 'ArrowRight') {
        setFocusIndex((i) => Math.min(totalFocusable - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        setFocusIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowDown') {
        setFocusIndex((i) => {
          if (i === 0) return 1;
          return Math.min(totalFocusable - 1, i + COLS);
        });
      } else if (e.key === 'ArrowUp') {
        setFocusIndex((i) => {
          if (i >= 1 && i <= COLS) return 0;
          return Math.max(0, i - COLS);
        });
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onBack, totalFocusable, focusIndex]);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-game-focus="${focusIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusIndex]);

  const renderChipBadge = () => {
    if (!user) {
      return (
        <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-amber-200 text-sm font-semibold">
          {t('games.hub.chipBadgeSignInPrompt')}
        </div>
      );
    }
    if (status === 'connecting' || (status === 'connected' && balance === null)) {
      return (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-emerald-100 text-sm font-semibold">
          <Loader2 className="w-4 h-4 animate-spin" /> {t('games.hub.chipBadgeLoading')}
        </div>
      );
    }
    if (status === 'error' || status === 'reconnecting') {
      return (
        <div className="flex items-center gap-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-4 py-2 text-amber-100 text-sm font-semibold">
          <WifiOff className="w-4 h-4" /> {t('games.hub.chipBadgeReconnecting')}
        </div>
      );
    }
    return (
      <div
        className="flex items-center gap-3 rounded-xl border border-emerald-300/50 bg-gradient-to-br from-emerald-500/25 to-emerald-700/25 px-5 py-3 shadow-[0_8px_28px_-12px_rgba(16,185,129,0.6)] backdrop-blur"
        aria-label={t('games.hub.chipBadgeAriaLabel')}
      >
        <Coins className="w-6 h-6 text-amber-300 drop-shadow" />
        <div className="flex flex-col leading-tight">
          <span className="text-[11px] uppercase tracking-wider text-emerald-200/90 font-semibold">{t('games.hub.chipBadgeFreeChipsLabel')}</span>
          <span className="text-2xl font-extrabold text-white tabular-nums">
            {balance !== null ? balance.toLocaleString() : '—'}
          </span>
        </div>
      </div>
    );
  };


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
            {t('games.hub.back')}
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
              {t('games.hub.heroEyebrow')}
            </div>
            <h1 className="text-5xl md:text-6xl font-black text-white mb-3 drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">
              {t('games.hub.heroTitle')}
            </h1>
            <p className="text-lg md:text-xl text-slate-100/90 max-w-2xl mx-auto font-medium">
              {t('games.hub.heroSubtitle')}
            </p>
          </div>
        </Card>

        {/* Games grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" style={{ perspective: '1200px' }}>
          {GAMES.map((card, idx) => {
            const focusPos = 1 + idx;
            const focused = focusIndex === focusPos;
            const playable = card.playable;
            return (
              <Card
                key={card.id}
                data-game-focus={focusPos}
                tabIndex={0}
                onFocus={() => setFocusIndex(focusPos)}
                onMouseEnter={() => setFocusIndex(focusPos)}
                onClick={() => openCard(card)}
                className={`relative overflow-hidden border p-6 transition-all duration-300 outline-none
                  ${playable
                    ? 'cursor-pointer border-emerald-400/30 bg-gradient-to-br from-slate-900/90 to-slate-950/95'
                    : 'cursor-not-allowed border-slate-600/40 bg-gradient-to-br from-slate-800/70 to-slate-950/90 opacity-90'}
                  ${focused
                    ? playable
                      ? 'scale-[1.05] border-emerald-300/70 shadow-[0_24px_60px_-15px_rgba(16,185,129,0.55)] ring-2 ring-emerald-300/60'
                      : 'scale-[1.04] border-amber-300/60 shadow-[0_18px_44px_-12px_rgba(0,0,0,0.7)] ring-2 ring-amber-300/40'
                    : 'shadow-[0_12px_32px_-12px_rgba(0,0,0,0.7)] hover:scale-[1.02]'}
                `}
                style={{ transformStyle: 'preserve-3d' }}
              >
                {!playable && (
                  <div className="absolute top-3 right-3">
                    <Lock className="w-4 h-4 text-slate-300" />
                  </div>
                )}
                <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-emerald-400/10 blur-2xl pointer-events-none" />
                <div className="relative flex items-start gap-4">
                  <div
                    className={`text-5xl drop-shadow rounded-xl p-2 ${
                      playable
                        ? 'bg-gradient-to-br from-emerald-500/30 to-emerald-700/30 border border-emerald-300/30'
                        : 'bg-slate-800/40 border border-slate-600/30'
                    }`}
                  >
                    {card.emoji}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="text-xl font-bold text-white">{t(card.nameKey)}</h3>
                      <span
                        className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full whitespace-nowrap border ${
                          playable
                            ? 'bg-amber-400/25 text-amber-100 border-amber-300/50'
                            : 'bg-slate-700/50 text-slate-200 border-slate-500/40'
                        }`}
                      >
                        {t(card.badgeKey)}
                      </span>
                    </div>
                    <p className="text-sm text-slate-100/90 font-medium">{t(card.taglineKey)}</p>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>

        {!user && (
          <Card className="mt-8 p-6 bg-slate-900/70 border-amber-400/40 flex items-center justify-center gap-3 text-amber-100 font-semibold">
            <LogIn className="w-5 h-5" />
            {t('games.hub.signInBanner')}
          </Card>
        )}

        {errorMessage && user && (status === 'error' || status === 'reconnecting') && (
          <p className="mt-6 text-center text-xs text-slate-400">{t('games.hub.serverError', { errorMessage })}</p>
        )}
      </div>
    </div>
  );
};

export default Games;

