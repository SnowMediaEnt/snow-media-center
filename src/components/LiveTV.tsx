import { memo, useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Tv, Film, ListVideo, Loader2, Settings as SettingsIcon, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  loadCreds,
  clearCreds,
  authenticateRouted,
  buildPlayerAccount,
  savePlayerAccount,
  clearPlayerAccount,
  type XtreamCreds,
} from '@/lib/xtream';
import { useAuth } from '@/hooks/useAuth';
import { syncPlayerAccountToCloud } from '@/lib/playerAccountSync';
import { runWhenIdle } from '@/utils/idle';

import LiveSection from './livetv/LiveSection';
const MoviesSection = lazy(() => import('./livetv/MoviesSection'));
const SeriesSection = lazy(() => import('./livetv/SeriesSection'));
const CredentialsForm = lazy(() => import('./livetv/CredentialsForm'));

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

  const [section, setSection] = useState<SectionId>('live');
  const [sectionIdx, setSectionIdx] = useState(0);
  const [pane, setPane] = useState<'sections' | 'content'>('sections');

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

  const showCredsForm = !creds || accountFormOpen;

  // Keyboard for shell (only when on the sections pane and no form is up)
  const paneRef = useRef(pane);
  const sectionIdxRef = useRef(sectionIdx);
  const showCredsFormRef = useRef(showCredsForm);
  useEffect(() => { paneRef.current = pane; }, [pane]);
  useEffect(() => { sectionIdxRef.current = sectionIdx; }, [sectionIdx]);
  useEffect(() => { showCredsFormRef.current = showCredsForm; }, [showCredsForm]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
      if (paneRef.current !== 'sections') return;

      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;

      if (e.key === 'Escape' || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        onBack();
        return;
      }

      const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!arrows.includes(e.key)) return;
      e.preventDefault();

      if (e.key === 'ArrowDown') setSectionIdx(i => Math.min(SECTIONS.length - 1, i + 1));
      else if (e.key === 'ArrowUp') setSectionIdx(i => Math.max(0, i - 1));
      else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') {
        setSection(SECTIONS[sectionIdxRef.current].id);
        setPane('content');
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onBack, accountFormOpen, creds]);

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

  return (
    <div className="min-h-screen flex flex-col text-white bg-black/70">

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/30 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Button variant="white" size="sm" onClick={onBack} className="tv-focusable home-focus-surface">
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
          <Button variant="gold" size="sm" onClick={() => setAccountFormOpen(true)} className="tv-focusable home-focus-surface">
            <SettingsIcon className="w-4 h-4 mr-2" />
            Account
          </Button>
          <Button
            variant="white"
            size="sm"
            onClick={async () => {
              await clearCreds();
              await clearPlayerAccount();
              setCreds(null);
              setAccountFormOpen(false);
              toast({ title: 'Signed out', description: 'Sign in again to use the Player.' });
            }}
            className="tv-focusable home-focus-surface"
          >
            <X className="w-4 h-4 mr-2" /> Sign Out
          </Button>
        </div>
      </div>

      {/* Three-pane layout */}
      <div className="flex-1 min-h-0 flex">
        {/* Pane 1 — Sections */}
        <div className={`w-44 flex-shrink-0 border-r border-white/10 p-3 space-y-2 bg-black/50 ${pane === 'sections' ? 'bg-white/5' : ''}`}>
          {SECTIONS.map((s, i) => {
            const Icon = s.icon;
            const isFocused = pane === 'sections' && sectionIdx === i;
            const isActive = section === s.id;
            return (
              <div
                key={s.id}
                data-focused={isFocused ? 'true' : 'false'}
                onClick={() => { setSectionIdx(i); setSection(s.id); setPane('content'); }}
                className={`
                  flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all duration-150
                  ${isFocused ? 'bg-brand-gold/25 ring-2 ring-brand-gold scale-105 shadow-lg' : ''}
                  ${!isFocused && isActive ? 'bg-white/10' : ''}
                  ${!isFocused && !isActive ? 'hover:bg-white/5' : ''}
                `}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-brand-gold' : 'text-brand-ice'}`} />
                <span className="font-quicksand font-semibold">{s.label}</span>
              </div>
            );
          })}
        </div>

        {section === 'live' && (
          <LiveSection
            creds={creds!}
            isActive={pane === 'content'}
            onExitLeft={onExitLeft}
            onBack={onBack}
          />
        )}
        {section === 'movies' && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <MoviesSection
              creds={creds!}
              isActive={pane === 'content'}
              onExitLeft={onExitLeft}
            />
          </Suspense>
        )}
        {section === 'series' && (
          <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
            <SeriesSection
              creds={creds!}
              isActive={pane === 'content'}
              onExitLeft={onExitLeft}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
});

Player.displayName = 'Player';
export default Player;
