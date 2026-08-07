import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Tv, KeyRound, Users, Palette, LogOut, Loader2, BellRing } from 'lucide-react';
import type { XtreamCreds } from '@/lib/xtream';
import { useToast } from '@/hooks/use-toast';
import { isDemo } from '@/lib/demoMode';

// Demo latch (?demo=1) — account actions are inert; the demo account is fixed.
const DEMO = isDemo();

const AccountInfoScreen = lazy(() => import('./AccountInfoScreen'));
const SwitchAccountScreen = lazy(() => import('./SwitchAccountScreen'));
const AppearanceScreen = lazy(() => import('./AppearanceScreen'));

interface Props {
  onBack: () => void;
  onSignOut: () => void;
  onChangeCredentials: () => void;
  onSwitchAccount: (c: XtreamCreds) => void;
  /** Player-only users (no SMC account) get a "Renewal Reminders" entry that
   *  opens the account-claim card — reachable any time so a dismissal is never
   *  permanent. */
  onOpenReminders?: () => void;
  showReminders?: boolean;
}

type View = 'menu' | 'account' | 'switch' | 'appearance';
type MenuId = 'account' | 'switch' | 'reminders' | 'appearance' | 'signout';

interface MenuItem { id: MenuId; label: string; icon: typeof Tv; }

const fallback = (
  <div className="min-h-screen flex items-center justify-center text-white bg-black/70">
    <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
  </div>
);

const SettingsHub = memo(({ onBack, onSignOut, onChangeCredentials, onSwitchAccount, onOpenReminders, showReminders }: Props) => {
  const [view, setView] = useState<View>('menu');
  const [menuIdx, setMenuIdx] = useState(1); // start on first list row (skip Back)
  const menuIdxRef = useRef(menuIdx);
  useEffect(() => { menuIdxRef.current = menuIdx; }, [menuIdx]);

  const MENU: MenuItem[] = useMemo(() => [
    { id: 'account',    label: 'Account Info',      icon: KeyRound },
    { id: 'switch',     label: 'Switch Account',    icon: Users },
    ...(showReminders && onOpenReminders
      ? [{ id: 'reminders' as MenuId, label: 'Renewal Reminders', icon: BellRing }]
      : []),
    { id: 'appearance', label: 'Appearance',        icon: Palette },
    { id: 'signout',    label: 'Sign Out',          icon: LogOut },
  ], [showReminders, onOpenReminders]);

  const { toast } = useToast();
  const demoNote = useCallback(() => {
    toast({
      title: 'Live demo',
      description: 'The demo is pre-loaded with a demo account — sign-in and account switching work in the installed app.',
    });
  }, [toast]);

  const activate = useCallback((id: MenuId) => {
    // Demo: Account Info / Switch Account / Renewal Reminders / Sign Out are
    // inert — the demo account is pre-loaded. Appearance stays fully functional.
    if (DEMO && id !== 'appearance') { demoNote(); return; }
    if (id === 'account') setView('account');
    else if (id === 'switch') setView('switch');
    else if (id === 'reminders') onOpenReminders?.();
    else if (id === 'appearance') setView('appearance');
    else if (id === 'signout') onSignOut();
  }, [demoNote, onOpenReminders, onSignOut]);

  // Menu-only keyboard handler (each sub-view owns its own).
  useEffect(() => {
    if (view !== 'menu') return;
    const COUNT = MENU.length + 1; // + Back at idx 0
    const handler = (e: KeyboardEvent) => {
      // The account-claim card owns the keyboard while open.
      if ((window as unknown as { __claimCardOpen?: boolean }).__claimCardOpen) return;
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;
      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        onBack();
        return;
      }
      const arrows = ['ArrowUp', 'ArrowDown', 'Enter', ' '];
      if (!arrows.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      if (e.key === 'ArrowDown') setMenuIdx(i => (i + 1) % COUNT);
      else if (e.key === 'ArrowUp') setMenuIdx(i => (i - 1 + COUNT) % COUNT);
      else if (e.key === 'Enter' || e.key === ' ') {
        const i = menuIdxRef.current;
        if (i === 0) { onBack(); return; }
        activate(MENU[i - 1].id);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [view, MENU, onBack, activate]);

  if (view === 'account') {
    return (
      <Suspense fallback={fallback}>
        <AccountInfoScreen
          onBack={() => setView('menu')}
          onChangeCredentials={onChangeCredentials}
          onSignOut={onSignOut}
        />
      </Suspense>
    );
  }
  if (view === 'switch') {
    return (
      <Suspense fallback={fallback}>
        <SwitchAccountScreen
          onBack={() => setView('menu')}
          onPicked={onSwitchAccount}
          onAddAccount={() => { onChangeCredentials(); }}
        />
      </Suspense>
    );
  }
  if (view === 'appearance') {
    return (
      <Suspense fallback={fallback}>
        <AppearanceScreen onBack={() => setView('menu')} />
      </Suspense>
    );
  }

  return (
    <div className="min-h-screen flex flex-col text-white bg-black/70">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <Button
          variant="white"
          size="sm"
          onClick={onBack}
          data-player-header-btn=""
          data-focused={menuIdx === 0 ? 'true' : 'false'}
          className={`tv-focusable transition-all duration-150 ${menuIdx === 0 ? 'ring-4 ring-brand-gold scale-105 shadow-[0_0_22px_rgba(185,162,121,0.75)] brightness-110' : ''}`}
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <Tv className="w-7 h-7 text-brand-gold" />
          <h1 className="text-2xl font-quicksand font-bold text-white">Settings</h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 flex items-start justify-center">
        <div className="w-full max-w-xl space-y-3">
          {MENU.map((m, i) => {
            const Icon = m.icon;
            const focused = menuIdx === i + 1;
            return (
              <div
                key={m.id}
                data-player-header-btn=""
                data-focused={focused ? 'true' : 'false'}
                onClick={() => { setMenuIdx(i + 1); activate(m.id); }}
                className={`tv-focusable flex items-center gap-4 rounded-xl px-5 py-4 bg-slate-900/70 border border-white/10 cursor-pointer transition-all duration-150 ${focused ? 'ring-4 ring-brand-gold scale-105 shadow-[0_0_22px_rgba(185,162,121,0.75)] brightness-110' : ''}`}
              >
                <Icon className="w-6 h-6 text-brand-gold shrink-0" />
                <span className="text-lg font-quicksand font-semibold">{m.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

SettingsHub.displayName = 'SettingsHub';
export default SettingsHub;
