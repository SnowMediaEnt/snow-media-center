import { memo, useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Tv, Film, ListVideo, Loader2, RefreshCw, Settings as SettingsIcon, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  loadCreds,
  clearCreds,
  authenticateRouted,
  buildPlayerAccount,
  savePlayerAccount,
  clearPlayerAccount,
  bumpXtreamRefresh,
  type XtreamCreds,
} from '@/lib/xtream';
import { useAuth } from '@/hooks/useAuth';
import { syncPlayerAccountToCloud } from '@/lib/playerAccountSync';
import { runWhenIdle } from '@/utils/idle';

import LiveSection from './livetv/LiveSection';
const MoviesSection = lazy(() => import('./livetv/MoviesSection'));
const SeriesSection = lazy(() => import('./livetv/SeriesSection'));
const CredentialsForm = lazy(() => import('./livetv/CredentialsForm'));
const AccountInfoScreen = lazy(() => import('./livetv/AccountInfoScreen'));


interface Props {
  onBack: () => void;
}

type SectionId = 'live' | 'movies' | 'series';
const SECTIONS: { id: SectionId; label: string; icon: typeof Tv }[] = [
  { id: 'live',   label: 'Live TV', icon: Tv },
  { id: 'movies', label: 'Movies',  icon: Film },
  { id: 'series', label: 'Series',  icon: ListVideo },
];

