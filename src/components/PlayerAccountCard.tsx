import { Fragment, memo, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tv, Calendar, KeyRound, Users, LogOut, Hash } from 'lucide-react';
import { isPinLine } from '@/lib/pinSignIn';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { expDateToMs, serverDisplayName } from '@/lib/xtream';
import { signOutPlayer } from '@/lib/playerSignOut';
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
  /** Settings: one quiet panel — title, line badge and sign-out on one line,
   *  the details as short label/value pairs in columns underneath. */
  panel?: boolean;
  /** Panel only: Settings' remote focus on the sign-out button (its data-*
   *  attributes) and whether a first OK armed it ("press OK again"). */
  signOutFocus?: { attrs: Record<string, string>; focused: boolean; armed: boolean };
}

const PlayerAccountCard = memo(({ compact = false, actions, panel = false, signOutFocus }: Props) => {
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

  // The Player's own sign-out (owner, 2026-10-14): clearing the login alone
  // left no "signed out on purpose" note, so the next Live TV open signed the
  // box straight back in with the store (billing) account. It also stops
  // recordings and wipes the rewind buffer, as the Player's Sign out does.
  const handleSignOut = async () => {
    await signOutPlayer();
    toast({ title: t('liveAccount.playerCard.signedOutTitle'), description: t('liveAccount.playerCard.signedOutDesc') });
  };

  const rows: Array<[typeof KeyRound, string, ReactNode]> = [
    // A line signed in with a PIN shows the PIN's place, never the login behind it.
    ...(isPinLine(account)
      ? [[Hash, t('liveAccount.account.pin'), <span className="font-mono tracking-widest">••••• •••••</span>]] as Array<[typeof KeyRound, string, ReactNode]>
      : [
          [KeyRound, t('liveAccount.account.username'), <span className="font-medium truncate">{account.username}</span>],
          [KeyRound, t('liveAccount.account.password'), <span className="font-mono tracking-widest">••••••••</span>],
        ] as Array<[typeof KeyRound, string, ReactNode]>),
    [Calendar, t('liveAccount.account.expires'), <span className="font-medium">{expLabel}</span>],
    [Calendar, t('liveAccount.playerCard.daysLeftLabel'), <span className={`font-semibold ${daysColor}`}>{daysLabel}</span>],
    [Tv, t('liveAccount.account.status'), <span className="font-medium capitalize">{account.status || t('liveAccount.account.statusUnknown')}</span>],
    [Users, t('liveAccount.account.connections'), <span className="font-medium">{account.activeCons ?? 0}{account.maxConnections != null ? ` / ${account.maxConnections}` : ''}</span>],
  ];

  if (panel) {
    return (
      <section className="rounded-2xl bg-slate-800/55 border border-white/10 px-5 py-3.5" data-player-account-panel>
        <div className="flex items-center flex-wrap">
          <Tv className="w-5 h-5 text-brand-gold mr-3 shrink-0" />
          <h3 className="text-base font-semibold text-white mr-2">{t('liveAccount.playerCard.title')}</h3>
          <Badge className={`border mr-2 ${serverBadgeColor}`}>{serverDisplayName(account.serverLabel)}</Badge>
          {account.isTrial && (
            <Badge className="bg-amber-500/30 text-amber-100 border border-amber-400/40 mr-2">{t('liveAccount.account.trial')}</Badge>
          )}
          {/* An outline, not a white fill: in Settings only the remote's highlight may
              look highlighted (owner, 2026-10-29: one focus look). */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            {...(signOutFocus?.attrs ?? {})}
            className={`h-8 ml-auto border border-white/25 text-white hover:bg-white/10 ${signOutFocus ? (signOutFocus.armed ? 'tv-ring-danger' : 'tv-ring') : 'tv-focusable'} ${signOutFocus?.focused ? 'z-10' : ''}`}
          >
            <LogOut className="w-4 h-4 mr-2" /> {signOutFocus?.armed ? t('liveAccount.playerCard.confirmSignOut') : t('liveAccount.playerCard.signOutBtn')}
          </Button>
        </div>
        {/* Grid gap (not flex gap) is fine on the oldest box WebViews. */}
        <dl className="mt-2.5 sm:pl-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-sm">
          {rows.map(([, label, value]) => (
            <div key={label} className="flex items-baseline min-w-0">
              <dt className="text-white/55 whitespace-nowrap mr-1.5">{label}</dt>
              <dd className="text-white/90 min-w-0 truncate">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    );
  }

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
