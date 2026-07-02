import { memo, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeft, Tv, Calendar, KeyRound, Users, Server, Clock, ShieldCheck, LogOut, Eye, EyeOff,
} from 'lucide-react';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { expDateToMs } from '@/lib/xtream';

interface Props {
  onBack: () => void;
  onSignOut: () => void;
}

const fmtDate = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '—';

const fmtDay = (ms: number | null) =>
  ms ? new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  }) : '—';

interface Row { label: string; value: React.ReactNode; icon: typeof Tv; mono?: boolean }

/**
 * Read-only Xtream account info screen for the Player header "Account" button.
 * Two-button D-pad nav: Back / Sign out.
 */
const AccountInfoScreen = memo(({ onBack, onSignOut }: Props) => {
  const { account, state, days } = usePlayerAccount();
  const [showPwd, setShowPwd] = useState(false);
  const [focusIdx, setFocusIdx] = useState(1); // Start on Show/Hide password so Enter doesn't accidentally close the screen.
  const focusIdxRef = useRef(focusIdx);
  useEffect(() => { focusIdxRef.current = focusIdx; }, [focusIdx]);

  const BTN_COUNT = 3;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;
      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        onBack();
        return;
      }
      const arrows = ['ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!arrows.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      if (e.key === 'ArrowLeft') setFocusIdx(i => (i - 1 + BTN_COUNT) % BTN_COUNT);
      else if (e.key === 'ArrowRight') setFocusIdx(i => (i + 1) % BTN_COUNT);
      else if (e.key === 'Enter' || e.key === ' ') {
        const i = focusIdxRef.current;
        if (i === 0) onBack();
        else if (i === 1) setShowPwd(v => !v);
        else if (i === 2) onSignOut();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onBack, onSignOut]);

  if (!account) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white bg-black/70">
        <Card className="p-6 bg-slate-900/80 border-slate-700 text-center">
          <p className="text-white/80 mb-4">No player account on this device.</p>
          <Button variant="white" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
        </Card>
      </div>
    );
  }

  const expMs = expDateToMs(account.expDate);
  const createdMs = expDateToMs(account.createdAt);
  const status = account.status || 'Unknown';
  const isExpired = /expired|disabled|banned/i.test(status) || (days !== null && days < 0);
  const statusBadge = isExpired
    ? 'bg-red-600/30 text-red-100 border-red-400/40'
    : 'bg-emerald-600/30 text-emerald-100 border-emerald-400/40';
  const statusLabel = isExpired ? 'Expired' : (status.toLowerCase() === 'active' ? 'Active' : status);

  const daysColor = state.severity === 'critical'
    ? 'text-red-300'
    : state.severity === 'warning'
      ? 'text-amber-300'
      : 'text-emerald-300';
  const daysLabel = days === null ? '—' : state.show ? state.label : `${days} days left`;

  const rows: Row[] = [
    { label: 'Username',  icon: KeyRound, value: <span className="break-all">{account.username}</span> },
    { label: 'Password',  icon: KeyRound, mono: true, value: (
      <span className="font-mono tracking-widest break-all">
        {showPwd ? account.password : '•'.repeat(Math.max(8, account.password.length))}
      </span>
    )},
    { label: 'Status',    icon: ShieldCheck, value: (
      <Badge className={`border ${statusBadge}`}>{statusLabel}</Badge>
    )},
    { label: 'Expires',   icon: Calendar, value: (
      <span><span className="font-medium">{fmtDay(expMs)}</span>
        <span className={`ml-2 text-xs font-semibold ${daysColor}`}>({daysLabel})</span>
      </span>
    )},
    { label: 'Trial',     icon: ShieldCheck, value: account.isTrial ? 'Yes' : 'No' },
    { label: 'Connections', icon: Users, value: `${account.activeCons ?? 0} active / ${account.maxConnections ?? '—'} allowed` },
    { label: 'Created',   icon: Clock,  value: fmtDate(createdMs) },
    { label: 'Server',    icon: Server, value: (
      <span>{account.serverLabel}
        <span className="ml-2 text-white/50 text-xs break-all">{account.host}</span>
      </span>
    )},
  ];

  return (
    <div className="min-h-screen flex flex-col text-white bg-black/70">
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="white"
            size="sm"
            onClick={onBack}
            data-player-header-btn="" data-focused={focusIdx === 0 ? "true" : "false"}
            className={`tv-focusable home-focus-surface transition-transform duration-150 ${
              focusIdx === 0 ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_14px_rgba(245,200,80,0.45)]' : ''
            }`}
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Tv className="w-7 h-7 text-brand-gold" />
            <h1 className="text-2xl font-quicksand font-bold text-white">Account</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="white"
            size="sm"
            onClick={() => setShowPwd(v => !v)}
            data-player-header-btn="" data-focused={focusIdx === 1 ? "true" : "false"}
            className={`tv-focusable home-focus-surface transition-transform duration-150 ${
              focusIdx === 1 ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_14px_rgba(245,200,80,0.45)]' : ''
            }`}
          >
            {showPwd ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
            {showPwd ? 'Hide' : 'Show'} password
          </Button>
          <Button
            variant="white"
            size="sm"
            onClick={onSignOut}
            data-player-header-btn="" data-focused={focusIdx === 2 ? "true" : "false"}
            className={`tv-focusable home-focus-surface transition-transform duration-150 ${
              focusIdx === 2 ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_14px_rgba(245,200,80,0.45)]' : ''
            }`}
          >
            <LogOut className="w-4 h-4 mr-2" /> Sign out
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 flex items-start justify-center">
        <Card className="w-full max-w-3xl bg-gradient-to-br from-slate-800 to-slate-950 border-slate-700 p-6 shadow-xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
            {rows.map((r) => {
              const Icon = r.icon;
              return (
                <div key={r.label} className="flex items-start gap-3 py-2 border-b border-white/5">
                  <Icon className="w-5 h-5 text-brand-ice mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs uppercase tracking-wide text-white/50 mb-1">{r.label}</div>
                    <div className="text-base text-white font-medium">{r.value}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
});

AccountInfoScreen.displayName = 'AccountInfoScreen';
export default AccountInfoScreen;
