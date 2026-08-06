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
  <div className="flex-1 flex items-center justify-center">
    <Loader2 className="w-8 h-8 animate-spin text-white/60" />
  </div>
);

const SettingsHub = memo(({ onBack, onSignOut, onChangeCredentials, onSwitchAccount, onOpenReminders, showReminders }: Props) => {
  const [view, setView] = useState<View>('menu');
  const [menuIdx, setMenuIdx] = useState(1);
  const menuIdxRef = useRef(menuIdx);
  useEffect(() => { menuIdxRef.current = menuIdx; }, [menuIdx]);

  const MENU: MenuItem[] = useMemo(() => [
    { id: 'account', label: 'Account Info', icon: KeyRound },
    { id: 'switch', label: 'Switch Account', icon: Users },
    ...(showReminders && onOpenReminders
      ? [{ id: 'reminders' as MenuId, label: 'Renewal Reminders', icon: BellRing }]
      : []),
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'signout', label: 'Sign Out', icon: LogOut },
  ], [showReminders, onOpenReminders]);

  const { toast } = useToast();
  const demoNote = useCallback(() => {
    toast({
      title: 'Live demo',
      description: 'The demo is pre-loaded with a demo account — sign-in and account switching work in the installed app.',
    });
  }, [toast]);

  const activate = useCallback((id: MenuId) => {
    // Demo: only Appearance is functional; the demo account is pre-loaded.
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
      // Blur whatever held DOM focus (e.g. a button from the previous screen)
      // so it can't double-fire on OK.
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
        <AccountInfoScreen onBack={() => setView('menu')} />
      </Suspense>
    );
  }
  if (view === 'switch') {
    return (
      <Suspense fallback={fallback}>
        <SwitchAccountScreen
          onBack={() => setView('menu')}
          onSwitch={(c) => { onSwitchAccount(c); }}
          onAddNew={() => { onChangeCredentials(); }}
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
    <div className="flex-1 min-h-0 flex flex-col px-4 pb-4 overflow-y-auto">
      <div className="flex items-center gap-3 mb-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className={`text-white/70 hover:text-white hover:bg-white/10 ${menuIdx === 0 ? 'ring-2 ring-brand-ice bg-white/10' : ''}`}
          aria-label="Back to player"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h2 className="text-xl font-bold text-white">Settings</h2>
      </div>

      <div className="max-w-md space-y-2">
        {MENU.map((m, i) => {
          const Icon = m.icon;
          const focused = menuIdx === i + 1;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => { setMenuIdx(i + 1); activate(m.id); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
                focused ? 'bg-brand-ice/20 ring-2 ring-brand-ice' : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              <Icon className="w-5 h-5 text-white/70" />
              <span className="text-white font-medium">{m.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});

SettingsHub.displayName = 'SettingsHub';
export default SettingsHub;
