import { memo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tv, Calendar, KeyRound, Users, LogOut } from 'lucide-react';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { clearPlayerAccount, clearCreds, expDateToMs } from '@/lib/xtream';
import { useToast } from '@/hooks/use-toast';

/**
 * Read-only summary of the locally-stored Xtream player account, plus a
 * "Sign out of player" button. Renders nothing if no player account exists.
 * Lives alongside (but separate from) the existing manual
 * "My Devices & Services" editor.
 */
const PlayerAccountCard = memo(() => {
  const { account, state, days } = usePlayerAccount();
  const { toast } = useToast();

  if (!account) return null;

  const expMs = expDateToMs(account.expDate);
  const expLabel = expMs
    ? new Date(expMs).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : 'No expiration on file';

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
      : `${days} days left`;

  const serverBadgeColor = account.serverLabel.toLowerCase().includes('vibez')
    ? 'bg-fuchsia-600/30 text-fuchsia-100 border-fuchsia-400/40'
    : 'bg-sky-600/30 text-sky-100 border-sky-400/40';

  const handleSignOut = async () => {
    await clearCreds();
    await clearPlayerAccount();
    toast({ title: 'Player signed out', description: 'You can sign back in from the Player.' });
  };

  return (
    <Card className="bg-gradient-to-br from-slate-700 to-slate-900 border-slate-600 p-6">
      <div className="flex items-start gap-3 mb-4">
        <Tv className="w-6 h-6 text-brand-gold mt-1 shrink-0" />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-bold text-white">Player Account</h3>
            <Badge className={`border ${serverBadgeColor}`}>{account.serverLabel}</Badge>
            {account.isTrial && (
              <Badge className="bg-amber-500/30 text-amber-100 border border-amber-400/40">Trial</Badge>
            )}
          </div>
          <p className="text-sm text-white/70 mt-1">
            Signed in to your IPTV panel — used by the Player section.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div className="flex items-center gap-2 text-white/90">
          <KeyRound className="w-4 h-4 text-brand-ice" />
          <span className="text-white/60">Username:</span>
          <span className="font-medium break-all">{account.username}</span>
        </div>
        <div className="flex items-center gap-2 text-white/90">
          <KeyRound className="w-4 h-4 text-brand-ice" />
          <span className="text-white/60">Password:</span>
          <span className="font-mono tracking-widest">••••••••</span>
        </div>
        <div className="flex items-center gap-2 text-white/90">
          <Calendar className="w-4 h-4 text-brand-ice" />
          <span className="text-white/60">Expires:</span>
          <span className="font-medium">{expLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-brand-ice" />
          <span className="text-white/60">Days left:</span>
          <span className={`font-semibold ${daysColor}`}>{daysLabel}</span>
        </div>
        <div className="flex items-center gap-2 text-white/90">
          <Tv className="w-4 h-4 text-brand-ice" />
          <span className="text-white/60">Status:</span>
          <span className="font-medium capitalize">{account.status || 'Unknown'}</span>
        </div>
        <div className="flex items-center gap-2 text-white/90">
          <Users className="w-4 h-4 text-brand-ice" />
          <span className="text-white/60">Connections:</span>
          <span className="font-medium">
            {account.activeCons ?? 0}
            {account.maxConnections != null ? ` / ${account.maxConnections}` : ''}
          </span>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <Button
          variant="white"
          size="sm"
          onClick={handleSignOut}
          className="tv-focusable"
        >
          <LogOut className="w-4 h-4 mr-2" /> Sign out of player
        </Button>
      </div>
    </Card>
  );
});

PlayerAccountCard.displayName = 'PlayerAccountCard';
export default PlayerAccountCard;
