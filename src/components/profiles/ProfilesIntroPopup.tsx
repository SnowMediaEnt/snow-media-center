// One popup, once per box, that tells people profiles exist. The app no
// longer opens on "Who's watching?" for a box with just one profile — it opens
// straight to Home, and this waits its turn behind the start-up popups (What's
// New, the content bar offer, alerts and notices: it opens only when no other
// dialog is on screen), a few seconds of settling, and the viewer leaving the
// content bar (whose keys would still move and open tiles under it).
//
// "Set up profiles" goes to Settings → Profiles; "Maybe later" (or Back)
// closes it for good. Not shown on a Kids profile, or once a box has more
// than one profile (they already found it).
import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { useTranslation } from 'react-i18next';
import { Baby, ShieldCheck, UsersRound } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { INTENT_KEYS } from '@/lib/appActions';
import { trackEvent } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';
import { PROFILES_EVENT, activeProfile, loadProfiles, markProfilesIntroSeen, profilesIntroSeen } from '@/lib/profiles';
import { setPausableInterval } from '@/utils/pausableInterval';
import { claimBootPopup, releaseBootPopup } from '@/utils/bootPopupQueue';

const WELCOME_KEY = 'smc-welcome-shown-version';
const MIN_DELAY_MS = 4500;

// Keys, not text: the words are looked up when the popup is drawn.
const POINTS = [
  { icon: UsersRound, textKey: 'profiles.intro.pointEveryone' },
  { icon: Baby, textKey: 'profiles.intro.pointKids' },
  { icon: ShieldCheck, textKey: 'profiles.intro.pointSafety' },
];

const isBack = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.keyCode === 4 || e.keyCode === 27;
const isOk = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66;

const ProfilesIntroPopup = ({ onSetUp }: { onSetUp: () => void }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<0 | 1>(0); // 0 Set up profiles · 1 Maybe later
  const focusRef = useRef(focus); focusRef.current = focus;
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    if (isDemo() || profilesIntroSeen()) return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    const disarm = () => { stop?.(); stop = null; };
    // 'open' / 'done': stop asking. 'kids': stop too — a Kids profile never
    // gets it, and switching profile reloads the app (or says so with
    // PROFILES_EVENT, which asks again). 'wait': ask again in a second.
    const tryOpen = (): 'done' | 'kids' | 'wait' => {
      if (cancelled || profilesIntroSeen()) return 'done';
      if (loadProfiles().length > 1) { markProfilesIntroSeen(); return 'done'; }
      if (activeProfile().kidsLevel) return 'kids';
      if (Date.now() - mountedAt.current < MIN_DELAY_MS) return 'wait';
      try { if (!localStorage.getItem(WELCOME_KEY)) return 'wait'; } catch { return 'done'; }
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][data-state="open"], [role="dialog"][data-state="open"], [data-notice-layer]')) return 'wait';
      if (document.querySelector('[data-media-bar] [data-focused="true"]')) return 'wait';
      if (!claimBootPopup('profiles-intro')) return 'wait';
      setOpen(true);
      try { trackEvent('profiles_intro_shown', 'profiles'); } catch { void 0; }
      return 'done';
    };
    const arm = () => {
      if (stop || tryOpen() !== 'wait') return;
      // Pausable: no ticking in the background or while a stream plays.
      stop = setPausableInterval(() => { if (tryOpen() !== 'wait') disarm(); }, 1000);
    };
    arm();
    const onProfiles = () => { if (!cancelled) arm(); };
    window.addEventListener(PROFILES_EVENT, onProfiles);
    return () => { cancelled = true; disarm(); window.removeEventListener(PROFILES_EVENT, onProfiles); };
  }, []);

  // The one boot-popup slot (utils/bootPopupQueue), handed on when it closes.
  useEffect(() => () => releaseBootPopup('profiles-intro'), []);

  const close = useCallback((setUp: boolean) => {
    markProfilesIntroSeen();
    setOpen(false);
    releaseBootPopup('profiles-intro');
    try { trackEvent('profiles_intro_answer', 'profiles', { setUp }); } catch { void 0; }
    if (setUp) {
      try { sessionStorage.setItem(INTENT_KEYS.settings, 'profiles'); } catch { /* ignore */ }
      onSetUp();
    }
  }, [onSetUp]);

  const lastBack = useRef(0);
  useEffect(() => {
    if (!open) return;
    // A notice (broadcast alert, pre-event steps) that came up over this one
    // is on top: its OK and Back are its own.
    // Its Back counts as this press's, so the hardware event for the same
    // press (after the key has closed the notice) doesn't close this too.
    const noticeUp = () => !!document.querySelector('[data-notice-layer]');
    const back = () => {
      const now = Date.now();
      if (noticeUp()) { lastBack.current = now; return; }
      if (now - lastBack.current < 350) return;
      lastBack.current = now;
      (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = now;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (noticeUp()) { if (isBack(e)) lastBack.current = Date.now(); return; }
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
    <div className="fixed inset-0 z-[120] bg-black/85 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t('profiles.intro.dialogLabel')}>
      <Card className="w-full max-w-2xl bg-gradient-to-br from-blue-900 to-slate-900 border-blue-500/40 p-7 shadow-2xl text-white">
        <div className="flex items-center mb-4">
          <UsersRound className="w-7 h-7 text-brand-gold mr-3" />
          <h2 className="text-3xl font-bold">{t('profiles.intro.title')}</h2>
        </div>
        <ul className="space-y-3 mb-6">
          {POINTS.map(({ icon: Icon, textKey }) => (
            <li key={textKey} className="flex items-start">
              <Icon className="w-6 h-6 text-brand-gold mr-3 mt-0.5 shrink-0" />
              <span className="text-lg text-white/90">{t(textKey)}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-white/60 mb-5">
          {t('profiles.intro.hint')}
        </p>
        <div className="flex">
          <button type="button" data-focused={focus === 0 ? 'true' : 'false'} className={`${btn(0)} mr-3`} onClick={() => close(true)}>{t('profiles.intro.setUpBtn')}</button>
          <button type="button" data-focused={focus === 1 ? 'true' : 'false'} className={btn(1)} onClick={() => close(false)}>{t('profiles.intro.laterBtn')}</button>
        </div>
      </Card>
    </div>
  );
};

export default ProfilesIntroPopup;
