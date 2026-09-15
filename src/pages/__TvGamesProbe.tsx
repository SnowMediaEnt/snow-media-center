import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';

const map = {
  hub: lazy(() => import('@/components/Games')),
  slots: lazy(() => import('@/components/games/Slots')),
  blackjack: lazy(() => import('@/components/games/Blackjack')),
  poker: lazy(() => import('@/components/games/VideoPoker')),
  holdem: lazy(() => import('@/components/games/CasinoHoldem')),
  roulette: lazy(() => import('@/components/games/Roulette')),
  daily: lazy(() => import('@/components/games/DailySpin')),
} as const;

const TvGamesProbe = () => {
  const [params] = useSearchParams();
  const key = (params.get('g') ?? 'hub') as keyof typeof map;
  const Cmp = map[key] ?? map.hub;
  const noop = () => {};
  return (
    <Suspense fallback={<div>loading</div>}>
      <Cmp onBack={noop} onOpenGame={noop as never} />
    </Suspense>
  );
};

export default TvGamesProbe;
