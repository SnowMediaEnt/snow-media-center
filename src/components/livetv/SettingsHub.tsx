import { memo, useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Tv, KeyRound, Palette, LogOut, Loader2, ListVideo, Gauge, History, Layers, LifeBuoy } from 'lucide-react';
import type { XtreamCreds } from '@/lib/xtream';
import type { LiveLayout } from '@/lib/liveLayout';
import { useToast } from '@/hooks/use-toast';
import { isDemo } from '@/lib/demoMode';
import { openSupportTool } from '@/lib/appActions';
import { BackButton } from '@/components/ui/BackButton';
import { useBillingEnabled } from '@/hooks/useBillingEnabled';
import { useTranslation } from 'react-i18next';
import { keepInView } from '@/utils/keepInView';
import { useHubStates, type HubRow } from './useHubStates';
import type { SupportTool } from './FixProblemScreen';

// Demo latch (?demo=1) — account actions are inert; the demo account is fixed.
const DEMO = isDemo();

// My Account: the line's details, Devices on this line, and (billing on) Renew & plans.
const AccountInfoScreen = lazy(() => import('./AccountInfoScreen'));
// Services: the lines on this box (switch between them) and the outside service, and adding either.
const ServicesScreen = lazy(() => import('./ServicesScreen'));
// Channels: Hide categories, Favorites order, the failover switch, Update channels.
const ChannelsScreen = lazy(() => import('./ChannelsScreen'));
const AppearanceScreen = lazy(() => import('./AppearanceScreen'));
const RewindSettingsScreen = lazy(() => import('./RewindSettingsScreen'));
// Player: the engine and the picture switches.
const PlaybackScreen = lazy(() => import('./PlaybackScreen'));
// Fix a problem: the Buffering Guide, Speed test, Submit a Ticket, and a restart tip.
const FixProblemScreen = lazy(() => import('./FixProblemScreen'));
// Billing account (plans, renew, trial) — behind the billing_account flag:
// opened from My Account's Renew & plans, drawn in place of the hub.
const BillingAccountScreen = lazy(() => import('@/components/billing/BillingAccountScreen'));

interface Props {
  onBack: () => void;
  /** Open on a page instead of the menu (the assistant's "open Appearance"); 'billing' opens My Account's plans and renewals;
   *  'devices' opens My Account on Devices on this line (Multi-Screen's "Message the other TVs on this line"). */
  initialView?: View | 'devices';
  onSignOut: () => void;
  onChangeCredentials: () => void;
  onSwitchAccount: (c: XtreamCreds) => void;
  /** Try a Live TV layout on the real screen (see AppearanceScreen). */
  onTryLayout?: (prev: LiveLayout, next: LiveLayout) => void;
  /** The line Live TV is signed into: My Account offers "Devices on this line" for it. */
  line?: { host: string; username: string } | null;
  /** Channels › Update channels: Live TV's own Update Channels (it closes Settings to show the lists coming in). */
  onUpdateChannels?: () => void;
  /** Fix a problem › Buffering Guide (Support's guide, as from Live TV's Report dialog). */
  onOpenBufferingGuide?: () => void;
  /** Leave the Player for another screen (Fix a problem › Speed test / Submit a Ticket open in Support). */
  onNavigate?: (view: string) => void;
  /** Services › Add another service › DreamStreams or Vibez line: an empty sign-in form (else onChangeCredentials). */
  onAddLine?: () => void;
}

type MenuId = HubRow;
type View = 'menu' | 'billing' | Exclude<MenuId, 'signout'>;

interface MenuItem { id: MenuId; labelKey: string; icon: typeof Tv; }

/**
 * The menu, top to bottom (owner, 2026-10-20: eight rows, each with its state
 * in small text under the name). Every label is one key, so a rename is one string.
 */
