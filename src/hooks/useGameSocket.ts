import { useEffect, useSyncExternalStore } from 'react';
import { gameSocket, type GameSocketStatus } from '@/lib/gameSocket';
import { useAuth } from '@/hooks/useAuth';

export interface UseGameSocketResult {
  status: GameSocketStatus;
  balance: number | null;
  userId: string | null;
  errorMessage: string | null;
  refresh: () => void;
}

export function useGameSocket(): UseGameSocketResult {
  const { user } = useAuth();

  const subscribe = (cb: () => void) => gameSocket.subscribe(cb);
  const getSnapshot = () => gameSocket.status + '|' + gameSocket.balance + '|' + gameSocket.userId + '|' + (gameSocket.errorMessage ?? '');
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (user) {
      gameSocket.connect();
    } else {
      gameSocket.disconnect();
    }
  }, [user?.id]);

  return {
    status: gameSocket.status,
    balance: gameSocket.balance,
    userId: gameSocket.userId,
    errorMessage: gameSocket.errorMessage,
    refresh: () => gameSocket.refreshBalance(),
  };
}
