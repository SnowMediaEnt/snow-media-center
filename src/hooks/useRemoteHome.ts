// The phone remote's Home button. The box remote's own Home only sends the
// app to the background, so whatever was on screen survives it; the phone's
// Home brings up SMC's home screen instead, so it must not pull a screen away
// in the middle of something. It yields where Back yields:
//   - an open dialog or overlay owns input: Home does nothing (answer it first);
//   - a casino game owns Back, because a wager may be committed: Home goes
//     through the game's Back guard, which says "finish this hand first"
//     mid-round or lets the game go when it is safe, and Home then carries on
//     to the home screen.
import { useEffect, useRef } from 'react';
import { GLOBAL_MODAL_SELECTOR } from '@/components/games/shared/gameInput';
import { gameOwnsHardwareBack } from '@/components/games/shared/gameBack';
import { REMOTE_HOME_EVENT, pressRemoteKey } from '@/lib/phoneRemote';

// Radix dialogs mark themselves open with data-state, not aria-modal.
const OPEN_OVERLAY = `${GLOBAL_MODAL_SELECTOR}, [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]`;
/** How long after Home a game letting go still means "on to home". */
const CARRY_ON_MS = 1500;

export type RemoteHomeStep = 'ignore' | 'back' | 'home';

export function remoteHomeStep(view: string): RemoteHomeStep {
  if (document.querySelector(OPEN_OVERLAY)) return 'ignore';
  if (view.startsWith('game-') && gameOwnsHardwareBack()) return 'back';
  return 'home';
}

export function useRemoteHome(currentView: string, navigateTo: (view: string) => void): void {
  const viewRef = useRef(currentView);
  viewRef.current = currentView;
  const navigateRef = useRef(navigateTo);
  navigateRef.current = navigateTo;
  const viaGameAt = useRef(0);

  useEffect(() => {
    const onHome = () => {
      const step = remoteHomeStep(viewRef.current);
      if (step === 'ignore') return;
      if (step === 'back') {
        viaGameAt.current = Date.now();
        void pressRemoteKey('back');
        return;
      }
      navigateRef.current('home');
    };
    window.addEventListener(REMOTE_HOME_EVENT, onHome);
    return () => window.removeEventListener(REMOTE_HOME_EVENT, onHome);
  }, []);

  // The guard let the game go: on to home, unless something opened meanwhile.
  useEffect(() => {
    const at = viaGameAt.current;
    if (!at || currentView.startsWith('game-')) return;
    viaGameAt.current = 0;
    if (Date.now() - at < CARRY_ON_MS && remoteHomeStep(currentView) === 'home') navigateRef.current('home');
  }, [currentView]);
}
