// Settings › Phone remote: pairing (QR code, the address and the code), the
// QR card offered whenever a text box is open, and unpairing every phone.
import { Trans, useTranslation } from 'react-i18next';
import { Keyboard, Unlink } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import PairingQR from '@/components/remote/PairingQR';
import { SettingRow, SettingsGroup, type PageFocus } from './SettingsRows';

interface Props {
  f: PageFocus;
  phones: number;
  paired: boolean;
  typingHint: boolean;
  onToggleHint: () => void;
  onUnpair: () => void;
}

const RemotePage = ({ f, phones, paired, typingHint, onToggleHint, onUnpair }: Props) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <section className="rounded-2xl bg-slate-800/55 border border-white/10 px-5 py-4 flex flex-wrap items-start">
        <div className="mr-6 mb-2">
          {/* Smaller on short layouts (960x540) so the rows under it stay on screen. */}
          <PairingQR size={window.innerHeight < 640 ? 140 : 200} />
        </div>
        <div className="flex-1 min-w-[16rem]">
          <h3 className="text-lg font-bold text-white mb-1">{t('settings.remote.title')}</h3>
          <ol className="text-white/80 space-y-0.5 mb-2 list-decimal pl-5" data-howto="set.remoteSteps">
            <li><Trans i18nKey="settings.remote.step1" components={{ 1: <span className="font-semibold text-white" /> }} /></li>
            <li>{t('settings.remote.step2')}</li>
            <li>{t('settings.remote.step3')}</li>
          </ol>
          <p className="text-sm text-white/60">
            {phones > 0 ? t('settings.remote.connected', { count: phones }) : paired ? t('settings.remote.paired') : t('settings.remote.none')}
            {' '}{t('settings.remote.stayPaired')}
          </p>
        </div>
      </section>
      <SettingsGroup>
        <SettingRow
          {...f.attrs('remote-hint')}
          focused={f.is('remote-hint')}
          aria-pressed={typingHint}
          onClick={() => { f.pick('remote-hint'); onToggleHint(); }}
          icon={Keyboard}
          title={t('settings.remote.typingHintTitle')}
          description={t('settings.remote.typingHintDesc')}
          control={<Switch tabIndex={-1} className="pointer-events-none" checked={typingHint} aria-label={t('settings.remote.typingHintTitle')} />}
        />
        <SettingRow
          {...f.attrs('remote-unpair')}
          focused={f.is('remote-unpair')}
          onClick={() => { f.pick('remote-unpair'); onUnpair(); }}
          icon={Unlink}
          title={t('settings.remote.unpairBtn')}
          description={t('settings.hub.unpairDesc')}
        />
      </SettingsGroup>
    </div>
  );
};

export default RemotePage;
