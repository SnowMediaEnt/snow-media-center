import { Fragment, memo, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tv, Calendar, KeyRound, Users, LogOut } from 'lucide-react';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { clearPlayerAccount, clearCreds, expDateToMs, serverDisplayName } from '@/lib/xtream';
import { useToast } from '@/hooks/use-toast';
import { formatDate } from '@/i18n/format';
import { useTranslation } from 'react-i18next';

/**
 * Read-only summary of the locally-stored Xtream player account, plus a
 * "Sign out of player" button. Renders nothing if no player account exists.
 * Lives alongside (but separate from) the existing manual
 * "My Devices & Services" editor.
 */
interface Props {
  /** Narrow column on the one-screen Dashboard: no card chrome, no repeated
   *  title, label/value rows that never wrap mid-word. */
  compact?: boolean;
  /** Compact only: something to sit beside the sign-out button (the
   *  Dashboard's renewal-reminder link), so the column stays short. */
  actions?: ReactNode;
}

const PlayerAccountCard = memo(({ compact = false, actions }: Props) => {
  const { t } = useTranslation();
  const { account, state, days } = usePlayerAccount();
  const { toast } = useToast();

  if (!account) return null;

  const expMs = expDateToMs(account.expDate);
  const expLabel = expMs
    ? formatDate(expMs)
    : t('liveAccount.playerCard.noExpiration');

  const daysColor =
    state.severity === 'critical'
      ? 'text-red-300'
      : state.severity === 'warning'
        ? 'text-amber-300'
        : 'text-emerald-300';

  const daysLabel = days === null
    ? '—'
    : state.show
      ? state.label
      : t('liveAccount.account.daysLeft', { count: days });

  const serverBadgeColor = account.serverLabel.toLowerCase().includes('vibez')
    ? 'bg-fuchsia-600/30 text-fuchsia-100 border-fuchsia-400/40'
    : 'bg-sky-600/30 text-sky-100 border-sky-400/40';

  const handleSignOut = async () => {
    await clearCreds();
    await clearPlayerAccount();
    toast({ title: t('liveAccount.playerCard.signedOutTitle'), description: t('liveAccount.playerCard.signedOutDesc') });
  };

  const rows: Array<[typeof KeyRound, string, ReactNode]> = [
    [KeyRound, t('liveAccount.account.username'), <span className="font-medium truncate">{account.username}</span>],
    [KeyRound, t('liveAccount.account.password'), <span className="font-mono tracking-widest">••••••••</span>],
    [Calendar, t('liveAccount.account.expires'), <span className="font-medium">{expLabel}</span>],
    [Calendar, t('liveAccount.playerCard.daysLeftLabel'), <span className={`font-semibold ${daysColor}`}>{daysLabel}</span>],
    [Tv, t('liveAccount.account.status'), <span className="font-medium capitalize">{account.status || t('liveAccount.account.statusUnknown')}</span>],
    [Users, t('liveAccount.account.connections'), <span className="font-medium">{account.activeCons ?? 0}{account.maxConnections != null ? ` / ${account.maxConnections}` : ''}</span>],
  ];

  if (compact) {
    return (
      <div className="text-sm">
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <Badge className={`border ${serverBadgeColor}`}>{serverDisplayName(account.serverLabel)}</Badge>
          {account.isTrial && (
            <Badge className="bg-amber-500/30 text-amber-100 border border-amber-400/40">{t('liveAccount.account.trial')}</Badge>
          )}
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 items-center">
          {rows.map(([Icon, label, value]) => (
            <Fragment key={label}>
              <span className="flex items-center gap-1.5 text-white/60 whitespace-nowrap"><Icon className="w-3.5 h-3.5 text-brand-ice" />{label}</span>
              <span className="text-white/90 min-w-0 truncate whitespace-nowrap">{value}</span>
            </Fragment>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="white" size="sm" onClick={handleSignOut} className="tv-focusable h-9">
            <LogOut className="w-4 h-4 mr-2" /> {t('liveAccount.playerCard.signOutBtn')}
          </Button>
          {actions}
        </div>
      </div>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-slate-700 to-slate-900 border-slate-600 p-6">
      <div className="flex items-start gap-3 mb-4">
        <Tv className="w-6 h-6 text-brand-gold mt-1 shrink-0" />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-bold text-white">{t('liveAccount.playerCard.title')}</h3>
            <Badge className={`border ${serverBadgeColor}`}>{serverDisplayName(account.serverLabel)}</Badge>
            {account.isTrial && (
              <Badge className="bg-amber-500/30 text-amber-100 border border-amber-400/40">{t('liveAccount.account.trial')}</Badge>
            )}
          </div>
          <p className="text-sm text-white/70 mt-1">
            {t('liveAccount.playerCard.subtitle')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        {rows.map(([Icon, label, value]) => (
          <div key={label} className="flex items-center gap-2 text-white/90 min-w-0">
            <Icon className="w-4 h-4 text-brand-ice shrink-0" />
            <span className="text-white/60 whitespace-nowrap">{label}:</span>
            {value}
          </div>
        ))}
      </div>

      <div className="mt-5 flex justify-end">
        <Button
          variant="white"
          size="sm"
          onClick={handleSignOut}
          className="tv-focusable"
        >
          <LogOut className="w-4 h-4 mr-2" /> {t('liveAccount.playerCard.signOutBtn')}
        </Button>
      </div>
    </Card>
  );
});

PlayerAccountCard.displayName = 'PlayerAccountCard';
export default PlayerAccountCard;
