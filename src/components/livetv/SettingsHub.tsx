import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Tv, KeyRound, Users, Palette, LogOut, Loader2, CreditCard, ListFilter } from 'lucide-react';
import type { XtreamCreds } from '@/lib/xtream';
import { useToast } from '@/hooks/use-toast';
import { isDemo } from '@/lib/demoMode';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';
import { useBillingEnabled } from '@/hooks/useBillingEnabled';

// Demo latch (?demo=1) — account actions are inert; the demo account is fixed.
const DEMO = isDemo();

const AccountInfoScreen = lazy(() => import('./AccountInfoScreen'));
const SwitchAccountScreen = lazy(() => import('./SwitchAccountScreen'));
const AppearanceScreen = lazy(() => import('./AppearanceScreen'));
const HideCategoriesScreen = lazy(() => import('./HideCategoriesScreen'));
// Billing account (plans, renew, trial) — behind the billing_account flag.
const BillingAccountScreen = lazy(() => import('@/components/billing/BillingAccountScreen'));

interface Props {
  onBack: () => void;
  /** Open on a screen other than the menu (the assistant's "open Appearance"). */
  initialView?: View;
  onSignOut: () => void;
  onChangeCredentials: () => void;
  onSwitchAccount: (c: XtreamCreds) => void;
}

type View = 'menu' | 'billing' | 'account' | 'switch' | 'categories' | 'appearance';
type MenuId = 'billing' | 'account' | 'switch' | 'categories' | 'appearance' | 'signout';

interface MenuItem { id: MenuId; label: string; icon: typeof Tv; }

const fallback = (
  <div className="min-h-screen flex items-center justify-center text-white bg-black/70">
    <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
  </div>
);

const SettingsHub = memo(({ onBack, initialView, onSignOut, onChangeCredentials, onSwitchAccount }: Props) => {
  const [view, setView] = useState<View>(initialView ?? 'menu');
  const [menuIdx, setMenuIdx] = useState(1); // start on first list row (skip Back)
  const menuIdxRef = useRef(menuIdx);
  useEffect(() => { menuIdxRef.current = menuIdx; }, [menuIdx]);

  const billingOn = useBillingEnabled();
  const MENU: MenuItem[] = useMemo(() => [
    // "My Account" = the billing account (plans, renewals, trial). Account
    // Info below stays the panel line's details.
    ...(billingOn ? [{ id: 'billing' as MenuId, label: 'My Account', icon: CreditCard }] : []),
    { id: 'account',    label: 'Account Info',      icon: KeyRound },
    { id: 'switch',     label: 'Switch Account',    icon: Users },
    { id: 'categories', label: 'Hide Categories',   icon: ListFilter },
    { id: 'appearance', label: 'Appearance',        icon: Palette },
    { id: 'signout',    label: 'Sign Out',          icon: LogOut },
  ], [billingOn]);

  const { toast } = useToast();
  const demoNote = useCallback(() => {
    toast({
      title: 'Live demo',
      description: 'The demo is pre-loaded with a demo account — sign-in and account switching work in the installed app.',
    });
  }, [toast]);

  const activate = useCallback((id: MenuId) => {
    // Demo: Account Info / Switch Account / Sign Out are
    // inert — the demo account is pre-loaded. Appearance stays fully functional.
    if (DEMO && id !== 'appearance') { demoNote(); return; }
    if (id === 'billing') setView('billing');
    else if (id === 'account') setView('account');
    else if (id === 'switch') setView('switch');
    else if (id === 'categories') setView('categories');
    else if (id === 'appearance') setView('appearance');
    else if (id === 'signout') onSignOut();
  }, [demoNote, onSignOut]);

  // Menu-only keyboard handler (each sub-view owns its own).
  useEffect(() => {
    if (view !== 'menu') return;
    const COUNT = MENU.length + 1; // + Back at idx 0
    const handler = (e: KeyboardEvent) => {
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

  if (view === 'billing') {
    return (
      <Suspense fallback={fallback}>
        <BillingAccountScreen
          onBack={() => setView('menu')}
          onUseInPlayer={onSwitchAccount}
        />
      </Suspense>
    );
  }
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
  if (view === 'categories') {
    return (
      <Suspense fallback={fallback}>
        <HideCategoriesScreen onBack={() => setView('menu')} />
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
    <div className="h-screen overflow-hidden flex flex-col text-white bg-black/70">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 bg-black/30">
        <BackButton
          onClick={onBack}
          label="Back"
          data-player-header-btn=""
          focused={menuIdx === 0}
        />
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
                data-focused={focused ? 'true' : 'false'}
                onClick={() => { setMenuIdx(i + 1); activate(m.id); }}
                className={`tv-ring flex items-center gap-4 rounded-xl px-5 py-4 bg-slate-900/70 border border-white/10 cursor-pointer ${focused ? 'scale-[1.02] z-10' : ''}`}
              >
                <Icon className="w-6 h-6 text-brand-gold shrink-0" />
                <span className="text-xl font-quicksand font-semibold">{m.label}</span>
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
