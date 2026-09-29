import { memo, useEffect, useMemo, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useMyUserServices,
  findUrgentService,
  daysUntil,
  expiryState,
  type ExpirySeverity,
} from '@/hooks/useUserServices';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { trackEvent } from '@/lib/analytics';
import { serverDisplayName } from '@/lib/xtream';

interface Props {
  onOpenDashboard?: () => void;
}

type UrgentSource =
  | { kind: 'service'; id: string; name: string; shown: string | null; days: number | null; severity: ExpirySeverity; label: string }
  | { kind: 'player'; id: string; name: string; shown: string | null; days: number | null; severity: ExpirySeverity; label: string };

const ServiceExpirationBanner = ({ onOpenDashboard }: Props) => {
  const { t } = useTranslation();
  const { services } = useMyUserServices();
  const { account: playerAccount, state: playerState, days: playerDays } = usePlayerAccount();
  const reportedRef = useRef<string | null>(null);

  const urgent = useMemo<UrgentSource | null>(() => {
    const urgentSvc = findUrgentService(services);
    const svcSource: UrgentSource | null = (() => {
      if (!urgentSvc) return null;
      const d = daysUntil(urgentSvc.expiration_date);
      const st = expiryState(d);
      if (!st.show) return null;
      return {
        kind: 'service',
        id: urgentSvc.id,
        // `name` goes to analytics as is; `shown` is what the viewer reads (null = use the translated fallback).
        name: urgentSvc.service_name || urgentSvc.service_type || 'Your service',
        shown: urgentSvc.service_name || urgentSvc.service_type || null,
        days: d,
        severity: st.severity,
        label: st.label,
      };
    })();

    const playerSource: UrgentSource | null = (() => {
      if (!playerAccount || !playerState.show) return null;
      return {
        kind: 'player',
        id: `player-${playerAccount.username}`,
        name: playerAccount.serverLabel || 'Player',
        shown: playerAccount.serverLabel ? serverDisplayName(playerAccount.serverLabel) : null,
        days: playerDays,
        severity: playerState.severity,
        label: playerState.label,
      };
    })();

    if (svcSource && playerSource) {
      const a = svcSource.days ?? Infinity;
      const b = playerSource.days ?? Infinity;
      return a <= b ? svcSource : playerSource;
    }
    return svcSource ?? playerSource;
  }, [services, playerAccount, playerState, playerDays]);

  useEffect(() => {
    if (!urgent) return;
    if (reportedRef.current === urgent.id) return;
    reportedRef.current = urgent.id;
    try {
      trackEvent('renewal_reminder_open', 'renewals', {
        source: urgent.kind,
        service: urgent.name,
        days: urgent.days,
      });
    } catch { void 0; }
  }, [urgent]);

  if (!urgent) return null;

  const critical = urgent.severity === 'critical';
  const warning = urgent.severity === 'warning';
  const who = urgent.shown ?? t(urgent.kind === 'service' ? 'account.banner.serviceFallback' : 'account.banner.playerFallback');
  const days = urgent.days;
  // A full sentence with the name, so the hook's short label is not used here.
  const msg = days === null ? t('account.banner.expiringShort')
    : days < 0 ? t('account.banner.expiredAgo', { name: who, count: Math.abs(days) })
    : days === 0 ? t('account.banner.expiresToday', { name: who })
    : days === 1 ? t('account.banner.expiresTomorrow', { name: who })
    : t('account.banner.expiresInDays', { name: who, count: days });

  const handleClick = () => {
    try {
      trackEvent('renewal_reminder_click', 'renewals', {
        source: urgent.kind,
        service: urgent.name,
        days: urgent.days,
      });
    } catch { void 0; }
    onOpenDashboard?.();
  };

  const colorClass = critical
    ? 'bg-red-600 text-white shadow-red-500/40'
    : warning
      ? 'bg-amber-500 text-black shadow-amber-500/40'
      : 'bg-sky-500 text-black shadow-sky-500/40';

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`pointer-events-auto flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium shadow-lg transition-all hover:scale-105 max-w-full min-w-0 whitespace-nowrap ${colorClass}`}
    >
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <span className="hidden sm:inline truncate min-w-0">{msg}</span>
      <span className="sm:hidden truncate min-w-0">{t('account.banner.expiringShort')}</span>
      <span className="underline opacity-90 flex-shrink-0">{t('account.banner.manageBtn')}</span>
    </button>
  );
};

export default memo(ServiceExpirationBanner);