const MENU: readonly MenuItem[] = [
  { id: 'account',    labelKey: 'liveAccount.hub.myAccount',  icon: KeyRound },
  { id: 'services',   labelKey: 'liveAccount.hub.services',   icon: Layers },
  { id: 'channels',   labelKey: 'liveAccount.hub.channels',   icon: ListVideo },
  { id: 'appearance', labelKey: 'liveAccount.hub.appearance', icon: Palette },
  { id: 'rewind',     labelKey: 'liveAccount.hub.rewind',     icon: History },
  { id: 'player',     labelKey: 'liveAccount.hub.player',     icon: Gauge },
  { id: 'help',       labelKey: 'liveAccount.hub.help',       icon: LifeBuoy },
  { id: 'signout',    labelKey: 'liveAccount.hub.signOut',    icon: LogOut },
];

const fallback = (
  <div className="min-h-screen flex items-center justify-center text-white bg-black/70">
    <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
  </div>
);

/** The How-to guide's hooks on the menu rows (data-howto; literals, so its check finds them). */
const HUB_HOWTO: Partial<Record<MenuId, string>> = {
  services: 'hub.services', channels: 'hub.channels', appearance: 'hub.appearance', rewind: 'hub.rewind', signout: 'hub.signOut',
};

/** Pages drawn beside the menu (Sign out has none: OK signs out). */
const EMBEDDED: ReadonlySet<MenuId> = new Set<MenuId>(['account', 'services', 'channels', 'appearance', 'rewind', 'player', 'help']);
/** In the demo only these work; the account and line pages are inert there. */
const DEMO_OK: ReadonlySet<MenuId> = new Set<MenuId>(['appearance', 'rewind', 'player', 'help']);
/** The page beside the menu follows the highlight once it rests this long (no page mounts for every row passed). */
const PREVIEW_REST_MS = 250;

/**
 * Live TV -> Settings. The menu is a column on the left (Up / Down) and the
 * highlighted page sits on the right; OK or Right moves the remote into it,
 * Back (or Left at its edge) returns to the menu, Back on the menu leaves.
 * A page opens at most one more level (Hide categories, Devices on this line,
 * the billing view, the other provider's form), and Back goes up one level.
 * Owner, 2026-10-14: every settings screen laid out like Account info.
 */
