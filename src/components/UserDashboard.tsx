import { useState, useEffect, useRef } from 'react';
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


interface UserDashboardProps {
  onViewChange: (view: 'home' | 'apps' | 'media' | 'news' | 'support' | 'chat' | 'settings' | 'user' | 'community' | 'credits' | 'games' | 'account-signin') => void;
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
  // Focus indices shift by one when the Giveaway action button is visible.
  const TAB_BASE = giveawayOn ? 6 : 5;
  const CLAIM_IDX = TAB_BASE + 2;
  const EDIT_IDX = CLAIM_IDX + 1;
  const DELETE_IDX = EDIT_IDX + 1;
  const { user, signOut, loading: authLoading } = useAuth();
  const { profile, transactions, loading } = useUserProfile();
  const { toast } = useToast();
  const [showPurchase, setShowPurchase] = useState(false);
  const [focusedElement, setFocusedElement] = useState(0);
  const [activeTab, setActiveTab] = useState('overview');
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
  // player account, else Link email while a claim is available), 2 website
  // "Sign in", 3 website "Create free account".
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
      // The claim card owns the D-pad while it is open.
      if (claimOpen) return;
      if (guestMode) {
        // A modal (auto-update prompt, welcome popup, dialogs) owns the keyboard.
        if (document.querySelector('[data-autoupdate-dialog="true"], [aria-modal="true"]')) return;
        if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        switch (event.key) {
          case 'ArrowDown':
            if (focusedElement === 0) setFocusedElement(guestPlayerSlot ? 1 : 2);
            else if (focusedElement === 1) setFocusedElement(2);
            break;
          case 'ArrowUp':
            if (focusedElement === 1) setFocusedElement(0);
            else if (focusedElement === 2 || focusedElement === 3) setFocusedElement(guestPlayerSlot ? 1 : 0);
            break;
          case 'ArrowRight':
            if (focusedElement === 2) setFocusedElement(3);
            break;
          case 'ArrowLeft':
            if (focusedElement === 3) setFocusedElement(2);
            break;
          case 'Enter':
          case ' ':
            if (focusedElement === 0) onViewChange('home');
            else if (focusedElement === 1) {
              if (!playerAccount) onViewChange('account-signin');
              else if (claimAvailable) setClaimOpen(true);
            }
            else if (focusedElement === 2 || focusedElement === 3) navigate('/auth');
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
          } else if (focusedElement === EDIT_IDX) {
            setFocusedElement(playerActionAvailable ? CLAIM_IDX : TAB_BASE); // edit -> player action / overview tab
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
              setFocusedElement(playerActionAvailable ? CLAIM_IDX : EDIT_IDX); // tabs -> player action / edit button
            } else {
              const container = dashboardScrollRef.current;
              if (container) container.scrollBy({ top: 300, behavior: 'smooth' });
              else window.scrollBy({ top: 300, behavior: 'smooth' });
            }
          } else if (focusedElement === CLAIM_IDX) {
            setFocusedElement(EDIT_IDX); // player account -> edit
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
          else if (focusedElement === EDIT_IDX) setShowServicesEditor(true);
          else if (focusedElement === DELETE_IDX) setShowDeleteConfirm(true);
          break;
      }
    };


    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedElement, activeTab, onViewChange, onCreditStore, onCommunityChat, onGames, onGiveaway, giveawayOn, TAB_BASE, CLAIM_IDX, EDIT_IDX, DELETE_IDX, claimAvailable, claimOpen, playerActionAvailable, guestMode, guestPlayerSlot, playerAccount, navigate]);

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

  if (loading || authLoading || playerLoading) {
    return (
      <div className="tv-safe min-h-dvh bg-neutral-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-400 mx-auto mb-4"></div>
          <p className="text-xl text-blue-200">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (guestMode) {
    const guestRing = (idx: number) =>
      focusedElement === idx ? 'ring-4 ring-brand-gold scale-105 shadow-[0_0_22px_rgba(185,162,121,0.75)] brightness-110' : '';
    return (
      <div ref={dashboardScrollRef} className="tv-scroll-container tv-safe bg-neutral-900 text-white h-dvh overflow-y-auto overscroll-contain">
        <div className={BACK_ROW}>
          <BackButton
            onClick={() => onViewChange('home')}
            label="Back to Home"
            focused={focusedElement === 0}
          />
        </div>
        <div className="max-w-4xl mx-auto pb-24">
          <div className="text-center mt-4 mb-8">
            <h1 className="text-4xl font-bold text-white mb-2">My Account</h1>
            <p className="text-xl text-blue-200">
              {playerAccount
                ? `Signed in to ${playerAccount.serverLabel} as ${playerAccount.username}`
                : 'You are not signed in yet.'}
            </p>
          </div>

          {/* Player Account — Dreamstreams / Vibez streaming login (local, same store the Player uses) */}
          <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6 mb-6">
            <h2 className="text-2xl font-bold text-white mb-1">Player Account</h2>
            <p className="text-slate-400 text-sm mb-4">
              Your Dreamstreams / Vibez streaming login — the same one the Player uses.
            </p>
            {!playerAccount ? (
              <Button
                variant="gold"
                size="lg"
                data-focused={focusedElement === 1 ? 'true' : 'false'}
                data-dash-focus={focusedElement === 1 ? 'true' : 'false'}
                onClick={() => onViewChange('account-signin')}
                className={`tv-focusable transition-all duration-200 ${guestRing(1)}`}
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
                    className={`tv-focusable transition-all duration-200 ${guestRing(1)}`}
                  >
                    <BellRing className="w-5 h-5 mr-2" />
                    Link email for renewal reminders
                  </Button>
                )}
              </div>
            )}
          </Card>

          {/* Website account — optional Snow Media WEBSITE account (Supabase) */}
          <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6">
            <h2 className="text-2xl font-bold text-white mb-1">Website account</h2>
            <p className="text-slate-400 text-sm mb-4">
              Optional Snow Media WEBSITE account (email &amp; password) for purchases, support
              tickets, messages and Snow Gems. This is not your streaming login.
            </p>
            <div className="flex flex-wrap gap-4">
              <Button
                variant="gold"
                size="lg"
                data-focused={focusedElement === 2 ? 'true' : 'false'}
                data-dash-focus={focusedElement === 2 ? 'true' : 'false'}
                onClick={() => navigate('/auth')}
                className={`tv-focusable transition-all duration-200 ${guestRing(2)}`}
              >
                <LogIn className="w-5 h-5 mr-2" />
                Sign in
              </Button>
              <Button
                variant="white"
                size="lg"
                data-focused={focusedElement === 3 ? 'true' : 'false'}
                data-dash-focus={focusedElement === 3 ? 'true' : 'false'}
                onClick={() => navigate('/auth')}
                className={`tv-focusable transition-all duration-200 ${guestRing(3)}`}
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
                  description: `Reminders will go to ${email || 'your email'}.`,
                });
              }
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div ref={dashboardScrollRef} className="tv-scroll-container tv-safe bg-neutral-900 text-white h-dvh overflow-y-auto overscroll-contain">

      {/* Header — pinned to the tv-safe corner, content stays centered below */}
      <div className="flex items-center w-full justify-between mb-6">
        <BackButton
          onClick={() => onViewChange('home')}
          label="Back to Home"
          focused={focusedElement === 0}
        />
        <Button
          onClick={handleSignOut}
          variant="outline"
          className={`bg-red-600 border-red-500 text-white hover:bg-red-700 transition-all duration-200 ${
            focusedElement === 1 ? 'ring-4 ring-white/60 scale-105' : ''
          }`}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </div>
      <div className="max-w-6xl mx-auto pb-24">
        <div className="flex flex-col items-center mb-8">
          <div className="text-center mt-4">
            <h1 className="text-4xl font-bold text-white mb-2">Your Dashboard</h1>
            <p className="text-xl text-blue-200">Welcome back, {profile?.full_name || user?.email}</p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-gradient-to-br from-green-600 to-green-800 border-green-500 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm font-medium">Available Snow Gems</p>
                <p className="text-3xl font-bold text-white">{profile?.credits?.toFixed(2) || '0.00'}</p>
              </div>
              <Wallet className="w-12 h-12 text-green-200" />
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-blue-600 to-blue-800 border-blue-500 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm font-medium">Total Spent</p>
                <p className="text-3xl font-bold text-white">${profile?.total_spent?.toFixed(2) || '0.00'}</p>
              </div>
              <CreditCard className="w-12 h-12 text-blue-200" />
            </div>
          </Card>

          <Card className="bg-gradient-to-br from-purple-600 to-purple-800 border-purple-500 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm font-medium">Transactions</p>
                <p className="text-3xl font-bold text-white">{transactions.length}</p>
              </div>
              <History className="w-12 h-12 text-purple-200" />
            </div>
          </Card>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-4 mb-8">
          <Button 
            onClick={onCreditStore}
            size="lg"
            className={`bg-green-600 hover:bg-green-700 text-white transition-all duration-200 ${
              focusedElement === 2 ? 'ring-4 ring-white/60 scale-105' : ''
            }`}
          >
            <Plus className="w-5 h-5 mr-2" />
            Purchase Snow Gems
          </Button>
          <Button 
            onClick={onCommunityChat}
            size="lg"
            variant="outline"
            className={`bg-blue-600/20 border-blue-500/50 text-white hover:bg-blue-600/30 transition-all duration-200 ${
              focusedElement === 3 ? 'ring-4 ring-white/60 scale-105' : ''
            }`}
          >
            <MessageCircle className="w-5 h-5 mr-2" />
            Community Chat
          </Button>
          <Button 
            onClick={onGames}
            size="lg"
            className={`bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white transition-all duration-200 ${
              focusedElement === 4 ? 'ring-4 ring-white/60 scale-105' : ''
            }`}
          >
            <Gamepad2 className="w-5 h-5 mr-2" />
            Games
            <span className="ml-2 text-xs bg-yellow-500/80 text-black px-2 py-0.5 rounded-full">Soon</span>
          </Button>
          {giveawayOn && (
            <Button 
              onClick={onGiveaway}
              size="lg"
              className={`bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-600 hover:to-yellow-700 text-white transition-all duration-200 ${
                focusedElement === 5 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
            >
              <Gift className="w-5 h-5 mr-2" />
              Giveaway
            </Button>
          )}
        </div>

        {/* Dashboard Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 h-auto gap-2 mb-8 bg-slate-800/50 border-slate-600 p-2">
            <TabsTrigger 
              value="overview" 
              className={`min-h-12 text-white data-[state=active]:bg-brand-gold text-center whitespace-normal leading-tight transition-all duration-200 ${
                focusedElement === TAB_BASE ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
            >
              Overview
            </TabsTrigger>
            <TabsTrigger 
              value="credits" 
              className={`min-h-12 text-white data-[state=active]:bg-brand-gold text-center whitespace-normal leading-tight transition-all duration-200 ${
                focusedElement === TAB_BASE + 1 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
            >
              Snow Gems
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0">
            <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6">
              <h2 className="text-2xl font-bold text-white mb-4">Account Overview</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">Profile Information</h3>
                  <div className="space-y-2">
                    <p className="text-slate-300"><span className="font-medium">Name:</span> {profile?.full_name || 'Not set'}</p>
                    <p className="text-slate-300"><span className="font-medium">Email:</span> {profile?.email || user?.email}</p>
                    <p className="text-slate-300"><span className="font-medium">Username:</span> {profile?.username || 'Not set'}</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-white">Account Stats</h3>
                  <div className="space-y-2">
                    <p className="text-slate-300"><span className="font-medium">Member Since:</span> {new Date(profile?.created_at || '').toLocaleDateString()}</p>
                    <p className="text-slate-300"><span className="font-medium">Total Snow Gems Used:</span> {profile?.total_spent?.toFixed(2) || '0.00'}</p>
                  </div>
                </div>
              </div>

              {/* Player Account */}
              <div className="mt-8 pt-6 border-t border-slate-700" data-dash-focus={focusedElement === CLAIM_IDX ? 'true' : 'false'}>
                <h3 className="text-lg font-semibold text-white mb-3">Player Account</h3>
                {!playerAccount ? (
                  <div className="space-y-3">
                    <p className="text-slate-400 text-sm">
                      Sign in with your Dreamstreams or Vibez login to see your streaming account here. This also signs you in to the Player.
                    </p>
                    {!isDemo() && (
                      <Button
                        variant="gold"
                        size="lg"
                        onClick={() => onViewChange('account-signin')}
                        className={`tv-focusable transition-all duration-200 ${
                          focusedElement === CLAIM_IDX ? 'ring-4 ring-brand-gold scale-105' : ''
                        }`}
                      >
                        <Tv className="w-5 h-5 mr-2" />
                        Sign in with Dreamstreams / Vibez
                      </Button>
                    )}
                  </div>
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
                        onClick={() => setClaimOpen(true)}
                        className={`tv-focusable transition-all duration-200 ${
                          focusedElement === CLAIM_IDX ? 'ring-4 ring-brand-gold scale-105' : ''
                        }`}
                      >
                        <BellRing className="w-5 h-5 mr-2" />
                        Link email for renewal reminders
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* My Devices & Services */}
              <div className="mt-8 pt-6 border-t border-slate-700" data-dash-focus={focusedElement === EDIT_IDX ? 'true' : 'false'}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-white">My Devices & Services</h3>
                  <Button
                    onClick={() => setShowServicesEditor(true)}
                    className={`bg-blue-600 hover:bg-blue-700 transition-all duration-200 ${
                      focusedElement === EDIT_IDX ? 'ring-4 ring-white/60 scale-105' : ''
                    }`}
                    size="sm"
                  >
                    <Pencil className="w-4 h-4 mr-1" /> Edit
                  </Button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Devices</p>
                    {myDevices.length === 0 ? (
                      <p className="text-slate-400 text-sm">No devices added yet.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {myDevices.map(d => (
                          <Badge key={d.id} className="bg-slate-700 text-white border border-slate-600">{d.device_type}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Services</p>
                    {myServices.length === 0 ? (
                      <p className="text-slate-400 text-sm">No services tracked yet.</p>
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
                            <li key={s.id} className="text-sm text-slate-300 flex justify-between gap-2">
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


              <div className="mt-8 pt-6 border-t border-slate-700" data-dash-focus={focusedElement === DELETE_IDX ? 'true' : 'false'}>
                <h3 className="text-lg font-semibold text-white mb-2">Danger Zone</h3>
                <p className="text-slate-400 text-sm mb-4">
                  Permanently delete your Snow Media app account and all associated data.
                  
                </p>
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(true)}
                  className={`bg-red-600/20 hover:bg-red-600/40 border-red-500/60 text-white transition-all duration-200 ${
                    focusedElement === DELETE_IDX ? 'ring-4 ring-white/60 scale-105' : ''
                  }`}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete My Account
                </Button>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="credits" className="mt-0">
            <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6">
              <h2 className="text-2xl font-bold text-white mb-4 flex items-center">
                <Sparkles className="w-6 h-6 mr-2" />
                Snow Gems & AI Usage
              </h2>
              
              {transactions.length === 0 ? (
                <p className="text-slate-400 text-center py-8">No Snow Gem transactions yet</p>
              ) : (
                <div className="space-y-3">
                  {transactions.map((transaction) => (
                    <div 
                      key={transaction.id}
                      className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-600"
                    >
                      <div className="flex items-center space-x-3">
                        <div className={`w-3 h-3 rounded-full ${
                          transaction.transaction_type === 'purchase' ? 'bg-green-400' :
                          transaction.transaction_type === 'deduction' ? 'bg-red-400' :
                          'bg-blue-400'
                        }`} />
                        <div>
                          <p className="text-white font-medium">{transaction.description}</p>
                          <p className="text-slate-400 text-sm">
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
                          } text-white`}
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
                description: `Reminders will go to ${email || 'your email'}.`,
              });
            }
          }}
        />
      )}



      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>

        <AlertDialogContent className="bg-slate-900 border-red-500/50 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete your account?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-300">
              This permanently removes your Snow Media app account, profile, Snow Gems,
              chats, support tickets and media. This cannot be undone. Your separate
              Streaming player account is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="bg-slate-700 text-white border-slate-600 hover:bg-slate-600">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={handleDeleteAccount}
              className="bg-red-600 hover:bg-red-700 text-white"
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