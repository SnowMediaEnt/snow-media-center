// Sign the Live TV Player out of its line on this box: the saved login, the
// account details read from the panel, and a note that it was on purpose, so
// the quiet sign-in (playerAutoSignIn) does not sign the box straight back in.
// Used by the Player's own Sign out and by the Dashboard's, which signs out of
// both the Snow Media account and the Player.
import { clearCreds, clearPlayerAccount } from '@/lib/xtream';
import { markPlayerSignedOut } from '@/lib/playerAutoSignIn';
import { isDemo } from '@/lib/demoMode';

export async function signOutPlayer(): Promise<void> {
  // Demo: the demo account is pre-loaded; there is nothing to sign out of.
  if (isDemo()) return;
  await clearCreds();
  await clearPlayerAccount();
  markPlayerSignedOut();
}
