// Settings (from Home): the short state line under each menu row ("jane",
// "Content bar on · Large dashboard", "1 phone connected"), so a viewer, or
// support on the phone, can read it without opening the page. As Live TV's
// useHubStates: everything comes from the box, nothing here asks any server.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { useMediaBarEnabled } from '@/hooks/useMediaBarEnabled';
import { useDashboardSize } from '@/lib/dashboardSize';
import { useMailNotify } from '@/lib/snowMail';
import { useVersion } from '@/hooks/useVersion';
import { profileName, type Profile } from '@/lib/profiles';

/** The Settings menu's rows. */
export type SettingsPage = 'account' | 'home' | 'backgrounds' | 'profiles' | 'remote' | 'notifications' | 'language' | 'updates' | 'alerts' | 'ai';

/** What Settings already holds and the hook would otherwise read a second time. */
export interface SettingsStateInputs {
  kids: boolean;
  profile: Profile;
  phones: number;
  paired: boolean;
  /** Device alerts: null on a box that can't show them. */
  deviceAlertsOn: boolean | null;
  language: string;
}

/** The background in use, as MediaManager keeps it on the box. */
const readCustomBg = (): boolean => {
  try { return !!localStorage.getItem('snow-active-bg'); } catch { return false; }
};

/**
 * The state line of every row. `refresh` changes when Settings wants a fresh
 * read of what has no event of its own (the background): it passes its pane,
 * so coming back to the menu reads it again.
 */
export function useSettingsStates(inputs: SettingsStateInputs, refresh: unknown): Record<SettingsPage, string> {
  const { t } = useTranslation();
  const { account } = usePlayerAccount();
  const [barOn] = useMediaBarEnabled();
  const dashboard = useDashboardSize();
  const mailNotify = useMailNotify();
  const { version, isLoading } = useVersion();
  const [customBg, setCustomBg] = useState(readCustomBg);
  useEffect(() => { setCustomBg(readCustomBg()); }, [refresh]);

  const lang = SUPPORTED_LANGUAGES.find((l) => inputs.language.startsWith(l.code));
  const s = (k: string, o?: Record<string, unknown>) => t(`settings.hub.state.${k}`, o);

  return {
    account: account?.username || s('notSignedIn'),
    home: [
      s(barOn ? 'barOn' : 'barOff'),
      // A Kids profile has the content bar's switch only.
      inputs.kids ? '' : s(dashboard === 'large' ? 'dashLarge' : 'dashCompact'),
    ].filter(Boolean).join(' · '),
    backgrounds: s(customBg ? 'bgCustom' : 'bgStandard'),
    profiles: profileName(inputs.profile),
    remote: inputs.phones > 0 ? s('phones', { count: inputs.phones }) : s(inputs.paired ? 'paired' : 'notPaired'),
    notifications: [
      s(mailNotify ? 'postsOn' : 'postsOff'),
      inputs.deviceAlertsOn === null ? '' : s(inputs.deviceAlertsOn ? 'alertsOn' : 'alertsOff'),
    ].filter(Boolean).join(' · '),
    // The language in its own name, as on its tile.
    language: lang?.nativeName ?? '',
    updates: isLoading ? '' : s('version', { version }),
    alerts: s('admin'),
    ai: s('admin'),
  };
}
