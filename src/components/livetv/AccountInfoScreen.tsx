import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Tv, Calendar, KeyRound, Users, Server, Clock, ShieldCheck, LogOut, Eye, EyeOff, RefreshCw, Library, CreditCard, MonitorSmartphone, Loader2,
} from 'lucide-react';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { expDateToMs } from '@/lib/xtream';
import { readCounts } from '@/lib/catalogCounts';
import { formatDate, formatDateTime, formatNumber } from '@/i18n/format';
import { useTranslation } from 'react-i18next';
import { trackEvent } from '@/lib/analytics';
import { renewableServiceForLine } from '@/lib/billing';
import { isDemo } from '@/lib/demoMode';
import RenewQR from './RenewQR';
import LineDevicesPanel from './LineDevicesPanel';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';

interface Props {
  onBack: () => void;
  onSignOut: () => void;
  onChangeCredentials: () => void;
  /** Drawn beside the Settings menu: no header of its own, Back / Left at the edge return to the menu. */
  embedded?: boolean;
  /** Embedded only: whether the remote is on this page (false while it is on the menu). */
  active?: boolean;
  /**
   * Billing on (Live TV Settings › My Account): opens the billing account's
   * view. "Plans & billing" opens it as it is; Renew opens it renewing this
   * line (`renewServiceId`) when the line is one of the billing account's
   * services, and otherwise shows the renewal QR as before. Renew's label
   * never changes: where it goes is decided when it is pressed.
   */
  onOpenBilling?: (renewServiceId?: number) => void;
  /** Coming back from the billing view: the button that opened it has the highlight. */
  initialFocus?: 'renew' | 'plans';
  /**
   * The line Live TV is signed into (Live TV Settings › My Account): "Devices
   * on this line" opens its devices in this page (LineDevicesPanel), Back
   * returns here. Absent: not offered.
   */
  devicesLine?: { host: string; username: string } | null;
}

const fmtDate = (ms: number | null) => (ms ? formatDateTime(ms) : '—');

const fmtDay = (ms: number | null) => (ms ? formatDate(ms) : '—');

interface Row { label: string; value: React.ReactNode; icon: typeof Tv; mono?: boolean }

/** The column's buttons (Back only when the page has its own header). */
type ActionId = 'back' | 'showPwd' | 'change' | 'renew' | 'plans' | 'devices' | 'signout';

/**
 * Read-only Xtream account info screen (Live TV Settings -> My Account).
 * Back sits top-left; the actions stand in a column beside the details, so
 * the remote's Up / Down walk Back -> Show password -> Change login -> Renew
 * -> (Plans & billing) -> (Devices on this line) -> Sign out. (They were one
 * row across the top that only Left / Right reached, which viewers found
 * confusing — owner, 2026-10-14.) The highlight follows a button, not a
 * place, so a button that appears late (billing loads) doesn't move it.
 * Sign out asks once: the first OK says "Press OK again", moving or Back
 * takes that back.
 */
