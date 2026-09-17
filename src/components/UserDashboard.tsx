import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { useDashboardSize } from '@/lib/dashboardSize';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, Wallet, CreditCard, History, User, LogOut, Plus, MessageCircle, ShoppingCart, MapPin, Users, Sparkles, Gamepad2, Trash2, Pencil, Gift, BellRing, Check, Tv, LogIn, UserPlus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { isDemo } from '@/lib/demoMode';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import UserServicesEditor from '@/components/UserServicesEditor';
import { useMyUserServices, daysUntil } from '@/hooks/useUserServices';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import PlayerAccountCard from '@/components/PlayerAccountCard';
import ClaimAccountCard, { type ClaimCloseOutcome } from '@/components/livetv/ClaimAccountCard';
import { claimDoneKey, isClaimDone } from '@/lib/accountClaim';
import { useBillingEnabled } from '@/hooks/useBillingEnabled';

// Billing account (plans, renewals, trial). Behind the billing_account flag.
const BillingAccountScreen = lazy(() => import('@/components/billing/BillingAccountScreen'));


interface UserDashboardProps {
  onViewChange: (view: 'home' | 'apps' | 'media' | 'news' | 'support' | 'chat' | 'settings' | 'user' | 'community' | 'credits' | 'games' | 'account-signin' | 'livetv') => void;
  onManageMedia: () => void;
  onViewSettings: () => void;
  onCommunityChat: () => void;
  onCreditStore: () => void;
  onGames?: () => void;
  onGiveaway?: () => void;
}