const SettingsHub = memo(({
  onBack, initialView, onSignOut, onChangeCredentials, onSwitchAccount, onTryLayout, line = null,
  onUpdateChannels, onOpenBufferingGuide, onNavigate, onAddLine,
}: Props) => {
  const { t } = useTranslation();
  const billingOn = useBillingEnabled();

  // Opened on a page (the assistant's "open Appearance"): that page, with the remote in it.
  // Devices on this line is a level inside My Account: My Account, opened on it.
  const openOn = initialView === 'devices' ? 'account' : initialView;
  const startEmbedded = !!openOn && openOn !== 'menu' && openOn !== 'billing';
  const [view, setView] = useState<View>(openOn === 'billing' ? 'billing' : 'menu');
  const [pane, setPane] = useState<'menu' | 'page'>(startEmbedded ? 'page' : 'menu');
  const startIdx = startEmbedded ? Math.max(1, MENU.findIndex((m) => m.id === openOn) + 1) : 1;
  // Only the first time My Account shows: back on the menu, it opens as usual again.
  const [devicesFirst, setDevicesFirst] = useState(initialView === 'devices');
  const [menuIdx, setMenuIdx] = useState(startIdx); // 0 = Back; start on the first row
  const menuIdxRef = useRef(menuIdx);
  useEffect(() => { menuIdxRef.current = menuIdx; }, [menuIdx]);
  // The menu item whose page is on the right.
  const [shown, setShown] = useState<MenuId>(() => MENU[startIdx - 1]?.id ?? 'account');
  // Each row's state line; read again when the remote comes back to the menu.
  const states = useHubStates(`${view}:${pane}`);
  useEffect(() => { if (devicesFirst && (pane === 'menu' || shown !== 'account')) setDevicesFirst(false); }, [devicesFirst, pane, shown]);

  // The page follows the highlight once it rests (Back keeps the last page).
  useEffect(() => {
    if (pane !== 'menu' || menuIdx < 1) return;
    const id = MENU[menuIdx - 1]?.id;
    if (!id || id === shown) return;
    const timer = window.setTimeout(() => setShown(id), PREVIEW_REST_MS);
    return () => window.clearTimeout(timer);
  }, [menuIdx, pane, shown]);

  // Follow the highlight down the menu: with a bigger text size Sign out
  // sits below the fold, and the highlight moved there without the menu scrolling.
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

  // Sign out asks once: the first OK says "Press OK again to sign out", the
  // second signs out. Moving the highlight, another row or Back takes it back.
  const [signOutAsk, setSignOutAsk] = useState(false);
  const signOutAskRef = useRef(signOutAsk);
  signOutAskRef.current = signOutAsk;

  const activate = useCallback((id: MenuId) => {
    // Demo: My Account / Services / Channels / Sign out are inert — the demo
    // account is pre-loaded. Appearance, Recording & rewind, Player and Fix a
    // problem stay fully functional (per-box settings; nothing to protect).
    if (DEMO && !DEMO_OK.has(id)) { setPane('menu'); setSignOutAsk(false); demoNote(); return; }
    // A row without a page beside the menu leaves the remote on the menu
    // (a tap or air-mouse click can come while the remote is in a page).
    if (id === 'signout') {
      setPane('menu');
      if (!signOutAskRef.current) { setSignOutAsk(true); return; }
      setSignOutAsk(false);
      onSignOut();
    } else {
      setSignOutAsk(false);
      if (EMBEDDED.has(id)) { setShown(id); setPane('page'); }
    }
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
        // Back first takes back Sign out's question (one Back, one step).
        if (signOutAskRef.current) { setSignOutAsk(false); return; }
        onBack();
        return;
      }
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      if (e.key === 'ArrowDown') { setSignOutAsk(false); setMenuIdx(i => Math.min(COUNT - 1, i + 1)); }
      else if (e.key === 'ArrowUp') { setSignOutAsk(false); setMenuIdx(i => Math.max(0, i - 1)); }
      else if (e.key === 'ArrowLeft') return; // the menu is the left edge
      else if (e.repeat) return; // a held OK would answer Sign out's question
      else {
        const i = menuIdxRef.current;
        if (i === 0) { if (e.key !== 'ArrowRight') onBack(); return; }
        const item = MENU[i - 1];
        // Right only steps into a page; it never signs out.
        if (e.key === 'ArrowRight' && !EMBEDDED.has(item.id)) return;
        activate(item.id);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [view, pane, onBack, activate]);

  /** My Account's button that opened the billing view: it has the highlight again on the way back. */
  const [billingFrom, setBillingFrom] = useState<'renew' | 'plans' | undefined>(undefined);
  /** Renew: the billing account's service for this line, renewed as the view opens. */
  const [renewServiceId, setRenewServiceId] = useState<number | undefined>(undefined);
  const toMenu = useCallback(() => { setPane('menu'); setBillingFrom(undefined); }, []);
  const openBilling = useCallback((serviceId?: number) => {
    setRenewServiceId(serviceId);
    setBillingFrom(serviceId != null ? 'renew' : 'plans');
    setView('billing');
  }, []);
  // Back from the plans and renewals: My Account's page, with the remote in it (one level back), on the button used.
  const closeBilling = useCallback(() => {
    setView('menu');
    setShown('account');
    setMenuIdx(MENU.findIndex((m) => m.id === 'account') + 1);
    setPane('page');
    setRenewServiceId(undefined);
  }, []);
  // Fix a problem › Speed test / Submit a Ticket: Support, on that tool.
  const openTool = useCallback((tool: SupportTool) => { if (onNavigate) openSupportTool(tool, onNavigate); }, [onNavigate]);

  if (view === 'billing') {
    return (
      <Suspense fallback={fallback}>
        <BillingAccountScreen onBack={closeBilling} onUseInPlayer={onSwitchAccount} renewServiceId={renewServiceId} />
      </Suspense>
    );
  }

  const inPage = pane === 'page';
  const shownItem = MENU.find((m) => m.id === shown) ?? MENU[0];
  const page = (() => {
    const common = { embedded: true, active: inPage, onBack: toMenu } as const;
    if (DEMO && !DEMO_OK.has(shown)) return <PageHint text={t('liveAccount.hub.demoDesc')} />;
    switch (shown) {
      // Devices on this line asks the server for the line's devices: only once opened from the page.
      case 'account': return <AccountInfoScreen {...common} onChangeCredentials={onChangeCredentials} onSignOut={onSignOut} onOpenBilling={billingOn ? openBilling : undefined} initialFocus={billingFrom} devicesLine={line} initialDevicesOpen={devicesFirst} />;
      // Reads only what is on the box (a line too long unchecked is checked with its panel).
      case 'services': return <ServicesScreen active={inPage} onBack={toMenu} onPicked={onSwitchAccount} onAddAccount={onAddLine ?? onChangeCredentials} />;
      // Hide categories reads every line's categories from its server: only once opened from the page.
      case 'channels': return <ChannelsScreen active={inPage} onBack={toMenu} onUpdateChannels={onUpdateChannels} />;
      case 'appearance': return <AppearanceScreen {...common} onTryLayout={onTryLayout} />;
      case 'rewind': return <RewindSettingsScreen {...common} />;
      case 'player': return <PlaybackScreen {...common} />;
      case 'help': return <FixProblemScreen active={inPage} onBack={toMenu} onOpenBufferingGuide={onOpenBufferingGuide} onOpenSupportTool={onNavigate ? openTool : undefined} />;
      case 'signout': return <PageHint text={signOutAsk ? t('liveAccount.hub.signOutConfirm') : t('liveAccount.hub.signOutHint')} />;
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
        <div ref={scrollRef} className="md:w-64 lg:w-72 shrink-0 overflow-auto mb-4 md:mb-0 md:mr-4 lg:mr-5">
          {/* Eight rows of name + state fit 960×540 without scrolling: keep them this short. */}
          <div className="space-y-1" data-settings-menu>
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
                  data-hub-row={m.id}
                  className={`tv-ring flex items-center rounded-xl px-3.5 py-1.5 border cursor-pointer ${current ? 'bg-brand-gold/15 border-brand-gold/50' : 'bg-slate-900/60 border-white/10'} ${focused ? 'scale-[1.02] z-10' : ''}`}
                >
                  <Icon className="w-[18px] h-[18px] mr-2.5 text-brand-gold shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p data-hub-label className="text-sm leading-5 font-quicksand font-semibold truncate">{t(m.labelKey)}</p>
                    {/* Always one line tall, so the rows don't jump while a state is read. */}
                    {m.id === 'signout' && signOutAsk
                      ? <p data-hub-state data-confirm="true" className="text-xs leading-4 font-nunito text-amber-300 truncate">{t('liveAccount.hub.signOutConfirm')}</p>
                      : <p data-hub-state className="text-xs leading-4 font-nunito text-brand-ice/70 truncate">{states[m.id] || '\u00a0'}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* A tap or air-mouse click in the page beside the menu takes the remote into it, as OK
            would: otherwise a level opened by the tap (Devices on this line, Hide categories, the
            other provider's form) gets no keys, and Back closes Settings altogether. */}
        <div
          className="flex-1 min-w-0 min-h-0 flex flex-col"
          data-settings-preview={inPage ? 'false' : 'true'}
          data-settings-page={shown}
          onClickCapture={() => {
            if (!inPage && EMBEDDED.has(shown) && !(DEMO && !DEMO_OK.has(shown))) { setSignOutAsk(false); setPane('page'); }
          }}
        >
          <h2 className="text-base font-quicksand font-semibold text-brand-ice/90 mb-2 truncate">{t(shownItem.labelKey)}</h2>
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
