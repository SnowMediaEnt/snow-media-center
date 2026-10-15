import { memo, useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { Tv, KeyRound, Users, Palette, LogOut, Loader2, CreditCard, ListFilter, Gauge, History } from 'lucide-react';
import type { XtreamCreds } from '@/lib/xtream';
import type { LiveLayout } from '@/lib/liveLayout';
import { useToast } from '@/hooks/use-toast';
import { isDemo } from '@/lib/demoMode';
import { BackButton } from '@/components/ui/BackButton';
import { useBillingEnabled } from '@/hooks/useBillingEnabled';
import { useTranslation } from 'react-i18next';
import { keepInView } from '@/utils/keepInView';

// Demo latch (?demo=1) — account actions are inert; the demo account is fixed.
const DEMO = isDemo();

const AccountInfoScreen = lazy(() => import('./AccountInfoScreen'));
const SwitchAccountScreen = lazy(() => import('./SwitchAccountScreen'));
const AppearanceScreen = lazy(() => import('./AppearanceScreen'));
const PlaybackScreen = lazy(() => import('./PlaybackScreen'));
const RewindSettingsScreen = lazy(() => import('./RewindSettingsScreen'));
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
  /** Try a Live TV layout on the real screen (see AppearanceScreen). */
  onTryLayout?: (prev: LiveLayout, next: LiveLayout) => void;
}

type View = 'menu' | 'billing' | 'account' | 'switch' | 'categories' | 'appearance' | 'rewind' | 'playback';
type MenuId = 'billing' | 'account' | 'switch' | 'categories' | 'appearance' | 'rewind' | 'playback' | 'signout';

interface MenuItem { id: MenuId; labelKey: string; icon: typeof Tv; }

const fallback = (
  <div className="min-h-screen flex items-center justify-center text-white bg-black/70">
    <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
  </div>
);

/** The How-to guide's hooks on the menu rows (data-howto; literals, so its check finds them). */
const HUB_HOWTO: Partial<Record<MenuId, string>> = {
  switch: 'hub.switch', categories: 'hub.hideCats', appearance: 'hub.appearance', rewind: 'hub.rewind', signout: 'hub.signOut',
};

/** Pages drawn beside the menu. My Account (the store's plans and trial) keeps its own screen. */
const EMBEDDED: ReadonlySet<MenuId> = new Set<MenuId>(['account', 'switch', 'categories', 'appearance', 'rewind', 'playback']);
/** In the demo only these work; the account pages are inert there. */
const DEMO_OK: ReadonlySet<MenuId> = new Set<MenuId>(['appearance', 'rewind', 'playback']);
/** The page beside the menu follows the highlight once it rests this long (no page mounts for every row passed). */
const PREVIEW_REST_MS = 250;

/**
 * Live TV -> Settings. The menu is a column on the left (Up / Down) and the
 * highlighted page sits on the right; OK or Right moves the remote into it,
 * Back (or Left at its edge) returns to the menu, Back on the menu leaves.
 * Owner, 2026-10-14: every settings screen laid out like Account info.
 */