const UserDashboard = ({ onViewChange, onManageMedia, onViewSettings, onCommunityChat, onCreditStore, onGames, onGiveaway }: UserDashboardProps) => {
  const { enabled: giveawayEnabled } = useFeatureFlag('giveaway_enabled', false);
  const giveawayOn = giveawayEnabled && !isDemo();
  // Billing account section (plans / renew / trial) — flag + native plugin.
  const billingOn = useBillingEnabled();
  const [billingOpen, setBillingOpen] = useState(false);
  // Focus indices shift by one when the Giveaway action button is visible.
  const TAB_BASE = giveawayOn ? 6 : 5;
  const CLAIM_IDX = TAB_BASE + 2;
  const BILLING_IDX = CLAIM_IDX + 1;
  const EDIT_IDX = billingOn ? BILLING_IDX + 1 : CLAIM_IDX + 1;
  const DELETE_IDX = EDIT_IDX + 1;
  const { user, signOut, loading: authLoading } = useAuth();
  const { profile, transactions, loading } = useUserProfile();
  const { toast } = useToast();
  const [showPurchase, setShowPurchase] = useState(false);
  const [focusedElement, setFocusedElement] = useState(0);
  const [activeTab, setActiveTab] = useState('overview');
  const large = useDashboardSize() === 'large';
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showServicesEditor, setShowServicesEditor] = useState(false);
  const { devices: myDevices, services: myServices, refetch: refetchUserServices } = useMyUserServices();
  const dashboardScrollRef = useRef<HTMLDivElement>(null);
  const { account: playerAccount, loading: playerLoading } = usePlayerAccount();
  const [claimOpen, setClaimOpen] = useState(false);
  const claimDone = !!playerAccount && isClaimDone(playerAccount);
  const claimedEmail = (() => {
    if (!playerAccount || !claimDone) return '';
    try { return localStorage.getItem(claimDoneKey(playerAccount.host, playerAccount.username)) || ''; } catch { return ''; }
  })();
  // The claim button only occupies a focus slot when it is actually rendered.
  const claimAvailable = !!playerAccount && !claimDone;
  // Website-user dashboard: the Player Account slot (CLAIM_IDX) is live when
  // there is no Player account yet ("Sign in with Dreamstreams / Vibez" →
  // Account Chooser) OR when a claim is available. Never in the web demo
  // (usePlayerAccount is always null there and Player sign-in is disabled).
  const playerActionAvailable = (!playerAccount && !isDemo()) || claimAvailable;
  // Guest (player-only) mode: no website (Supabase) user. Renders only the
  // Player Account section + a "Website account" card; every website-only
  // section (gems, tabs, services editor, Danger Zone, Sign Out) is hidden.
  // Guest focus slots: 0 back, 1 player action (Sign in with DS/Vibez when no
  // player account, else Link email while a claim is available), 2 billing
  // account (when the flag is on), 3 website "Sign in", 4 website "Create
  // free account".
  const guestMode = !user;
  const guestPlayerSlot = !playerAccount || claimAvailable;
  const navigate = useNavigate();



  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke('delete-account', {
        body: {},
      });
      if (error) throw error;
      toast({ title: 'Account deleted', description: 'Your account has been permanently deleted.' });
      await signOut();
      onViewChange('home');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Could not delete your account.';
      toast({ title: 'Deletion failed', description: msg, variant: 'destructive' });
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };


  // Focus positions:
  // 0: back, 1: signout
  // 2: purchase credits, 3: community chat, 4: games, [5: giveaway when flag on]
  // TAB_BASE..TAB_BASE+1: overview/credits tabs
  // EDIT_IDX: edit services, DELETE_IDX: delete account

  // Android TV/Firestick navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // The claim card / billing screen owns the D-pad while it is open.
      if (claimOpen || billingOpen) return;
      if (guestMode) {
        // A modal (auto-update prompt, welcome popup, dialogs) owns the keyboard.
        if (document.querySelector('[data-autoupdate-dialog="true"], [aria-modal="true"]')) return;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        const belowBack = guestPlayerSlot ? 1 : billingOn ? 2 : 3;
        const aboveWebsite = billingOn ? 2 : guestPlayerSlot ? 1 : 0;
        switch (event.key) {
          case 'ArrowDown':
            if (focusedElement === 0) setFocusedElement(belowBack);
            else if (focusedElement === 1) setFocusedElement(billingOn ? 2 : 3);
            else if (focusedElement === 2) setFocusedElement(3);
            break;
          case 'ArrowUp':
            if (focusedElement === 1) setFocusedElement(0);
            else if (focusedElement === 2) setFocusedElement(guestPlayerSlot ? 1 : 0);
            else if (focusedElement === 3 || focusedElement === 4) setFocusedElement(aboveWebsite);
            break;
          case 'ArrowRight':
            if (focusedElement === 3) setFocusedElement(4);
            break;
          case 'ArrowLeft':
            if (focusedElement === 4) setFocusedElement(3);
            break;
          case 'Enter':
          case ' ':
            if (focusedElement === 0) onViewChange('home');
            else if (focusedElement === 1) {
              if (!playerAccount) onViewChange('account-signin');
              else if (claimAvailable) setClaimOpen(true);
            }
            else if (focusedElement === 2) setBillingOpen(true);
            else if (focusedElement === 3 || focusedElement === 4) navigate('/auth');
            break;
        }
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }
      
      // Back is handled globally by Index.tsx's bubble keydown handler
      // (double-firing here previously pushed home back on top of the stack).
      
      switch (event.key) {
        case 'ArrowLeft':
          if (focusedElement === 1) setFocusedElement(0); // signout -> back
          else if (focusedElement === 3) setFocusedElement(2); // community -> purchase
          else if (focusedElement === 4) setFocusedElement(3); // games -> community
          else if (giveawayOn && focusedElement === 5) setFocusedElement(4); // giveaway -> games
          else if (focusedElement > TAB_BASE && focusedElement <= TAB_BASE + 1) setFocusedElement(focusedElement - 1); // tabs
          break;
        case 'ArrowRight':
          if (focusedElement === 0) setFocusedElement(1); // back -> signout
          else if (focusedElement === 2) setFocusedElement(3); // purchase -> community
          else if (focusedElement === 3) setFocusedElement(4); // community -> games
          else if (giveawayOn && focusedElement === 4) setFocusedElement(5); // games -> giveaway
          else if (focusedElement >= TAB_BASE && focusedElement < TAB_BASE + 1) setFocusedElement(focusedElement + 1); // tabs
          break;
        case 'ArrowUp':
          if (focusedElement >= 2 && focusedElement < TAB_BASE) {
            setFocusedElement(0); // action buttons -> back
          } else if (focusedElement >= TAB_BASE && focusedElement <= TAB_BASE + 1) {
            const container = dashboardScrollRef.current;
            const currentTop = container?.scrollTop ?? window.scrollY;
            if (currentTop > 10) {
              if (container) container.scrollBy({ top: -300, behavior: 'smooth' });
              else window.scrollBy({ top: -300, behavior: 'smooth' });
            } else {
              setFocusedElement(2); // tabs -> purchase credits
            }
          } else if (focusedElement === CLAIM_IDX) {
            setFocusedElement(TAB_BASE); // player account -> overview tab
          } else if (billingOn && focusedElement === BILLING_IDX) {
            setFocusedElement(playerActionAvailable ? CLAIM_IDX : TAB_BASE); // billing -> player action / overview tab
          } else if (focusedElement === EDIT_IDX) {
            setFocusedElement(billingOn ? BILLING_IDX : playerActionAvailable ? CLAIM_IDX : TAB_BASE); // edit -> billing / player action / overview tab
          } else if (focusedElement === DELETE_IDX) {
            setFocusedElement(EDIT_IDX); // delete -> edit
          }
          break;
        case 'ArrowDown':
          if (focusedElement === 0 || focusedElement === 1) {
            setFocusedElement(2); // header -> purchase credits
          } else if (focusedElement >= 2 && focusedElement < TAB_BASE) {
            setFocusedElement(TAB_BASE); // action buttons -> first tab
          } else if (focusedElement >= TAB_BASE && focusedElement <= TAB_BASE + 1) {
            if (activeTab === 'overview') {
              setFocusedElement(playerActionAvailable ? CLAIM_IDX : billingOn ? BILLING_IDX : EDIT_IDX); // tabs -> player action / billing / edit button
            } else {
              const container = dashboardScrollRef.current;
              if (container) container.scrollBy({ top: 300, behavior: 'smooth' });
              else window.scrollBy({ top: 300, behavior: 'smooth' });
            }
          } else if (focusedElement === CLAIM_IDX) {
            setFocusedElement(billingOn ? BILLING_IDX : EDIT_IDX); // player account -> billing / edit
          } else if (billingOn && focusedElement === BILLING_IDX) {
            setFocusedElement(EDIT_IDX); // billing -> edit
          } else if (focusedElement === EDIT_IDX) {
            setFocusedElement(DELETE_IDX); // edit -> delete
          } else if (focusedElement === DELETE_IDX) {
            const container = dashboardScrollRef.current;
            if (container) container.scrollBy({ top: 300, behavior: 'smooth' });
            else window.scrollBy({ top: 300, behavior: 'smooth' });
          }
          break;
        case 'Enter':
        case ' ':
          if (focusedElement === 0) onViewChange('home');
          else if (focusedElement === 1) handleSignOut();
          else if (focusedElement === 2) onCreditStore();
          else if (focusedElement === 3) onCommunityChat();
          else if (focusedElement === 4) onGames?.();
          else if (giveawayOn && focusedElement === 5) onGiveaway?.();
          else if (focusedElement === TAB_BASE) setActiveTab('overview');
          else if (focusedElement === TAB_BASE + 1) setActiveTab('credits');
          else if (focusedElement === CLAIM_IDX) {
            if (!playerAccount && !isDemo()) onViewChange('account-signin');
            else if (claimAvailable) setClaimOpen(true);
          }
          else if (billingOn && focusedElement === BILLING_IDX) setBillingOpen(true);
          else if (focusedElement === EDIT_IDX) setShowServicesEditor(true);
          else if (focusedElement === DELETE_IDX) setShowDeleteConfirm(true);
          break;
      }
    };


    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedElement, activeTab, onViewChange, onCreditStore, onCommunityChat, onGames, onGiveaway, giveawayOn, TAB_BASE, CLAIM_IDX, BILLING_IDX, EDIT_IDX, DELETE_IDX, claimAvailable, claimOpen, billingOn, billingOpen, playerActionAvailable, guestMode, guestPlayerSlot, playerAccount, navigate]);

  // When the active tab changes (after initial mount), scroll the tab strip
  // into view. Skipping the first run keeps the dashboard scrolled to the top
  // on entry so the Back / Sign Out buttons are visible.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      // Ensure we start at the top on entry.
      dashboardScrollRef.current?.scrollTo({ top: 0, left: 0 });
      window.scrollTo({ top: 0, left: 0 });
      return;
    }
    const id = setTimeout(() => {
      const tab = document.querySelector('[role="tab"][data-state="active"]') as HTMLElement | null;
      tab?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
    return () => clearTimeout(id);
  }, [activeTab]);

  // Scroll focused Edit/Delete buttons into view
  useEffect(() => {
    if (focusedElement !== CLAIM_IDX && focusedElement !== EDIT_IDX && focusedElement !== DELETE_IDX) return;
    const id = setTimeout(() => {
      const el = document.querySelector(`[data-dash-focus="true"]`) as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
    return () => clearTimeout(id);
  }, [focusedElement, CLAIM_IDX, EDIT_IDX, DELETE_IDX]);

  // Guest (player-only) layout: keep the focused control visible. The effect
  // above only handles CLAIM/EDIT/DELETE; guest slots are 0-3 inside the same
  // h-dvh overflow-y-auto container, and the "Link email" / website buttons
  // sit below the fold on 720p-class WebViews.
  useEffect(() => {
    if (!guestMode) return;
    const id = setTimeout(() => {
      if (focusedElement === 0) {
        dashboardScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const el = document.querySelector('[data-dash-focus="true"]') as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
    return () => clearTimeout(id);
  }, [focusedElement, guestMode]);




  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast({
        title: "Error signing out",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Signed out",
        description: "You have been successfully signed out.",
      });
      onViewChange('home');
    }
  };

  // The billing account screen replaces the dashboard while open. It owns the
  // D-pad (the keydown effect above bails on billingOpen) and the hardware
  // Back (useOwnHardwareBack inside it); Back returns here.
  if (billingOpen) {
    return (
      <Suspense fallback={
        <div className="tv-safe min-h-dvh text-white flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-gold"></div>
        </div>
      }>
        <BillingAccountScreen
          ownsHardwareBack
          onBack={() => setBillingOpen(false)}
          onUseInPlayer={() => { setBillingOpen(false); onViewChange('livetv'); }}
        />
      </Suspense>
    );
  }

  if (loading || authLoading || playerLoading) {
    return (
      <div className="tv-safe min-h-dvh text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-gold mx-auto mb-4"></div>
          <p className="text-xl text-brand-ice">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (guestMode) {
    const guestRing = (idx: number) =>
      focusedElement === idx ? 'scale-105 z-10' : '';
    return (
      <div ref={dashboardScrollRef} className="tv-scroll-container tv-safe text-white h-dvh overflow-y-auto overscroll-contain">
        <div className={BACK_ROW}>
          <BackButton
            onClick={() => onViewChange('home')}
            label="Back to Home"
            focused={focusedElement === 0}
          />
        </div>
        <div className="max-w-4xl mx-auto pb-24">
          <div className="text-center mt-4 mb-8">
            <h1 className="text-3xl font-quicksand font-bold text-white mb-2 text-shadow-strong">My Account</h1>
            <p className="text-xl text-brand-ice font-nunito">
              {playerAccount
                ? `Signed in to ${playerAccount.serverLabel} as ${playerAccount.username}`
                : 'You are not signed in yet.'}
            </p>
          </div>

          {/* Player Account — Dreamstreams / Vibez streaming login (local, same store the Player uses) */}
          <Card className="bg-gradient-to-br from-brand-navy/85 via-[#12204a]/85 to-slate-950/90 border-brand-ice/20 shadow-xl rounded-3xl p-6 mb-6">
            <h2 className="text-2xl font-quicksand font-bold text-white mb-1">Player Account</h2>
            <p className="text-brand-ice/75 text-sm mb-4">
              Your Dreamstreams / Vibez streaming login — the same one the Player uses.
            </p>
            {!playerAccount ? (
              <Button
                variant="gold"
                size="lg"
                data-focused={focusedElement === 1 ? 'true' : 'false'}
                data-dash-focus={focusedElement === 1 ? 'true' : 'false'}
                onClick={() => onViewChange('account-signin')}
                className={`tv-ring tv-ring-contrast min-h-12 rounded-xl transition-transform duration-150 ease-out ${guestRing(1)}`}
              >
                <Tv className="w-5 h-5 mr-2" />
                Sign in with Dreamstreams / Vibez
              </Button>
            ) : (
              <div className="space-y-4">
                <PlayerAccountCard />
                {claimDone ? (
                  <p className="text-sm text-emerald-400 flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Reminders are linked to {claimedEmail || 'your email'}
                  </p>
                ) : (
                  <Button
                    variant="gold"
                    size="lg"
                    data-focused={focusedElement === 1 ? 'true' : 'false'}
                    data-dash-focus={focusedElement === 1 ? 'true' : 'false'}
                    onClick={() => setClaimOpen(true)}
                    className={`tv-ring tv-ring-contrast min-h-12 rounded-xl transition-transform duration-150 ease-out ${guestRing(1)}`}
                  >
                    <BellRing className="w-5 h-5 mr-2" />
                    Link email for renewal reminders
                  </Button>
                )}
              </div>
            )}
          </Card>

          {/* Billing account — Dreamstreams plans, renewals and the free trial */}
          {billingOn && (
            <Card className="bg-gradient-to-br from-brand-navy/85 via-[#12204a]/85 to-slate-950/90 border-brand-ice/20 shadow-xl rounded-3xl p-6 mb-6">
              <h2 className="text-2xl font-quicksand font-bold text-white mb-1">Billing &amp; subscription</h2>
              <p className="text-brand-ice/75 text-sm mb-4">
                See your Dreamstreams plan, renew, buy a plan, redeem a gift code, or link a billing account to this device.
              </p>
              <Button
                variant="gold"
                size="lg"
                data-focused={focusedElement === 2 ? 'true' : 'false'}
                data-dash-focus={focusedElement === 2 ? 'true' : 'false'}
                onClick={() => setBillingOpen(true)}
                className={`tv-ring tv-ring-contrast min-h-12 rounded-xl transition-transform duration-150 ease-out ${guestRing(2)}`}
              >
                <CreditCard className="w-5 h-5 mr-2" />
                {playerAccount ? 'Link a billing account' : 'Open billing account'}
              </Button>
            </Card>
          )}

          {/* Website account — optional Snow Media WEBSITE account (Supabase) */}
          <Card className="bg-gradient-to-br from-brand-navy/85 via-[#12204a]/85 to-slate-950/90 border-brand-ice/20 shadow-xl rounded-3xl p-6">
            <h2 className="text-2xl font-quicksand font-bold text-white mb-1">Website account</h2>
            <p className="text-brand-ice/75 text-sm mb-4">
              Optional Snow Media WEBSITE account (email &amp; password) for purchases, support
              tickets, messages and Snow Gems. This is not your streaming login.
            </p>
            <div className="flex flex-wrap gap-4">
              <Button
                variant="gold"
                size="lg"
                data-focused={focusedElement === 3 ? 'true' : 'false'}
                data-dash-focus={focusedElement === 3 ? 'true' : 'false'}
                onClick={() => navigate('/auth')}
                className={`tv-ring tv-ring-contrast min-h-12 rounded-xl transition-transform duration-150 ease-out ${guestRing(3)}`}
              >
                <LogIn className="w-5 h-5 mr-2" />
                Sign in
              </Button>
              <Button
                variant="white"
                size="lg"
                data-focused={focusedElement === 4 ? 'true' : 'false'}
                data-dash-focus={focusedElement === 4 ? 'true' : 'false'}
                onClick={() => navigate('/auth')}
                className={`tv-ring min-h-12 rounded-xl transition-transform duration-150 ease-out ${guestRing(4)}`}
              >
                <UserPlus className="w-5 h-5 mr-2" />
                Create free account
              </Button>
            </div>
          </Card>
        </div>

        {claimOpen && playerAccount && (
          <ClaimAccountCard
            open={true}
            account={playerAccount}
            onClose={(outcome: ClaimCloseOutcome, email?: string) => {
              setClaimOpen(false);
              if (outcome === 'done') {
                // Slot 1 disappears once the claim is done — park focus on Back.
                setFocusedElement(0);
                toast({
                  title: "You're all set",
                  description: email ? `Your Snow Media account is ready (${email}).` : 'Saved. Add an email any time to get a Snow Media account.',
                });
              }
            }}
          />
        )}
      </div>
    );
  }

  // Compact fits one 1080p screen; Large is the roomier original (Settings → UI).
  const sz = large ? {
    gap: 'gap-4', rowGap: 'mb-6',
    h1: 'text-3xl', sub: 'text-lg', hdrBtn: 'min-h-12 px-5',
    stat: 'rounded-2xl px-5 py-4', statVal: 'text-3xl', statIcon: 'w-7 h-7', statIconBox: 'w-14 h-14', statLabel: 'text-sm',
    btn: 'min-h-12 text-base', tab: 'min-h-12',
    card: 'rounded-3xl p-6', h2: 'text-2xl mb-4',
    sec: 'mt-8 pt-6 border-t border-brand-ice/15',
    stack: 'space-y-4', lines: 'space-y-2',
    h3: 'text-xl font-quicksand font-semibold text-brand-gold',
  } : {
    gap: 'gap-3', rowGap: 'mb-3',
    h1: 'text-xl', sub: 'text-xs', hdrBtn: 'min-h-11 px-4',
    stat: 'rounded-xl px-4 py-2.5', statVal: 'text-2xl', statIcon: 'w-5 h-5', statIconBox: 'w-10 h-10', statLabel: 'text-[11px]',
    btn: 'h-10 px-4 text-sm', tab: 'min-h-9 text-sm',
    card: 'rounded-2xl p-3 pb-2', h2: 'text-lg mb-2',
    sec: 'rounded-xl bg-black/20 border border-white/10 p-3',
    stack: 'space-y-2', lines: 'space-y-1 text-sm',
    h3: 'text-xs uppercase tracking-[0.12em] font-quicksand font-semibold text-brand-gold',
  };

  return (
    <div ref={dashboardScrollRef} className="tv-scroll-container tv-safe text-white h-dvh overflow-y-auto overscroll-contain">

      {/* Everything above the tabs sits on one 8px rhythm: a three-column
          header (Back · title · Sign Out), three stat tiles, three actions
          that share the tiles' columns, then the tab bar. Same gutter
          between every row and column, same height for every control in a
          row, icons always in the same place. */}
      <div className={`grid grid-cols-[1fr_auto_1fr] items-center ${sz.gap} ${sz.rowGap}`}>
        <div className="justify-self-start">
        <BackButton
          onClick={() => onViewChange('home')}
          label="Back to Home"
          focused={focusedElement === 0}
        />
        </div>
        <div className="min-w-0 text-center">
          <h1 className={`${sz.h1} font-quicksand font-bold text-white text-shadow-strong leading-tight`}>Your Dashboard</h1>
          <p className={`${sz.sub} text-brand-ice font-nunito truncate`}>Welcome back, <span className="text-brand-gold font-semibold">{profile?.full_name || user?.email}</span></p>
        </div>
        <Button
          onClick={handleSignOut}
          variant="outline"
          data-focused={focusedElement === 1 ? 'true' : 'false'}
          className={`tv-ring justify-self-end ${sz.hdrBtn} rounded-xl bg-red-600/30 border-red-400/60 text-white hover:bg-red-600/50 transition-transform duration-150 ease-out ${
            focusedElement === 1 ? 'scale-105 z-10' : ''
          }`}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </div>

      <div className={`max-w-6xl mx-auto ${large ? 'pb-24' : 'pb-4'}`}>
        {/* Stat tiles: icon in a fixed box on the left, label over value. */}
        <div className={`grid grid-cols-3 ${sz.gap} ${sz.rowGap}`}>
          {([
            { label: 'Available Snow Gems', value: profile?.credits?.toFixed(2) || '0.00', Icon: Wallet, bg: '[background:var(--gradient-gold)]', dark: true },
            { label: 'Total Spent', value: `$${profile?.total_spent?.toFixed(2) || '0.00'}`, Icon: CreditCard, bg: '[background:var(--gradient-blue)]', dark: false },
            { label: 'Transactions', value: String(transactions.length), Icon: History, bg: '[background:var(--gradient-purple)]', dark: false },
          ] as const).map(({ label, value, Icon, bg, dark }) => (
            <Card key={label} className={`relative overflow-hidden border-0 shadow-xl ${bg} ${sz.stat}`}>
              <div className="absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-black/20 pointer-events-none" />
              <div className="relative z-10 flex items-center gap-3 min-w-0">
                <div className={`${sz.statIconBox} shrink-0 rounded-xl flex items-center justify-center ${dark ? 'bg-black/15' : 'bg-white/15'}`}>
                  <Icon className={`${sz.statIcon} ${dark ? 'text-black/70' : 'text-white/90'}`} />
                </div>
                <div className="min-w-0">
                  <p className={`${sz.statLabel} font-nunito font-semibold uppercase tracking-wide truncate ${dark ? 'text-black/65' : 'text-white/80'}`}>{label}</p>
                  <p className={`${sz.statVal} font-quicksand font-bold leading-none ${dark ? 'text-black/90' : 'text-white text-shadow-strong'}`}>{value}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Actions: one quiet style, equal widths, each under a tile; the
            icon carries the tile's colour so the pairing still reads. */}
        <div className={`grid ${giveawayOn ? 'grid-cols-4' : 'grid-cols-3'} ${sz.gap} ${sz.rowGap}`}>
          {([
            { idx: 2, label: 'Purchase Snow Gems', Icon: Plus, tint: 'text-brand-gold', onClick: onCreditStore, show: true },
            { idx: 3, label: 'Community Chat', Icon: MessageCircle, tint: 'text-sky-300', onClick: onCommunityChat, show: true },
            { idx: 4, label: 'Game Lounge', Icon: Gamepad2, tint: 'text-fuchsia-300', onClick: onGames, show: true },
            { idx: 5, label: 'Giveaway', Icon: Gift, tint: 'text-brand-gold', onClick: onGiveaway, show: giveawayOn },
          ] as const).filter((a) => a.show).map(({ idx, label, Icon, tint, onClick }) => (
            <Button
              key={label}
              onClick={onClick}
              variant="outline"
              data-focused={focusedElement === idx ? 'true' : 'false'}
              className={`tv-ring ${sz.btn} w-full rounded-xl bg-white/[0.07] border-white/15 text-white font-semibold hover:bg-white/[0.14] transition-transform duration-150 ease-out ${
                focusedElement === idx ? 'scale-[1.03] z-10' : ''
              }`}
            >
              <Icon className={`w-5 h-5 mr-2 ${tint}`} />
              {label}
            </Button>
          ))}
        </div>

        {/* Dashboard Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className={`grid w-full grid-cols-2 h-auto gap-1 rounded-xl bg-brand-navy/70 border border-brand-ice/20 p-1 ${sz.rowGap}`}>
            <TabsTrigger 
              value="overview" 
              data-focused={focusedElement === TAB_BASE ? 'true' : 'false'}
              className={`tv-ring tv-ring-contrast ${sz.tab} rounded-lg text-white data-[state=active]:bg-brand-gold data-[state=active]:text-black text-center whitespace-normal leading-tight transition-transform duration-150 ease-out ${
                focusedElement === TAB_BASE ? 'scale-[1.02] z-10' : ''
              }`}
            >
              Overview
            </TabsTrigger>
            <TabsTrigger 
              value="credits" 
              data-focused={focusedElement === TAB_BASE + 1 ? 'true' : 'false'}
              className={`tv-ring tv-ring-contrast ${sz.tab} rounded-lg text-white data-[state=active]:bg-brand-gold data-[state=active]:text-black text-center whitespace-normal leading-tight transition-transform duration-150 ease-out ${
                focusedElement === TAB_BASE + 1 ? 'scale-[1.02] z-10' : ''
              }`}
            >
              Snow Gems
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0">
            <Card className={`bg-gradient-to-br from-brand-navy/85 via-[#12204a]/85 to-slate-950/90 border-brand-ice/20 shadow-xl ${sz.card}`}>
              <h2 className={`${sz.h2} font-quicksand font-bold text-white`}>Account Overview</h2>
              {/* Compact: the sections sit in a three-column grid of small
                  panels so the whole overview fits one screen. Large: they
                  stack with rules between them, as before. */}
              <div className={large ? '' : 'grid grid-cols-12 gap-3 items-start'}>
              <div className={large ? 'grid grid-cols-1 md:grid-cols-2 gap-6' : `${sz.sec} col-span-3`}>
                <div className={sz.stack}>
                  <h3 className={sz.h3}>Profile Information</h3>
                  <div className={sz.lines}>
                    <p className="text-white/85"><span className="font-medium text-brand-ice">Name:</span> {profile?.full_name || 'Not set'}</p>
                    <p className="text-white/85"><span className="font-medium text-brand-ice">Email:</span> {profile?.email || user?.email}</p>
                    <p className="text-white/85"><span className="font-medium text-brand-ice">Username:</span> {profile?.username || 'Not set'}</p>
                  </div>
                </div>
                <div className={sz.stack}>
                  <h3 className={sz.h3}>Account Stats</h3>
                  <div className={sz.lines}>
                    <p className="text-white/85"><span className="font-medium text-brand-ice">Member Since:</span> {new Date(profile?.created_at || '').toLocaleDateString()}</p>
                    <p className="text-white/85"><span className="font-medium text-brand-ice">Total Snow Gems Used:</span> {profile?.total_spent?.toFixed(2) || '0.00'}</p>
                  </div>
                </div>
              </div>

              {/* Player Account, with Billing under it in the compact grid */}
              <div className={large ? 'contents' : 'col-span-5 space-y-3'}>
              <div className={sz.sec} data-dash-focus={focusedElement === CLAIM_IDX ? 'true' : 'false'}>
                <h3 className={`${sz.h3} ${large ? 'mb-5' : 'mb-2'}`}>Player Account</h3>
                {!playerAccount ? (
                  <div className="space-y-3">
                    <p className="text-brand-ice/75 text-sm">
                      Sign in with your Dreamstreams or Vibez login to see your streaming account here. This also signs you in to the Player.
                    </p>
                    {!isDemo() && (
                      <Button
                        variant="gold"
                        size="lg"
                        onClick={() => onViewChange('account-signin')}
                        data-focused={focusedElement === CLAIM_IDX ? 'true' : 'false'}
                        className={`tv-ring tv-ring-contrast ${sz.btn} rounded-xl transition-transform duration-150 ease-out ${
                          focusedElement === CLAIM_IDX ? 'scale-105 z-10' : ''
                        }`}
                      >
                        <Tv className="w-5 h-5 mr-2" />
                        Sign in with Dreamstreams / Vibez
                      </Button>
                    )}
                  </div>
                ) : (

                  large ? (
                    <div className="space-y-4">
                      <PlayerAccountCard />
                      {(claimDone ? (
                      <p className="text-sm text-emerald-400 flex items-center gap-2">
                        <Check className="w-4 h-4" />
                        Reminders are linked to {claimedEmail || 'your email'}
                      </p>
                    ) : (
                      <Button
                        variant="gold"
                        size={large ? 'lg' : 'sm'}
                        onClick={() => setClaimOpen(true)}
                        data-focused={focusedElement === CLAIM_IDX ? 'true' : 'false'}
                        className={`tv-ring tv-ring-contrast ${large ? sz.btn : 'h-9'} rounded-xl transition-transform duration-150 ease-out ${
                          focusedElement === CLAIM_IDX ? 'scale-105 z-10' : ''
                        }`}
                      >
                        <BellRing className="w-5 h-5 mr-2" />
                        Link email for renewal reminders
                      </Button>
                    ))}
                    </div>
                  ) : (
                    <PlayerAccountCard compact actions={(claimDone ? (
                      <p className="text-sm text-emerald-400 flex items-center gap-2">
                        <Check className="w-4 h-4" />
                        Reminders are linked to {claimedEmail || 'your email'}
                      </p>
                    ) : (
                      <Button
                        variant="gold"
                        size={large ? 'lg' : 'sm'}
                        onClick={() => setClaimOpen(true)}
                        data-focused={focusedElement === CLAIM_IDX ? 'true' : 'false'}
                        className={`tv-ring tv-ring-contrast ${large ? sz.btn : 'h-9'} rounded-xl transition-transform duration-150 ease-out ${
                          focusedElement === CLAIM_IDX ? 'scale-105 z-10' : ''
                        }`}
                      >
                        <BellRing className="w-5 h-5 mr-2" />
                        Link email for renewal reminders
                      </Button>
                    ))} />
                  )
                )}
              </div>

              {/* Billing account — Dreamstreams plans, renewals, trial */}
              {billingOn && (
                <div className={sz.sec} data-dash-focus={focusedElement === BILLING_IDX ? 'true' : 'false'}>
                  <h3 className={`${sz.h3} mb-2`}>Billing &amp; subscription</h3>
                  <p className={`text-brand-ice/75 text-sm ${large ? 'mb-4' : 'mb-2'}`}>
                    Your Dreamstreams plan: renew, buy a plan, redeem a gift code, or link a billing account to this device.
                  </p>
                  <Button
                    variant="gold"
                    size="lg"
                    onClick={() => setBillingOpen(true)}
                    data-focused={focusedElement === BILLING_IDX ? 'true' : 'false'}
                    className={`tv-ring tv-ring-contrast ${sz.btn} rounded-xl transition-transform duration-150 ease-out ${
                      focusedElement === BILLING_IDX ? 'scale-105 z-10' : ''
                    }`}
                  >
                    <CreditCard className="w-5 h-5 mr-2" />
                    {playerAccount ? 'Link a billing account' : 'Open billing account'}
                  </Button>
                </div>
              )}
              </div>

              {/* My Devices & Services, with the Danger Zone under it in the compact grid */}
              <div className={large ? 'contents' : 'col-span-4 space-y-3'}>
              <div className={sz.sec} data-dash-focus={focusedElement === EDIT_IDX ? 'true' : 'false'}>
                <div className={`flex items-center justify-between ${large ? 'mb-6' : 'mb-2'}`}>
                  <h3 className={sz.h3}>My Devices & Services</h3>
                  <Button
                    onClick={() => setShowServicesEditor(true)}
                    data-focused={focusedElement === EDIT_IDX ? 'true' : 'false'}
                    className={`tv-ring ${large ? 'min-h-12 px-5' : 'h-9 px-3 text-sm'} rounded-xl border-0 text-white [background:var(--gradient-blue)] hover:brightness-110 transition-transform duration-150 ease-out ${
                      focusedElement === EDIT_IDX ? 'scale-105 z-10' : ''
                    }`}
                    size="sm"
                  >
                    <Pencil className="w-4 h-4 mr-1" /> Edit
                  </Button>
                </div>
                <div className={large ? 'grid grid-cols-1 md:grid-cols-2 gap-4' : 'space-y-2'}>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-brand-gold/90 mb-1">Devices</p>
                    {myDevices.length === 0 ? (
                      <p className="text-brand-ice/75 text-sm">No devices added yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {myDevices.map(d => (
                          <Badge key={d.id} className="px-3 py-1 bg-brand-ice/15 text-white border border-brand-ice/30">{d.device_type}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-brand-gold/90 mb-1">Services</p>
                    {myServices.length === 0 ? (
                      <p className="text-brand-ice/75 text-sm">No services tracked yet.</p>
                    ) : (
                      <ul className="space-y-1">
                        {myServices.map(s => {
                          const days = daysUntil(s.expiration_date);
                          let label = 'No date';
                          let cls = 'text-slate-400';
                          if (days !== null) {
                            if (days < 0) { label = `Expired ${Math.abs(days)}d ago`; cls = 'text-red-400'; }
                            else if (days === 0) { label = 'Expires today'; cls = 'text-amber-400'; }
                            else if (days <= 7) { label = `In ${days} days`; cls = 'text-amber-400'; }
                            else { label = `${days}d left`; cls = 'text-emerald-400'; }
                          }
                          return (
                            <li key={s.id} className="text-sm text-white/85 flex justify-between gap-2">
                              <span className="truncate">{s.service_name || s.service_type}</span>
                              <span className={cls}>{label}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>


              <div className={`${sz.sec} ${large ? '' : 'flex items-center justify-between gap-3'}`} data-dash-focus={focusedElement === DELETE_IDX ? 'true' : 'false'}>
                <div className="min-w-0">
                  <h3 className={`${sz.h3} !text-red-300 ${large ? 'mb-2' : 'mb-0.5'}`}>Danger Zone</h3>
                  <p className={`text-brand-ice/75 ${large ? 'text-sm mb-4' : 'text-xs'}`}>
                    {large ? 'Permanently delete your Snow Media app account and all associated data.' : 'Delete your app account and its data.'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(true)}
                  data-focused={focusedElement === DELETE_IDX ? 'true' : 'false'}
                  className={`tv-ring ${large ? 'min-h-12 px-5' : 'h-9 px-3 text-sm'} rounded-xl bg-red-600/20 hover:bg-red-600/40 border-red-500/60 text-white transition-transform duration-150 ease-out ${
                    focusedElement === DELETE_IDX ? 'scale-105 z-10' : ''
                  }`}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  {large ? 'Delete My Account' : 'Delete'}
                </Button>
              </div>
              </div>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="credits" className="mt-0">
            <Card className="bg-gradient-to-br from-brand-navy/85 via-[#12204a]/85 to-slate-950/90 border-brand-ice/20 shadow-xl rounded-3xl p-6">
              <h2 className="text-2xl font-quicksand font-bold text-white mb-4 flex items-center">
                <Sparkles className="w-6 h-6 mr-2 text-brand-gold" />
                Snow Gems & AI Usage
              </h2>
              
              {transactions.length === 0 ? (
                <p className="text-brand-ice/75 text-center py-8">No Snow Gem transactions yet</p>
              ) : (
                <div className="space-y-3">
                  {transactions.map((transaction) => (
                    <div 
                      key={transaction.id}
                      className="flex items-center justify-between p-4 bg-black/25 rounded-xl border border-brand-ice/15"
                    >
                      <div className="flex items-center space-x-3">
                        <div className={`w-3 h-3 rounded-full ${
                          transaction.transaction_type === 'purchase' ? 'bg-green-400' :
                          transaction.transaction_type === 'deduction' ? 'bg-red-400' :
                          'bg-blue-400'
                        }`} />
                        <div>
                          <p className="text-white font-medium">{transaction.description}</p>
                          <p className="text-brand-ice/75 text-sm">
                            {new Date(transaction.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={`font-bold ${
                          transaction.transaction_type === 'purchase' ? 'text-green-400' :
                          transaction.transaction_type === 'deduction' ? 'text-red-400' :
                          'text-blue-400'
                        }`}>
                          {transaction.transaction_type === 'deduction' ? '-' : '+'}
                          {transaction.amount.toFixed(2)} Snow Gems
                        </p>
                        <Badge 
                          variant="secondary" 
                          className={`${
                            transaction.transaction_type === 'purchase' ? 'bg-green-600' :
                            transaction.transaction_type === 'deduction' ? 'bg-red-600' :
                            'bg-blue-600'
                          } text-white px-3 py-1`}
                        >
                          {transaction.transaction_type}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </TabsContent>

        </Tabs>
      </div>

      {user && (
        <UserServicesEditor
          open={showServicesEditor}
          onClose={() => setShowServicesEditor(false)}
          userId={user.id}
          email={user.email || ''}
          onSaved={refetchUserServices}
        />
      )}

      {claimOpen && playerAccount && (
        <ClaimAccountCard
          open={true}
          account={playerAccount}
          onClose={(outcome: ClaimCloseOutcome, email?: string) => {
            setClaimOpen(false);
            if (outcome === 'done') {
              toast({
                title: "You're all set",
                description: email ? `Your Snow Media account is ready (${email}).` : 'Saved. Add an email any time to get a Snow Media account.',
              });
            }
          }}
        />
      )}



      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>

        <AlertDialogContent className="rounded-3xl sm:rounded-3xl bg-gradient-to-br from-brand-navy to-slate-950 border-red-500/50 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl text-white">Delete your account?</AlertDialogTitle>
            <AlertDialogDescription className="text-brand-ice/80">
              This permanently removes your Snow Media app account, profile, Snow Gems,
              chats, support tickets and media. This cannot be undone. Your separate
              Streaming player account is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="min-h-12 px-5 rounded-xl bg-white/10 text-white border-brand-ice/30 hover:bg-white/20">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={handleDeleteAccount}
              className="min-h-12 px-5 rounded-xl bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Deleting…' : 'Yes, delete my account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default UserDashboard;