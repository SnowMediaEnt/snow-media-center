import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Gamepad2, Coins, Trophy, Lock, Sparkles } from 'lucide-react';
import { useUserProfile } from '@/hooks/useUserProfile';

interface GamesProps {
  onBack: () => void;
}

const Games = ({ onBack }: GamesProps) => {
  const { profile } = useUserProfile();
  const [focusedElement, setFocusedElement] = useState(0);

  // Keyboard/remote navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Backspace' || event.keyCode === 4) {
        event.preventDefault();
        onBack();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  const upcomingGames = [
    { id: 'poker', name: 'Texas Hold\'em Poker', icon: '♠️', description: 'Classic poker game' },
    { id: 'slots', name: 'Lucky Slots', icon: '🎰', description: 'Spin to win big' },
    { id: 'blackjack', name: 'Blackjack 21', icon: '🃏', description: 'Beat the dealer' },
    { id: 'plinko', name: 'Plinko Drop', icon: '⚪', description: 'Drop and win' },
    { id: 'roulette', name: 'Roulette', icon: '🎡', description: 'Spin the wheel' },
    { id: 'dice', name: 'Lucky Dice', icon: '🎲', description: 'Roll for credits' },
  ];

  return (
    <div className="tv-scroll-container tv-safe bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white">
      <div className="max-w-6xl mx-auto pb-16">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <Button 
            onClick={onBack}
            variant="gold" 
            size="lg"
            className={`transition-all duration-200 ${
              focusedElement === 0 ? 'ring-4 ring-white/60 scale-105' : ''
            }`}
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back
          </Button>
          
          {/* Credits Display */}
          <div className="bg-green-600/20 border border-green-500/50 rounded-lg px-4 py-2">
            <div className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-green-400" />
              <span className="text-green-400 font-medium">Your Credits:</span>
              <span className="text-2xl font-bold text-white">{profile?.credits?.toFixed(2) || '0.00'}</span>
            </div>
          </div>
        </div>

        {/* Coming Soon Banner */}
        <Card className="bg-gradient-to-r from-purple-600/30 via-pink-600/30 to-purple-600/30 border-purple-500/50 p-8 mb-8">
          <div className="text-center">
            <div className="flex items-center justify-center gap-4 mb-4">
              <Gamepad2 className="w-16 h-16 text-purple-400 animate-pulse" />
              <div>
                <h1 className="text-5xl font-bold text-white mb-2">Games</h1>
                <div className="flex items-center justify-center gap-2">
                  <Sparkles className="w-6 h-6 text-yellow-400" />
                  <span className="text-2xl font-semibold text-yellow-400">Coming Soon!</span>
                  <Sparkles className="w-6 h-6 text-yellow-400" />
                </div>
              </div>
            </div>
            <p className="text-xl text-purple-200 max-w-2xl mx-auto">
              Get ready for an exciting collection of casino-style games! 
              Play with credits, compete for the top spots, and even convert your winnings to real money.
            </p>
          </div>
        </Card>

        {/* Features Preview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-gradient-to-br from-green-600/20 to-green-800/20 border-green-500/30 p-6">
            <div className="flex items-center gap-4 mb-4">
              <Coins className="w-10 h-10 text-green-400" />
              <h3 className="text-xl font-bold text-white">Credit-Based Play</h3>
            </div>
            <p className="text-green-200">
              Use your credits to play games. Win more credits and grow your balance!
            </p>
          </Card>

          <Card className="bg-gradient-to-br from-yellow-600/20 to-yellow-800/20 border-yellow-500/30 p-6">
            <div className="flex items-center gap-4 mb-4">
              <Trophy className="w-10 h-10 text-yellow-400" />
              <h3 className="text-xl font-bold text-white">Leaderboards</h3>
            </div>
            <p className="text-yellow-200">
              Compete with other players and climb the leaderboards to earn bonus rewards!
            </p>
          </Card>

          <Card className="bg-gradient-to-br from-blue-600/20 to-blue-800/20 border-blue-500/30 p-6">
            <div className="flex items-center gap-4 mb-4">
              <Sparkles className="w-10 h-10 text-blue-400" />
              <h3 className="text-xl font-bold text-white">Cash Out</h3>
            </div>
            <p className="text-blue-200">
              Convert your credit winnings to real money via crypto wallet or PayPal!
            </p>
          </Card>
        </div>

        {/* Upcoming Games Grid */}
        <h2 className="text-2xl font-bold text-white mb-4">Upcoming Games</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {upcomingGames.map((game) => (
            <Card 
              key={game.id}
              className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border-slate-600/30 p-6 relative overflow-hidden opacity-70 cursor-not-allowed"
            >
              <div className="absolute top-2 right-2">
                <Lock className="w-5 h-5 text-slate-500" />
              </div>
              <div className="text-center">
                <div className="text-5xl mb-3">{game.icon}</div>
                <h3 className="text-lg font-bold text-white mb-1">{game.name}</h3>
                <p className="text-sm text-slate-400">{game.description}</p>
                <div className="mt-3">
                  <span className="text-xs bg-purple-600/50 text-purple-200 px-2 py-1 rounded-full">
                    Coming Soon
                  </span>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Bottom Note */}
        <Card className="bg-gradient-to-br from-slate-800/30 to-slate-900/30 border-slate-600/30 p-6 mt-8 text-center">
          <p className="text-slate-300">
            🎮 Stay tuned! Games will be rolling out in future updates. 
            Make sure to stock up on credits so you're ready to play!
          </p>
        </Card>
      </div>
    </div>
  );
};

export default Games;