const AccountInfoScreen = memo(({
  onBack, onSignOut, onChangeCredentials, embedded = false, active = true, onOpenBilling, initialFocus, devicesLine = null,
}: Props) => {
  const { t } = useTranslation();
  const { account, state, days } = usePlayerAccount();
  const [showPwd, setShowPwd] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  /** Renew is finding out where it goes (the billing account's services). */
  const [renewBusy, setRenewBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Renew is available at ANY days-left value (people renew early) but never in demo mode.
  const showRenew = !isDemo() && !!account?.username;
  const ids = useMemo<ActionId[]>(() => [
    ...(embedded ? [] : ['back' as const]),
    'showPwd', 'change',
    ...(showRenew ? ['renew' as const] : []),
    ...(onOpenBilling ? ['plans' as const] : []),
    ...(devicesLine ? ['devices' as const] : []),
    'signout',
  ], [embedded, showRenew, onOpenBilling, devicesLine]);
  const [focus, setFocusRaw] = useState<ActionId>(initialFocus ?? 'showPwd');
  // Any move takes back Sign out's question.
  const setFocus = useCallback((id: ActionId) => { setFocusRaw(id); setConfirmOut(false); }, []);
  // A button that went away hands the highlight to the first one.
  const shownFocus: ActionId = ids.includes(focus) ? focus : ids[embedded ? 0 : 1];
  const stateRef = useRef({ ids, focus: shownFocus, confirmOut });
  stateRef.current = { ids, focus: shownFocus, confirmOut };
  // The remote went back to the Settings menu by a tap there: this page is itself again.
  useEffect(() => { if (!active) { setDevicesOpen(false); setConfirmOut(false); } }, [active]);

  const showRenewQr = () => {
    try { trackEvent('renew_qr_shown', 'player', { server: account?.serverLabel || '', days_left: days }); } catch { /* ignore */ }
    setShowQR(true);
  };
  /** Billing on and this line one of the billing account's services: its renewal there; else the QR. */
  const openRenew = async () => {
    if (renewBusy) return;
    if (onOpenBilling && account?.username) {
      setRenewBusy(true);
      const serviceId = await renewableServiceForLine(account.username);
      if (!alive.current) return;
      setRenewBusy(false);
      if (serviceId != null) { onOpenBilling(serviceId); return; }
    }
    showRenewQr();
  };
  const signOutPressed = () => {
    if (!stateRef.current.confirmOut) { setConfirmOut(true); return; }
    setConfirmOut(false);
    onSignOut();
  };
  const press = (id: ActionId) => {
    if (id === 'back') onBack();
    else if (id === 'showPwd') setShowPwd((v) => !v);
    else if (id === 'change') onChangeCredentials();
    else if (id === 'renew') void openRenew();
    else if (id === 'plans') onOpenBilling?.();
    else if (id === 'devices') setDevicesOpen(true);
    else if (id === 'signout') signOutPressed();
  };
  const pressRef = useRef(press);
  pressRef.current = press;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (embedded && !active) return; // the remote is on the Settings menu
      if (showQR || devicesOpen) return; // RenewQR, or the line's devices, own the keyboard
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;
      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        // Back first takes back Sign out's question (one Back, one step).
        if (stateRef.current.confirmOut) { setConfirmOut(false); return; }
        onBack();
        return;
      }
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      // Up / Down through the column, stopping at the ends. Left / Right are
      // sideways: Left goes to what is left of the column, the Settings menu
      // (embedded) or Back; Right has nothing to go to (the details are not
      // selectable). They used to move up and down the column too, so Left
      // from Renew went up instead of to the menu (owner, 2026-10-16).
      const { ids: list, focus: cur } = stateRef.current;
      const at = Math.max(0, list.indexOf(cur));
      if (e.key === 'ArrowLeft') { if (embedded) onBack(); else setFocus('back'); return; }
      if (e.key === 'ArrowRight') return;
      if (e.key === 'ArrowUp') setFocus(list[Math.max(0, at - 1)]);
      else if (e.key === 'ArrowDown') setFocus(list[Math.min(list.length - 1, at + 1)]);
      else if (!e.repeat) pressRef.current(cur);
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onBack, setFocus, showQR, devicesOpen, embedded, active]);

  if (devicesOpen && devicesLine) {
    return <LineDevicesPanel embedded active={active} host={devicesLine.host} username={devicesLine.username} viaSupport onBack={() => setDevicesOpen(false)} />;
  }

  if (!account) {
    return (
      <div className={embedded ? 'h-full flex items-center justify-center text-white' : 'min-h-screen flex items-center justify-center text-white bg-black/70'}>
        <Card className="rounded-2xl p-6 bg-slate-900/80 border-slate-700 text-center">
          <p className="text-white/80 mb-4">{t('liveAccount.account.noAccount')}</p>
          <BackButton onClick={onBack} label={t('common.back')} />
        </Card>
      </div>
    );
  }

  if (showQR) {
    return (
      <div className={embedded ? 'h-full flex items-center justify-center text-white p-2' : 'min-h-screen flex items-center justify-center text-white bg-black/70 p-6'}>
        <Card className="rounded-3xl bg-gradient-to-br from-slate-800 to-slate-950 border-slate-700 p-8 shadow-xl">
          <RenewQR username={account.username} serverLabel={account.serverLabel} onBack={() => setShowQR(false)} />
        </Card>
      </div>
    );
  }

  const expMs = expDateToMs(account.expDate);
  const createdMs = expDateToMs(account.createdAt);
  const status = account.status || t('liveAccount.account.statusUnknown');
  const isExpired = /expired|disabled|banned/i.test(account.status || '') || (days !== null && days < 0);
  const statusBadge = isExpired
    ? 'bg-red-600/30 text-red-100 border-red-400/40'
    : 'bg-emerald-600/30 text-emerald-100 border-emerald-400/40';
  const statusLabel = isExpired ? t('liveAccount.account.statusExpired') : ((account.status || '').toLowerCase() === 'active' ? t('liveAccount.account.statusActive') : status);

  const daysColor = state.severity === 'critical'
    ? 'text-red-300'
    : state.severity === 'warning'
      ? 'text-amber-300'
      : 'text-emerald-300';
  const daysLabel = days === null ? '—' : state.show ? state.label : t('liveAccount.account.daysLeft', { count: days });

  // What the service carries, as far as the Player has measured it. Live TV
  // counts itself in the background; movies and series fill in as their
  // categories are opened. Nothing is shown for a figure nobody has measured.
  const catalogue = (() => {
    const parts: string[] = [];
    const live = readCounts(account, 'live').total;
    const vod = readCounts(account, 'vod').total;
    const series = readCounts(account, 'series').total;
    if (live != null) parts.push(t('liveAccount.account.countChannels', { count: live, num: formatNumber(live) }));
    if (vod != null) parts.push(t('liveAccount.account.countMovies', { count: vod, num: formatNumber(vod) }));
    if (series != null) parts.push(t('liveAccount.account.countSeries', { count: series, num: formatNumber(series) }));
    return parts.join(' · ');
  })();

  const rows: Row[] = [
    { label: t('liveAccount.account.username'),  icon: KeyRound, value: <span className="break-all">{account.username}</span> },
    { label: t('liveAccount.account.password'),  icon: KeyRound, mono: true, value: (
      <span className="font-mono tracking-widest break-all">
        {showPwd ? account.password : '•'.repeat(Math.max(8, account.password.length))}
      </span>
    )},
    { label: t('liveAccount.account.status'),    icon: ShieldCheck, value: (
      <Badge className={`border ${statusBadge}`}>{statusLabel}</Badge>
    )},
    { label: t('liveAccount.account.expires'),   icon: Calendar, value: (
      <span><span className="font-medium">{fmtDay(expMs)}</span>
        <span className={`ml-2 text-sm font-semibold ${daysColor}`}>({daysLabel})</span>
      </span>
    )},
    { label: t('liveAccount.account.trial'),     icon: ShieldCheck, value: account.isTrial ? t('common.yes') : t('common.no') },
    { label: t('liveAccount.account.connections'), icon: Users, value: t('liveAccount.account.connectionsValue', { active: account.activeCons ?? 0, max: account.maxConnections ?? '—' }) },
    ...(catalogue ? [{ label: t('liveAccount.account.catalog'), icon: Library, value: catalogue } as Row] : []),
    { label: t('liveAccount.account.created'),   icon: Clock,  value: fmtDate(createdMs) },
    { label: t('liveAccount.account.server'),    icon: Server, value: (
      <span>{account.serverLabel}
        <span className="ml-2 text-white/70 text-xs break-all">{account.host}</span>
      </span>
    )},
  ];

  const ACTION_LOOK: Record<Exclude<ActionId, 'back'>, { icon: typeof Tv; label: string }> = {
    showPwd: { icon: showPwd ? EyeOff : Eye, label: showPwd ? t('liveAccount.account.hidePasswordBtn') : t('liveAccount.account.showPasswordBtn') },
    change: { icon: KeyRound, label: t('liveAccount.account.changeCredentialsBtn') },
    renew: { icon: renewBusy ? Loader2 : RefreshCw, label: t('liveAccount.account.renewBtn') },
    plans: { icon: CreditCard, label: t('liveAccount.account.plansBtn') },
    devices: { icon: MonitorSmartphone, label: t('lineDevices.hub.menuLabel') },
    signout: { icon: LogOut, label: confirmOut ? t('liveAccount.hub.signOutConfirm') : t('common.signOut') },
  };
  const actions = ids.filter((id): id is Exclude<ActionId, 'back'> => id !== 'back');

  return (
    <div className={embedded ? 'h-full min-h-0 overflow-hidden flex flex-col text-white' : 'h-screen overflow-hidden flex flex-col text-white bg-black/70'}>
      {!embedded && (
        <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 bg-black/30">
          <BackButton
            onClick={onBack}
            label={t('common.back')}
            data-player-header-btn=""
            focused={shownFocus === 'back'}
          />
          <div className="flex items-center gap-2">
            <Tv className="w-7 h-7 text-brand-gold" />
            <h1 className="text-2xl font-quicksand font-bold text-white">{t('liveAccount.account.title')}</h1>
          </div>
        </div>
      )}

      <div className={embedded ? 'flex-1 overflow-auto p-1' : 'flex-1 overflow-auto p-6'}>
        {/* Margins, not flex gap: older box WebViews (Chrome < 84) ignore gap. */}
        <div className="mx-auto w-full max-w-5xl flex flex-col md:flex-row md:items-start">
          {/* Beside the Settings menu the columns are narrower, so the details keep two columns at 960 px. */}
          <div className={`space-y-3 shrink-0 mb-4 md:mb-0 ${embedded ? 'md:w-48 lg:w-60 md:mr-4' : 'md:w-72 md:mr-6'}`} data-account-actions>
            {actions.map((id) => {
              const { icon: Icon, label } = ACTION_LOOK[id];
              const on = shownFocus === id;
              return (
                <Button
                  key={id}
                  variant="white"
                  data-action={id}
                  onClick={() => { if (id !== 'signout') setFocus(id); else setFocusRaw(id); press(id); }}
                  data-focused={on ? 'true' : 'false'}
                  data-confirm={id === 'signout' && confirmOut ? 'true' : undefined}
                  className={`tv-ring w-full justify-start rounded-xl ${embedded ? 'h-12 px-4 text-sm' : 'h-14 px-5 text-base'} transition-transform duration-150 ease-out ${on ? 'scale-105 z-10' : ''}`}
                >
                  <Icon className={`w-5 h-5 mr-2 shrink-0 ${id === 'renew' && renewBusy ? 'animate-spin' : ''}`} />
                  <span className="min-w-0 truncate">{label}</span>
                </Button>
              );
            })}
          </div>

          <Card className={`flex-1 min-w-0 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 border-slate-700 shadow-xl ${embedded ? 'p-4' : 'p-6'}`}>
            <div className={`grid grid-cols-1 sm:grid-cols-2 ${embedded ? 'gap-x-4 gap-y-2' : 'gap-x-8 gap-y-4'}`}>
              {rows.map((r) => {
                const Icon = r.icon;
                return (
                  <div key={r.label} className="flex items-start gap-3 py-2 border-b border-white/5">
                    <Icon className="w-5 h-5 text-brand-ice mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs uppercase tracking-wide text-white/70 mb-1">{r.label}</div>
                      <div className="text-base text-white font-medium">{r.value}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
});

AccountInfoScreen.displayName = 'AccountInfoScreen';
export default AccountInfoScreen;
