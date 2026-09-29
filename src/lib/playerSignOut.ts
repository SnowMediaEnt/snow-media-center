// Sign the Live TV Player out of its line on this box: the saved login, the
// account details read from the panel, and a note that it was on purpose, so
// the quiet sign-in (playerAutoSignIn) does not sign the box straight back in.
// Used by the Player's own Sign out and by the Dashboard's, which signs out of
// both the Snow Media account and the Player.
//
// The line's streams go with it: the rewind buffer (channel data on the box's
// storage) is wiped, every recording stops — a recording keeps a connection
// to the line open, and its folder is the viewer's to keep — and every
// scheduled recording is cancelled (a schedule belongs to the line it was made
// on, and would only fail at its start). All are older-app safe: a build
// without the plugin must not block sign-out.
import { clearCreds, clearPlayerAccount } from '@/lib/xtream';
import { markPlayerSignedOut } from '@/lib/playerAutoSignIn';
import { isDemo } from '@/lib/demoMode';
import { SnowPlayer } from '@/capacitor/SnowPlayer';
import { SnowRecorder, notifyRecordingsChanged } from '@/capacitor/SnowRecorder';

export async function signOutPlayer(): Promise<void> {
  // Demo: the demo account is pre-loaded; there is nothing to sign out of.
  if (isDemo()) return;
  try { await SnowPlayer.timeshiftWipe(); } catch { /* older app, or web */ }
  try { await SnowRecorder.stop(); } catch { /* older app, or web */ }
  try { await SnowRecorder.cancelSchedule(); } catch { /* older app, or web */ }
  notifyRecordingsChanged();
  await clearCreds();
  await clearPlayerAccount();
  markPlayerSignedOut();
}