const SettingsHub = memo(({ onBack, initialView, onSignOut, onChangeCredentials, onSwitchAccount, onTryLayout }: Props) => {
  const { t } = useTranslation();
  const billingOn = useBillingEnabled();
  const MENU: MenuItem[] = useMemo(() => [
    // "My Account" = the billing account (plans, renewals, trial). Account
    // Info below stays the panel line's details.
    ...(billingOn ? [{ id: 'billing' as MenuId, labelKey: 'liveAccount.hub.myAccount', icon: CreditCard }] : []),
    { id: 'account',    labelKey: 'liveAccount.hub.accountInfo',  icon: KeyRound },
    { id: 'switch',     labelKey: 'liveAccount.hub.switchAccount', icon: Users },
    { id: 'categories', labelKey: 'liveAccount.hub.hideCategories', icon: ListFilter },
    { id: 'appearance', labelKey: 'liveAccount.hub.appearance',   icon: Palette },
    { id: 'rewind',     labelKey: 'liveAccount.hub.rewind',       icon: History },
    { id: 'playback',   labelKey: 'liveAccount.hub.playback',     icon: Gauge },
    { id: 'signout',    labelKey: 'liveAccount.hub.signOut',      icon: LogOut },
  ], [billingOn]);

  // Opened on a page (the assistant's "open Appearance"): that page, with the remote in it.
  const startEmbedded = !!initialView && initialView !== 'menu' && initialView !== 'billing';
  const [view, setView] = useState<View>(initialView === 'billing' ? 'billing' : 'menu');
  const [pane, setPane] = useState<'menu' | 'page'>(startEmbedded ? 'page' : 'menu');
  const startIdx = startEmbedded ? Math.max(1, MENU.findIndex((m) => m.id === initialView) + 1) : 1;
  const [menuIdx, setMenuIdx] = useState(startIdx); // 0 = Back; start on the first row
  const menuIdxRef = useRef(menuIdx);
  useEffect(() => { menuIdxRef.current = menuIdx; }, [menuIdx]);
  // The menu item whose page is on the right.
  const [shown, setShown] = useState<MenuId>(() => MENU[startIdx - 1]?.id ?? 'account');

  // My Account joins the menu a moment after the first open (the billing flag
  // loads), shifting every row down: keep the highlight on the same item.
  const prevMenuRef = useRef(MENU);
  useEffect(() => {
    const prev = prevMenuRef.current;
    prevMenuRef.current = MENU;
    if (prev === MENU) return;
    const id = prev[menuIdxRef.current - 1]?.id;
    if (!id) return;
    const at = MENU.findIndex((m) => m.id === id);
    if (at >= 0 && at + 1 !== menuIdxRef.current) setMenuIdx(at + 1);
  }, [MENU]);

  // The page follows the highlight once it rests (Back keeps the last page).
  useEffect(() => {
    if (pane !== 'menu' || menuIdx < 1) return;
    const id = MENU[menuIdx - 1]?.id;
    if (!id || id === shown) return;
    const timer = window.setTimeout(() => setShown(id), PREVIEW_REST_MS);
    return () => window.clearTimeout(timer);
  }, [menuIdx, pane, MENU, shown]);

  // Follow the highlight down the menu: at 960×540 Sign Out sits below the
  // fold, and the remote highlight moved there without the menu scrolling.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || view !== 'menu') return;
    if (menuIdx <= 1) { node.scrollTop = 0; return; }
    const el = node.querySelector<HTMLElement>('[data-focused="true"]');
    if (el) keepInView(node, el, 24);
  }, [menuIdx, view]);

  const { toast } = useToast();
  const demoNote = useCallback(() => {
    toast({
      title: t('liveAccount.hub.demoTitle'),
      description: t('liveAccount.hub.demoDesc'),
    });
  }, [toast, t]);

  const activate = useCallback((id: MenuId) => {
    // Demo: Account Info / Switch Account / Sign Out are
    // inert — the demo account is pre-loaded. Appearance, Rewind and Playback
    // stay fully functional (per-box settings; nothing to protect).
    if (DEMO && !DEMO_OK.has(id)) { setPane('menu'); demoNote(); return; }
    // A row without a page beside the menu leaves the remote on the menu
    // (a tap or air-mouse click can come while the remote is in a page).
    if (id === 'billing') { setPane('menu'); setView('billing'); }
    else if (id === 'signout') { setPane('menu'); onSignOut(); }
    else if (EMBEDDED.has(id)) { setShown(id); setPane('page'); }
  }, [demoNote, onSignOut]);

  // The menu's keys (the page beside it owns them while the remote is in it).
  useEffect(() => {
    if (view !== 'menu' || pane !== 'menu') return;
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
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      if (e.key === 'ArrowDown') setMenuIdx(i => Math.min(COUNT - 1, i + 1));
      else if (e.key === 'ArrowUp') setMenuIdx(i => Math.max(0, i - 1));
      else if (e.key === 'ArrowLeft') return; // the menu is the left edge
      else {
        const i = menuIdxRef.current;
        if (i === 0) { if (e.key !== 'ArrowRight') onBack(); return; }
        const item = MENU[i - 1];
        // Right only steps into a page; it never signs out or opens My Account.
        if (e.key === 'ArrowRight' && !EMBEDDED.has(item.id)) return;
        activate(item.id);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [view, pane, MENU, onBack, activate]);

  const toMenu = useCallback(() => setPane('menu'), []);

  if (view === 'billing') {
    return (
      <Suspense fallback={fallback}>
        <BillingAccountScreen
          onBack={() => { setPane('menu'); setView('menu'); }}
          onUseInPlayer={onSwitchAccount}
        />
      </Suspense>
    );
  }

  const inPage = pane === 'page';
  const shownItem = MENU.find((m) => m.id === shown) ?? MENU[0];
  const page = (() => {
    const common = { embedded: true, active: inPage, onBack: toMenu } as const;
    if (DEMO && !DEMO_OK.has(shown)) return <PageHint text={t('liveAccount.hub.demoDesc')} />;
    switch (shown) {
      case 'account': return <AccountInfoScreen {...common} onChangeCredentials={onChangeCredentials} onSignOut={onSignOut} />;
      case 'switch': return <SwitchAccountScreen {...common} onPicked={onSwitchAccount} onAddAccount={onChangeCredentials} />;
      // Its page reads every saved line's categories from the server: only
      // once the remote goes in, not for a highlight passing over it.
      case 'categories': return inPage ? <HideCategoriesScreen {...common} /> : <PageHint text={t('liveAccount.hideCategories.intro')} />;
      case 'appearance': return <AppearanceScreen {...common} onTryLayout={onTryLayout} />;
      case 'rewind': return <RewindSettingsScreen {...common} />;
      case 'playback': return <PlaybackScreen {...common} />;
      case 'billing': return <PageHint text={t('liveAccount.hub.billingHint')} />;
      case 'signout': return <PageHint text={t('liveAccount.hub.signOutHint')} />;
      default: return null;
    }
  })();

  return (
    <div className="h-screen overflow-hidden flex flex-col text-white bg-black/70">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/10 bg-black/30">
        <BackButton
          onClick={onBack}
          label={t('common.back')}
          data-player-header-btn=""
          focused={!inPage && menuIdx === 0}
        />
        <div className="flex items-center gap-2">
          <Tv className="w-7 h-7 text-brand-gold" />
          <h1 className="text-2xl font-quicksand font-bold text-white">{t('liveAccount.hub.title')}</h1>
        </div>
      </div>

      {/* Margins, not flex gap: older box WebViews (Chrome < 84) ignore gap. */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row p-4 lg:p-6">
        <div ref={scrollRef} className="md:w-60 lg:w-72 shrink-0 overflow-auto mb-4 md:mb-0 md:mr-4 lg:mr-6">
          <div className="space-y-3" data-settings-menu>
            {MENU.map((m, i) => {
              const Icon = m.icon;
              const focused = !inPage && menuIdx === i + 1;
              // The page on the right is this row's: a quiet gold edge, so the
              // viewer can tell where the remote came from while it is in the page.
              const current = inPage && m.id === shown;
              return (
                <div
                  key={m.id}
                  data-focused={focused ? 'true' : 'false'}
                  data-howto={HUB_HOWTO[m.id]}
                  onClick={() => { setMenuIdx(i + 1); setShown(m.id); activate(m.id); }}
                  className={`tv-ring flex items-center rounded-xl px-4 py-3 border cursor-pointer ${current ? 'bg-brand-gold/15 border-brand-gold/50' : 'bg-slate-900/70 border-white/10'} ${focused ? 'scale-[1.02] z-10' : ''}`}
                >
                  <Icon className="w-5 h-5 mr-3 text-brand-gold shrink-0" />
                  <span className="text-base lg:text-lg font-quicksand font-semibold min-w-0 truncate">{t(m.labelKey)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col" data-settings-preview={inPage ? 'false' : 'true'} data-settings-page={shown}>
          <h2 className="text-lg font-quicksand font-semibold text-brand-ice/90 mb-3 truncate">{t(shownItem.labelKey)}</h2>
          <div className={`flex-1 min-h-0 transition-opacity duration-150 ${inPage ? '' : 'opacity-80'}`}>
            <Suspense fallback={<div className="h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-brand-gold" /></div>}>
              {page}
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  );
});

/** What a row without a page of its own does, shown beside the menu. */
const PageHint = ({ text }: { text: string }) => (
  <div className="rounded-2xl bg-slate-900/70 border border-white/10 p-6 text-brand-ice/85 font-nunito text-lg">{text}</div>
);

SettingsHub.displayName = 'SettingsHub';
export default SettingsHub;
