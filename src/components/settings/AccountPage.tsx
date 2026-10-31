// Settings › My account: the Player (Live TV) line on this box with its
// sign-out, the Snow AI level, and "Rate Snow Media Center". An admin also
// gets the Player section's switch for every device here (it is about the
// account's Player, and Alerts / AI are panels with keys of their own).
import { useTranslation } from 'react-i18next';
import { Bot, ChevronRight, Star, Tv } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import PlayerAccountCard from '@/components/PlayerAccountCard';
import type { AiTier, AiTierInfo } from '@/lib/aiTiers';
import { PageNote, SettingRow, SettingsGroup, type PageFocus } from './SettingsRows';

interface Props {
  f: PageFocus;
  hasPlayerAccount: boolean;
  signOutArmed: boolean;
  aiTierShown: boolean;
  aiTier: AiTier;
  canPremium: boolean;
  aiPremium: AiTierInfo | null;
  onToggleAiTier: () => void;
  rateShown: boolean;
  onRate: () => void;
  isAdmin: boolean;
  playerEnabled: boolean;
  onTogglePlayer: (next: boolean) => void;
}

const AccountPage = ({
  f, hasPlayerAccount, signOutArmed, aiTierShown, aiTier, canPremium, aiPremium, onToggleAiTier,
  rateShown, onRate, isAdmin, playerEnabled, onTogglePlayer,
}: Props) => {
  const { t } = useTranslation();
  const premiumOn = aiTier === 'premium' && canPremium;
  const anyRow = aiTierShown || rateShown || isAdmin;
  return (
    <div className="space-y-3">
      {/* The panel draws nothing without a line on the box. */}
      <PlayerAccountCard
        panel
        signOutFocus={{ attrs: f.attrs('ui-player-signout'), focused: f.is('ui-player-signout'), armed: signOutArmed }}
      />
      {!hasPlayerAccount && !anyRow && <PageNote text={t('settings.hub.accountEmpty')} />}
      {anyRow && (
        <SettingsGroup>
          {aiTierShown && (
            <SettingRow
              {...f.attrs('ui-ai-tier')}
              focused={f.is('ui-ai-tier')}
              aria-pressed={premiumOn}
              onClick={() => { f.pick('ui-ai-tier'); onToggleAiTier(); }}
              icon={Bot}
              title={premiumOn ? t('settings.aiTier.titlePremium') : t('settings.aiTier.titleFree')}
              description={canPremium ? t('settings.aiTier.descPremium', { gems: aiPremium?.gems ?? '' }) : t('settings.aiTier.descSignIn')}
              control={<Switch tabIndex={-1} className="pointer-events-none" checked={premiumOn} disabled={!canPremium} aria-label={t('settings.aiTier.aria')} />}
            />
          )}
          {rateShown && (
            <SettingRow
              {...f.attrs('ui-rate-app')}
              focused={f.is('ui-rate-app')}
              onClick={() => { f.pick('ui-rate-app'); onRate(); }}
              icon={Star}
              title={t('review.settings.title')}
              description={t('review.settings.description')}
              control={<ChevronRight className="w-5 h-5 text-white/40" />}
            />
          )}
          {isAdmin && (
            <SettingRow
              {...f.attrs('ui-player-toggle')}
              focused={f.is('ui-player-toggle')}
              aria-pressed={playerEnabled}
              onClick={() => { f.pick('ui-player-toggle'); onTogglePlayer(!playerEnabled); }}
              icon={Tv}
              title={t('settings.player.title')}
              description={t('settings.player.description')}
              control={<Switch tabIndex={-1} className="pointer-events-none" checked={playerEnabled} aria-label={t('settings.player.aria')} />}
            />
          )}
        </SettingsGroup>
      )}
    </div>
  );
};

export default AccountPage;
