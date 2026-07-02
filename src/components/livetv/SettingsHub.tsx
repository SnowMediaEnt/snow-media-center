import { memo, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Tv, KeyRound, Users, Palette, LogOut, Loader2 } from 'lucide-react';
import type { XtreamCreds } from '@/lib/xtream';

const AccountInfoScreen = lazy(() => import('./AccountInfoScreen'));
const SwitchAccountScreen = lazy(() => import('./SwitchAccountScreen'));
const AppearanceScreen = lazy(() => import('./AppearanceScreen'));

interface Props {
  onBack: () => void;
  onSignOut: () => void;
  onChangeCredentials: () => void;
  onSwitchAccount: (c: XtreamCreds) => void;
}

type View = 'menu' | 'account' | 'switch' | 'appearance';

interface MenuItem { label: string; icon: typeof Tv; }
const MENU: MenuItem[] = [
  { label: 'Account Info',   icon: KeyRound },
  { label: 'Switch Account', icon: Users },
  { label: 'Appearance',     icon: Palette },
  { label: 'Sign Out',       icon: LogOut },
];

const fallback = (
  <div className="min-h-screen flex items-center justify-center text-white bg-black/70">
    <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
  </div>
);

const SettingsHub = memo(({ onBack, onSignOut, onChangeCredentials, onSwitchAccount }: Props) => {
  const [view, setView] = useState<View>('menu');
  const [menuIdx, setMenuIdx] = useState(1); // start on first list row (skip Back)
  const menuIdxRef = useRef(menuIdx);
  useEffect(() => { menuIdxRef.current = menuIdx; }, [menuIdx]);

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
        const row = i - 1;
        if (row === 0) setView('account');
        else if (row === 1) setView('switch');
        else if (row === 2) setView('appearance');
        else if (row === 3) onSignOut();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [view, onBack, onSignOut]);

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
          className={`tv-focusable home-focus-surface transition-transform duration-150 ${
            menuIdx === 0 ? 'scale-105' : ''
          }`}
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
                key={m.label}
                data-player-header-btn=""
                data-focused={focused ? 'true' : 'false'}
                onClick={() => {
                  setMenuIdx(i + 1);
                  if (i === 0) setView('account');
                  else if (i === 1) setView('switch');
                  else if (i === 2) setView('appearance');
                  else if (i === 3) onSignOut();
                }}
                className={`tv-focusable home-focus-surface flex items-center gap-4 rounded-xl px-5 py-4 bg-slate-900/70 border border-white/10 cursor-pointer transition-transform duration-150 ${
                  focused ? 'scale-[1.02]' : ''
                }`}
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
