// One popup, once per box, that tells people profiles exist. The app no
// longer opens on "Who's watching?" for a box with just one profile — it opens
// straight to Home, and this waits its turn behind the start-up popups (What's
// New, the content bar offer, alerts: it opens only when no other dialog is
// on screen) and a few seconds of settling.
//
// "Set up profiles" goes to Settings → Profiles; "Maybe later" (or Back)
// closes it for good. Not shown on a Kids profile, or once a box has more
// than one profile (they already found it).
import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Baby, ShieldCheck, UsersRound } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { INTENT_KEYS } from '@/lib/appActions';
import { trackEvent } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';
import { activeProfile, loadProfiles, markProfilesIntroSeen, profilesIntroSeen } from '@/lib/profiles';

const WELCOME_KEY = 'smc-welcome-shown-version';
const MIN_DELAY_MS = 4500;

const POINTS = [
  { icon: UsersRound, text: 'Everyone in the house gets their own setup — their own Continue Watching, My List, favourites and home screen.' },
  { icon: Baby, text: 'Kids profiles show only kids movies, shows and channels for the age you pick, plus a kids games section (coming soon).' },
  { icon: ShieldCheck, text: 'Safety everywhere: movies, shows, Live TV channels and the AI all stay age-appropriate. Add a PIN to any profile if you like.' },
];

const isBack = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.keyCode === 4 || e.keyCode === 27;
const isOk = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66;

const ProfilesIntroPopup = ({ onSetUp }: { onSetUp: () => void }) => {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<0 | 1>(0); // 0 Set up profiles · 1 Maybe later
  const focusRef = useRef(focus); focusRef.current = focus;
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    if (isDemo() || profilesIntroSeen()) return;
    let cancelled = false;
    const tryOpen = (): boolean => {
      if (cancelled || profilesIntroSeen()) return true;
      if (loadProfiles().length > 1) { markProfilesIntroSeen(); return true; }
      if (activeProfile().kidsLevel) return false;
      if (Date.now() - mountedAt.current < MIN_DELAY_MS) return false;
      try { if (!localStorage.getItem(WELCOME_KEY)) return false; } catch { return true; }
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][data-state="open"], [role="dialog"][data-state="open"]')) return false;
      setOpen(true);
      try { trackEvent('profiles_intro_shown', 'profiles'); } catch { void 0; }
      return true;
    };
    if (tryOpen()) return;
    const id = window.setInterval(() => { if (tryOpen()) window.clearInterval(id); }, 1000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  const close = useCallback((setUp: boolean) => {
    markProfilesIntroSeen();
    setOpen(false);
    try { trackEvent('profiles_intro_answer', 'profiles', { setUp }); } catch { void 0; }
    if (setUp) {
      try { sessionStorage.setItem(INTENT_KEYS.settings, 'profiles'); } catch { /* ignore */ }
      onSetUp();
    }
  }, [onSetUp]);

  const lastBack = useRef(0);
  useEffect(() => {
    if (!open) return;
    const back = () => {
      const now = Date.now();
      if (now - lastBack.current < 350) return;
      lastBack.current = now;
      (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = now;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (isBack(e)) { e.preventDefault(); back(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault(); setFocus((f) => (f === 0 ? 1 : 0)); return;
      }
      if (isOk(e)) { e.preventDefault(); close(focusRef.current === 0); }
    };
    window.addEventListener('keydown', onKey, true);
    let handle: { remove: () => void } | null = null;
    let cancelled = false;
    void CapApp.addListener('backButton', back).then((h) => { if (cancelled) h.remove(); else handle = h; }).catch(() => { /* web */ });
    return () => { window.removeEventListener('keydown', onKey, true); cancelled = true; handle?.remove(); };
  }, [open, close]);

  if (!open) return null;
  const btn = (i: 0 | 1) =>
    `tv-ring rounded-xl px-6 py-3 text-lg font-semibold ${focus === i ? 'bg-white text-black' : 'bg-white/10 text-white'}`;
  return (
    <div className="fixed inset-0 z-[120] bg-black/85 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Profiles">
      <Card className="w-full max-w-2xl bg-gradient-to-br from-blue-900 to-slate-900 border-blue-500/40 p-7 shadow-2xl text-white">
        <div className="flex items-center mb-4">
          <UsersRound className="w-7 h-7 text-brand-gold mr-3" />
          <h2 className="text-3xl font-bold">New: profiles for everyone</h2>
        </div>
        <ul className="space-y-3 mb-6">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start">
              <Icon className="w-6 h-6 text-brand-gold mr-3 mt-0.5 shrink-0" />
              <span className="text-lg text-white/90">{text}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-white/60 mb-5">
          Set them up any time under Settings → Profiles, or with the profile button at the top of Home.
        </p>
        <div className="flex">
          <button type="button" data-focused={focus === 0 ? 'true' : 'false'} className={`${btn(0)} mr-3`} onClick={() => close(true)}>Set up profiles</button>
          <button type="button" data-focused={focus === 1 ? 'true' : 'false'} className={btn(1)} onClick={() => close(false)}>Maybe later</button>
        </div>
      </Card>
    </div>
  );
};

export default ProfilesIntroPopup;
