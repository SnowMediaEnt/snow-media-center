// Opening the profile screens from anywhere (the home screen's Kids button,
// Settings → Profiles and its Parent PIN row, the Settings lock on a Kids
// profile). ProfileGate listens and shows them.
import { OPEN_PROFILES_EVENT } from '@/lib/profiles';

export interface OpenProfilesDetail {
  mode: 'pick' | 'manage' | 'grownup' | 'parent';
  /** grownup: called once a grown-up's PIN (or the Parent PIN) was given. */
  onOk?: () => void;
}

export function openProfiles(mode: OpenProfilesDetail['mode'], onOk?: () => void): void {
  try { window.dispatchEvent(new CustomEvent<OpenProfilesDetail>(OPEN_PROFILES_EVENT, { detail: { mode, onOk } })); } catch { /* ignore */ }
}
