// Settings › Home screen: the content bar (on or off, where its tiles come
// from and what it shows), the Dashboard's size, and the bottom tiles' reset.
// A Kids profile gets the content bar's switch only: its own Home stays as it is.
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, LayoutGrid, Rows3, Star, Tv } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { BAR_SHOWS, BAR_SHOW_KEYS, BAR_SOURCES, BAR_SOURCE_KEYS, chooseBarShow, chooseBarSource, type BarShow, type BarSource } from '@/lib/homeBar';
import { ChoiceChips, SettingRow, SettingsGroup, type PageFocus } from './SettingsRows';

interface Props {
  f: PageFocus;
  kids: boolean;
  mediaBarEnabled: boolean;
  onToggleBar: () => void;
  largeDashboard: boolean;
  onToggleDashboard: () => void;
  barSource: BarSource | 'off';
  barShow: BarShow;
  onCycleSource: () => void;
  onCycleShow: () => void;
  onResetTiles: () => void;
}

const HomeScreenPage = ({
  f, kids, mediaBarEnabled, onToggleBar, largeDashboard, onToggleDashboard,
  barSource, barShow, onCycleSource, onCycleShow, onResetTiles,
}: Props) => {
  const { t } = useTranslation();
  return (
    <SettingsGroup data-settings-home aria-label={t('homeEdit.settings.sectionTitle')}>
      <SettingRow
        {...f.attrs('ui-content-bar-toggle')}
        focused={f.is('ui-content-bar-toggle')}
        aria-pressed={mediaBarEnabled}
        onClick={() => { f.pick('ui-content-bar-toggle'); onToggleBar(); }}
        data-howto="set.contentBar"
        icon={Tv}
        title={t('settings.contentBar.title')}
        description={t('settings.contentBar.description')}
        control={<Switch tabIndex={-1} className="pointer-events-none" checked={mediaBarEnabled} aria-label={t('settings.contentBar.aria')} />}
      />
      {!kids && (<>
        <SettingRow
          {...f.attrs('ui-home-bar-source')}
          focused={f.is('ui-home-bar-source')}
          onClick={() => { f.pick('ui-home-bar-source'); onCycleSource(); }}
          icon={Rows3}
          title={t('homeEdit.settings.sourceTitle')}
          description={t('homeEdit.settings.sourceDesc')}
        >
          <ChoiceChips
            choices={BAR_SOURCES}
            value={barSource}
            label={(c) => t(BAR_SOURCE_KEYS[c])}
            onPick={(c) => { f.pick('ui-home-bar-source'); chooseBarSource(c); }}
          />
        </SettingRow>
        <SettingRow
          {...f.attrs('ui-home-bar-show')}
          focused={f.is('ui-home-bar-show')}
          onClick={() => { f.pick('ui-home-bar-show'); onCycleShow(); }}
          icon={Star}
          title={t('homeEdit.settings.showTitle')}
          description={t('homeEdit.settings.showDesc')}
        >
          <ChoiceChips
            choices={BAR_SHOWS}
            value={barShow}
            label={(c) => t(BAR_SHOW_KEYS[c])}
            onPick={(c) => { f.pick('ui-home-bar-show'); chooseBarShow(c); }}
          />
        </SettingRow>
        <SettingRow
          {...f.attrs('ui-dashboard-size-toggle')}
          focused={f.is('ui-dashboard-size-toggle')}
          aria-pressed={largeDashboard}
          onClick={() => { f.pick('ui-dashboard-size-toggle'); onToggleDashboard(); }}
          icon={LayoutDashboard}
          title={t('settings.dashboardSize.title')}
          description={t('settings.dashboardSize.description')}
          control={<Switch tabIndex={-1} className="pointer-events-none" checked={largeDashboard} aria-label={t('settings.dashboardSize.title')} />}
        />
        <SettingRow
          {...f.attrs('ui-home-tiles-reset')}
          focused={f.is('ui-home-tiles-reset')}
          onClick={() => { f.pick('ui-home-tiles-reset'); onResetTiles(); }}
          icon={LayoutGrid}
          title={t('homeEdit.settings.tilesTitle')}
          description={t('homeEdit.settings.tilesDesc')}
          control={<span className="inline-flex items-center h-9 rounded-lg border border-white/20 px-3 text-sm font-semibold text-white">{t('homeEdit.settings.resetBtn')}</span>}
        />
      </>)}
    </SettingsGroup>
  );
};

export default HomeScreenPage;