const Player = memo(({ onBack }: Props) => {
  const { toast } = useToast();
  const { user } = useAuth();

  const [creds, setCreds] = useState<XtreamCreds | null>(null);
  const [credsLoaded, setCredsLoaded] = useState(false);
  // When true, the user has explicitly opened the Account form even though
  // valid creds already exist (i.e. to change account).
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  // Read-only "Account info" view, shown from the header Account button.
  const [accountInfoOpen, setAccountInfoOpen] = useState(false);

  const [section, setSection] = useState<SectionId>('live');
  const [sectionIdx, setSectionIdx] = useState(0);
  const [pane, setPane] = useState<'header' | 'sections' | 'content'>('sections');
  const [headerIdx, setHeaderIdx] = useState(0);
  // Where to return when leaving the header via Down.
  const headerReturnPaneRef = useRef<'sections' | 'content'>('sections');


  // Load creds on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const c = await loadCreds();
      if (cancelled) return;
      setCreds(c);
      setCredsLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Background refresh: when Player opens with existing creds, re-call the
  // panel once (deferred to idle) so the local PlayerAccount picks up the
  // latest expDate/status. Also re-syncs to cloud if signed in.
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (!creds || refreshedRef.current) return;
    refreshedRef.current = true;
    const cancel = runWhenIdle(() => {
      (async () => {
        try {
          const res = await authenticateRouted(creds.username, creds.password);
          if (!res.ok || !res.server || !res.creds) return;
          const acc = buildPlayerAccount(res.server, res.creds, res.userInfo);
          await savePlayerAccount(acc);
          if (user?.id && user.email) {
            void syncPlayerAccountToCloud(user.id, user.email, acc);
          }
        } catch { /* swallow — background refresh is best-effort */ }
      })();
    }, 2500);
    return cancel;
  }, [creds, user?.id, user?.email]);

  const onExitLeft = useCallback(() => setPane('sections'), []);
  const onExitUp = useCallback(() => {
    headerReturnPaneRef.current = 'content';
    setPane('header');
  }, []);

  const signOut = useCallback(async () => {
    await clearCreds();
    await clearPlayerAccount();
    setCreds(null);
    setAccountFormOpen(false);
    setAccountInfoOpen(false);
    toast({ title: 'Signed out', description: 'Sign in again to use the Player.' });
  }, [toast]);

  const showCredsForm = !creds || accountFormOpen;
  const showAccountInfo = !!creds && accountInfoOpen && !accountFormOpen;


  // Keyboard for shell (header pane + sections pane; content pane is owned by child)
  const paneRef = useRef(pane);
  const sectionIdxRef = useRef(sectionIdx);
  const headerIdxRef = useRef(headerIdx);
  const showCredsFormRef = useRef(showCredsForm);
  useEffect(() => { paneRef.current = pane; }, [pane]);
  useEffect(() => { sectionIdxRef.current = sectionIdx; }, [sectionIdx]);
  useEffect(() => { headerIdxRef.current = headerIdx; }, [headerIdx]);
  useEffect(() => { showCredsFormRef.current = showCredsForm; }, [showCredsForm]);

  const HEADER_COUNT = 3; // [Back, Account, SignOut]

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // AccountInfoScreen owns the keyboard while open.
      if (accountInfoOpen && creds && !accountFormOpen) return;

      if (showCredsFormRef.current) {
        const target = e.target as HTMLElement;
        const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
        if ((e.key === 'Escape' || e.keyCode === 4) && !typing) {
          e.preventDefault();
          if (accountFormOpen && creds) setAccountFormOpen(false);
          else onBack();
        }
        return;
      }

      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;

      // --- Header pane owns the keyboard ---
      if (paneRef.current === 'header') {
        if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
          e.preventDefault(); e.stopPropagation();
          onBack();
          return;
        }
        const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
        if (!arrows.includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();

        if (e.key === 'ArrowLeft') {
          setHeaderIdx(i => (i - 1 + HEADER_COUNT) % HEADER_COUNT);
        } else if (e.key === 'ArrowRight') {
          setHeaderIdx(i => (i + 1) % HEADER_COUNT);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          // Return focus to the player area where the user came from.
          setPane(headerReturnPaneRef.current);
        } else if (e.key === 'Enter' || e.key === ' ') {
          const idx = headerIdxRef.current;
          if (idx === 0) onBack();
          else if (idx === 1) setAccountInfoOpen(true);
          else if (idx === 2) void signOut();
        }
        return;
      }


      // --- Sections pane: Up at idx 0 enters the header ---
      if (paneRef.current !== 'sections') return;

      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        onBack();
        return;
      }

      const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!arrows.includes(e.key)) return;
      e.preventDefault();

      if (e.key === 'ArrowDown') setSectionIdx(i => Math.min(SECTIONS.length - 1, i + 1));
      else if (e.key === 'ArrowUp') {
        if (sectionIdxRef.current === 0) {
          headerReturnPaneRef.current = 'sections';
          setPane('header');
        } else {
          setSectionIdx(i => Math.max(0, i - 1));
        }
      }
      else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
        setSection(SECTIONS[sectionIdxRef.current].id);
        setPane('content');
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onBack, accountFormOpen, accountInfoOpen, creds, signOut]);


  if (!credsLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center text-white">
        <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
      </div>
    );
  }

  // Sign-in screen — shown when no creds OR user opened account form
  if (showCredsForm) {
    return (
      <div className="min-h-screen text-white bg-black/70">
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
          <CredentialsForm
            initial={creds}
            onSaved={(c) => {
              setCreds(c);
              setAccountFormOpen(false);
            }}
            onCancel={creds ? () => setAccountFormOpen(false) : onBack}
          />
        </Suspense>
      </div>
    );
  }

  // Read-only Account info screen (from header "Account" button).
  if (showAccountInfo) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-white"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
        <AccountInfoScreen
          onBack={() => setAccountInfoOpen(false)}
          onSignOut={() => { void signOut(); }}
        />
      </Suspense>
    );
  }


  return (
    <div className="min-h-screen flex flex-col text-white bg-black/70">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="white"
            size="sm"
            onClick={onBack}
            data-focused={pane === 'header' && headerIdx === 0 ? 'true' : 'false'}
            className={`tv-focusable home-focus-surface transition-transform duration-150 ${
              pane === 'header' && headerIdx === 0
                ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_14px_rgba(245,200,80,0.45)]'
                : ''
            }`}
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <Tv className="w-7 h-7 text-brand-gold" />
            <h1 className="text-2xl font-quicksand font-bold text-white">Player</h1>
            {creds?.serverLabel && (
              <span className="ml-2 text-xs px-2 py-1 rounded-full bg-white/10 text-brand-ice font-nunito">
                {creds.serverLabel}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="gold"
            size="sm"
            onClick={() => setAccountInfoOpen(true)}
            data-focused={pane === 'header' && headerIdx === 1 ? 'true' : 'false'}
            className={`tv-focusable home-focus-surface transition-transform duration-150 ${
              pane === 'header' && headerIdx === 1
                ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_14px_rgba(245,200,80,0.45)]'
                : ''
            }`}
          >
            <SettingsIcon className="w-4 h-4 mr-2" />
            Account
          </Button>
          <Button
            variant="white"
            size="sm"
            onClick={() => { void signOut(); }}
            data-focused={pane === 'header' && headerIdx === 2 ? 'true' : 'false'}
            className={`tv-focusable home-focus-surface transition-transform duration-150 ${
              pane === 'header' && headerIdx === 2
                ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_14px_rgba(245,200,80,0.45)]'
                : ''
            }`}
          >
            <X className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </div>


      {/* Three-pane layout */}
      <div className="flex-1 min-h-0 flex">
        {/* Pane 1 — Sections */}
        <div
          onClick={() => { if (pane !== 'sections') setPane('sections'); }}
          className={`flex-shrink-0 border-r border-white/10 p-3 space-y-2 bg-black/50 transition-[width] duration-200 ease-out overflow-hidden ${pane === 'sections' ? 'w-44 bg-white/5' : 'w-12 cursor-pointer'}`}
        >
          {SECTIONS.map((s, i) => {
            const Icon = s.icon;
            const isFocused = pane === 'sections' && sectionIdx === i;
            const isActive = section === s.id;
            const collapsed = pane !== 'sections';
            return (
              <div
                key={s.id}
                data-focused={isFocused ? 'true' : 'false'}
                onClick={(e) => { if (collapsed) return; e.stopPropagation(); setSectionIdx(i); setSection(s.id); setPane('content'); }}
                className={`
                  flex items-center gap-3 ${collapsed ? 'px-1 py-2 justify-center' : 'px-3 py-3'} rounded-xl cursor-pointer transition-all duration-150
                  ${isFocused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-105 shadow-lg' : ''}
                  ${!isFocused && isActive ? 'bg-white/10' : ''}
                  ${!isFocused && !isActive ? 'hover:bg-white/5' : ''}
                `}
                title={collapsed ? s.label : undefined}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-brand-gold' : 'text-brand-ice'}`} />
                {!collapsed && <span className="font-quicksand font-semibold">{s.label}</span>}
              </div>
            );
          })}
        </div>

        {section === 'live' && (
          <LiveSection
            creds={creds!}
            isActive={pane === 'content'}
            onExitLeft={onExitLeft}
            onExitUp={onExitUp}
            onBack={onBack}
          />
        )}
        {section === 'movies' && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <MoviesSection
              creds={creds!}
              isActive={pane === 'content'}
              onExitLeft={onExitLeft}
              onExitUp={onExitUp}
            />
          </Suspense>
        )}
        {section === 'series' && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <SeriesSection
              creds={creds!}
              isActive={pane === 'content'}
              onExitLeft={onExitLeft}
              onExitUp={onExitUp}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
});

Player.displayName = 'Player';
export default Player;
