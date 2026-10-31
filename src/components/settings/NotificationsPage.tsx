// Settings › Notifications: Snow Media's posts (the count on Support and the
// heads-up on Home) and the service alerts this device shows outside the app.
import { useTranslation } from 'react-i18next';
import { Bell, Newspaper } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { SettingRow, SettingsGroup, type PageFocus } from './SettingsRows';

interface Props {
  f: PageFocus;
  mailNotify: boolean;
  onToggleMail: () => void;
  /** The device-alerts row is drawn (a box that can show them, or a How-to picture). */
  alertsShown: boolean;
  alertsOn: boolean;
  alertsBusy: boolean;
  alertsBlocked: boolean;
  onToggleAlerts: () => void;
}

const NotificationsPage = ({ f, mailNotify, onToggleMail, alertsShown, alertsOn, alertsBusy, alertsBlocked, onToggleAlerts }: Props) => {
  const { t } = useTranslation();
  return (
    <SettingsGroup>
      <SettingRow
        {...f.attrs('ui-mail-notify-toggle')}
        focused={f.is('ui-mail-notify-toggle')}
        aria-pressed={mailNotify}
        onClick={() => { f.pick('ui-mail-notify-toggle'); onToggleMail(); }}
        data-howto="set.postNotify"
        icon={Newspaper}
        title={t('settings.postNotify.title')}
        description={t('settings.postNotify.description')}
        control={<Switch tabIndex={-1} className="pointer-events-none" checked={mailNotify} aria-label={t('settings.postNotify.title')} />}
      />
      {alertsShown && (
        <SettingRow
          {...f.attrs('ui-device-alerts-toggle')}
          focused={f.is('ui-device-alerts-toggle')}
          aria-pressed={alertsOn}
          onClick={() => { f.pick('ui-device-alerts-toggle'); if (!alertsBusy) onToggleAlerts(); }}
          data-howto="set.alerts"
          icon={Bell}
          title={t('settings.deviceAlerts.title')}
          description={t('settings.deviceAlerts.description')}
          control={<Switch tabIndex={-1} className="pointer-events-none" checked={alertsOn} disabled={alertsBusy} aria-label={t('settings.deviceAlerts.title')} />}
        >
          {alertsBlocked && <p className="text-sm text-amber-300 mt-1">{t('settings.deviceAlerts.blocked')}</p>}
        </SettingRow>
      )}
    </SettingsGroup>
  );
};

export default NotificationsPage;
