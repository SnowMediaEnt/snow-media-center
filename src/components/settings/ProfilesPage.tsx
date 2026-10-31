// Settings › Profiles: who is on this box, switching who's watching, adding or
// editing profiles, and the Parent PIN. A Kids profile only switches; adding,
// editing and the Parent PIN (signed in only) are for grown-ups.
import { useTranslation } from 'react-i18next';
import { Lock, UserPen, UsersRound } from 'lucide-react';
import { avatarColors, hasParentPin, loadProfiles, pinsAvailable, profileName, type Profile } from '@/lib/profiles';
import { SettingRow, SettingsGroup, type PageFocus } from './SettingsRows';
import { openProfiles } from '@/lib/profilesUi';

interface Props {
  f: PageFocus;
  kids: boolean;
  profiles: Profile[];
  currentId: string;
}

const ProfilesPage = ({ f, kids, profiles, currentId }: Props) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center px-1">
        {profiles.map((p) => (
          <div key={p.id} className="flex items-center mr-5 mb-1.5">
            <span
              className="inline-flex items-center justify-center rounded-lg font-bold text-white mr-2"
              style={{ width: 32, height: 32, backgroundColor: avatarColors(p.avatar).bg }}
            >
              {(profileName(p).trim()[0] || '?').toUpperCase()}
            </span>
            <span className="text-white/90 text-sm">
              {profileName(p)}{p.kidsLevel ? ` · ${t('settings.profiles.kidsTag')}` : ''}{p.pinHash ? ` · ${t('settings.profiles.pinTag')}` : ''}{p.id === currentId ? ` (${t('settings.profiles.watchingTag')})` : ''}
            </span>
          </div>
        ))}
      </div>
      <SettingsGroup>
        <SettingRow
          {...f.attrs('profiles-switch')}
          focused={f.is('profiles-switch')}
          onClick={() => { f.pick('profiles-switch'); openProfiles('pick'); }}
          icon={UsersRound}
          title={t('settings.profiles.switchTitle')}
          description={t('settings.profiles.switchDesc')}
        />
        {!kids && (
          <SettingRow
            {...f.attrs('profiles-manage')}
            focused={f.is('profiles-manage')}
            onClick={() => { f.pick('profiles-manage'); openProfiles('manage'); }}
            icon={UserPen}
            title={t('settings.profiles.manageTitle')}
            description={t('settings.profiles.manageDesc')}
          />
        )}
        {/* The Parent PIN: change it or turn it off. It needs an account (a
            forgotten one is reset through it). */}
        {!kids && pinsAvailable() && (
          <SettingRow
            {...f.attrs('profiles-parent')}
            focused={f.is('profiles-parent')}
            onClick={() => { f.pick('profiles-parent'); openProfiles('parent'); }}
            icon={Lock}
            title={t('settings.profiles.parentTitle')}
            description={hasParentPin() ? t('settings.profiles.parentDescOn') : loadProfiles().some((pr) => !!pr.kidsLevel) ? t('settings.profiles.parentDescOff') : t('settings.profiles.parentDescNoKids')}
          />
        )}
      </SettingsGroup>
      {!kids && !pinsAvailable() && <p className="text-sm text-white/60 px-1">{t('settings.profiles.parentSignIn')}</p>}
    </div>
  );
};

export default ProfilesPage;
