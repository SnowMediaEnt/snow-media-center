// "Who's watching?" and everything behind it: pick a profile, add and edit
// profiles (name, colour, Kids, PIN), the PIN pad, and "Forgot PIN?".
// See lib/profiles.ts for where profiles live and what a PIN is.
//
// One full-screen overlay (aria-modal, so the app's own Back handling stands
// aside) with its own D-pad focus: every control carries data-pf, arrows move
// to the nearest control in that direction, OK presses it, the number keys on
// the remote type into the PIN pad, Back steps back a screen.
//
// Modes
//   gate     at start: pick someone to continue (Back does nothing, unless
//            the box is holding a Kids profile's limits: Back keeps them)
//   pick     switching from Settings or the Kids home button (Back closes)
//   manage   Settings → Profiles: straight to adding and editing (Back to pick)
//   grownup  a Kids profile opening Settings: any grown-up's PIN, when a
//            grown-up profile has one (the caller only opens it then)
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { useTranslation } from 'react-i18next';
import { Check, Delete, Lock, Pencil, Plus, UserRound } from 'lucide-react';
import { KIDS_LEVELS, type KidsLevel } from '@/lib/kidsFilter';
import {
  AVATARS, FORGOT_AFTER, MAX_PROFILES, PROFILES_EVENT, activeProfile, avatarColors, boxProfilesToBring, bringBoxProfiles,
  checkGrownUpPin, checkPin, createProfile, deleteProfile, getProfile, grownUpPadLockedFor, grownUpsWithPin,
  kidsHoldNeedsGrownUp, lastPickedId, loadProfiles, pickProfile, pinFailures, pinLockedFor, pinsAvailable, profileName, pullProfiles,
  requestPinReset, setPin, updateProfile, verifyPinReset, type Profile,
} from '@/lib/profiles';
import { MAIN_PROFILE } from '@/lib/viewer';

/** A line for the screen: a key of ours (and its numbers), translated when drawn so it
 *  follows the language. Never the translated text itself. */
type Msg = { key: string; params?: Record<string, unknown> };

/** Kids-profile choices: the words for each are looked up when drawn. */
const LEVEL_TEXT: Record<'off' | KidsLevel, { label: string; hint: string }> = {
  off: { label: 'profiles.edit.levelOff', hint: 'profiles.edit.levelOffHint' },
  little: { label: 'profiles.edit.levelLittle', hint: 'profiles.edit.levelLittleHint' },
  kids: { label: 'profiles.edit.levelKids', hint: 'profiles.edit.levelKidsHint' },
  teen: { label: 'profiles.edit.levelTeen', hint: 'profiles.edit.levelTeenHint' },
};

export type ProfileScreensMode = 'gate' | 'pick' | 'manage' | 'grownup';

type After = 'pick' | 'edit' | 'manage' | 'grownup';
type Screen =
  | { kind: 'pick' }
  | { kind: 'manage' }
  | { kind: 'edit'; id: string | null }
  | { kind: 'pin'; purpose: 'unlock'; profileId: string; then: After }
  | { kind: 'pin'; purpose: 'grownup'; then: After; forId?: string }
  | { kind: 'pin'; purpose: 'new'; profileId: string }
  | { kind: 'pin'; purpose: 'confirm'; profileId: string; first: string }
  | { kind: 'forgot'; profileId: string; then: After };

interface Props {
  mode: ProfileScreensMode;
  onClose: () => void;
  /** grownup: the PIN was right (or nobody has one). */
  onGrownUpOk?: () => void;
  /** The grown-up pad for a Kids profile kept from a signed-out account:
   *  signing in to it again is the way on when its PIN is forgotten. */
  onSignIn?: () => void;
}

const BACK_KEYS = new Set(['Escape', 'Backspace', 'GoBack', 'BrowserBack']);
const isBack = (e: KeyboardEvent) => BACK_KEYS.has(e.key) || e.keyCode === 4 || e.keyCode === 27;
/** Back while typing: Backspace deletes a letter there, it doesn't leave. */
const isTypingBack = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack' || e.keyCode === 4 || e.keyCode === 27;
// The remote's OK (DPAD_CENTER) reaches the page as Enter, keyCode 13.
const isEnter = (e: KeyboardEvent) => e.key === 'Enter' || e.keyCode === 13 || e.keyCode === 23;
const isOk = (e: KeyboardEvent) => isEnter(e) || e.key === ' ';
// DOM key codes (48–57 and the number pad), never Android ones: the page only
// ever sees DOM codes, and reading 7–16 as Android's KEYCODE_0..9 turned OK
// (13) into a 6.
const digitOf = (e: KeyboardEvent): string | null => {
  if (/^[0-9]$/.test(e.key)) return e.key;
  if (e.key === 'Unidentified' || !e.key) {
    if (e.keyCode >= 48 && e.keyCode <= 57) return String(e.keyCode - 48);
    if (e.keyCode >= 96 && e.keyCode <= 105) return String(e.keyCode - 96);
  }
  return null;
};

/** The nearest [data-pf] from `from` in a direction, by screen position. */
function nearest(root: HTMLElement, fromId: string, dir: 'up' | 'down' | 'left' | 'right'): string | null {
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-pf]')).filter((el) => !el.hasAttribute('data-pf-disabled'));
  const from = els.find((el) => el.dataset.pf === fromId);
  if (!from) return els[0]?.dataset.pf ?? null;
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: { id: string; score: number } | null = null;
  for (const el of els) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - ax, dy = by - ay;
    const ok = dir === 'up' ? dy < -4 : dir === 'down' ? dy > 4 : dir === 'left' ? dx < -4 : dx > 4;
    if (!ok) continue;
    const main = dir === 'up' || dir === 'down' ? Math.abs(dy) : Math.abs(dx);
    const cross = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
    const score = main + cross * 2;
    if (!best || score < best.score) best = { id: el.dataset.pf!, score };
  }
  return best?.id ?? null;
}

// ── pieces ─────────────────────────────────────────────────────────────────

const Avatar = memo(({ p, size = 112, focused = false }: { p: Pick<Profile, 'id' | 'name' | 'avatar' | 'kidsLevel' | 'pinHash'>; size?: number; focused?: boolean }) => {
  const { t } = useTranslation();
  const c = avatarColors(p.avatar);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        className="w-full h-full rounded-2xl flex items-center justify-center font-bold text-white select-none"
        style={{ backgroundColor: c.bg, fontSize: size * 0.45, boxShadow: focused ? `0 0 0 4px ${c.ring}, 0 0 24px ${c.ring}` : 'none' }}
      >
        {(profileName(p).trim()[0] || '?').toUpperCase()}
      </div>
      {p.pinHash && (
        <div className="absolute -bottom-2 -right-2 rounded-full bg-black/80 p-1.5 border border-white/30">
          <Lock className="w-4 h-4 text-white" />
        </div>
      )}
      {p.kidsLevel && (
        <div className="absolute -top-2 -left-2 rounded-full bg-brand-gold px-2 py-0.5 text-xs font-bold text-black">{t('profiles.kidsChip')}</div>
      )}
    </div>
  );
});
Avatar.displayName = 'ProfileAvatar';

interface FocusProps { focus: string; setFocus: (id: string) => void }

const Btn = ({ id, focus, setFocus, onPress, children, className = '', disabled = false }: FocusProps & { id: string; onPress: () => void; children: React.ReactNode; className?: string; disabled?: boolean }) => (
  <button
    type="button"
    data-pf={id}
    {...(disabled ? { 'data-pf-disabled': '' } : {})}
    data-focused={focus === id ? 'true' : 'false'}
    onClick={() => { if (!disabled) { setFocus(id); onPress(); } }}
    className={`tv-ring rounded-xl px-5 py-3 text-lg font-semibold transition-colors ${disabled ? 'opacity-40' : ''} ${focus === id ? 'bg-white text-black' : 'bg-white/10 text-white'} ${className}`}
  >
    {children}
  </button>
);

// ── the PIN pad ────────────────────────────────────────────────────────────

const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];

interface PadProps extends FocusProps {
  length: number;
  value: string;
  onDigit: (d: string) => void;
  onDelete: () => void;
  onSubmit: () => void;
}
const PinPad = ({ length, value, onDigit, onDelete, onSubmit, focus, setFocus }: PadProps) => {
  const { t } = useTranslation();
  return (
  <div className="flex flex-col items-center">
    <div className="flex mb-6" aria-label={t('profiles.pad.digits', { filled: value.length, length })}>
      {Array.from({ length }, (_, i) => (
        <div key={i} className={`w-5 h-5 rounded-full border-2 border-white mx-2 ${i < value.length ? 'bg-white' : ''}`} />
      ))}
    </div>
    <div className="grid grid-cols-3" style={{ width: 300 }}>
      {PAD.map((k) => (
        <div key={k} className="p-1.5">
          <button
            type="button"
            data-pf={`pad-${k}`}
            data-focused={focus === `pad-${k}` ? 'true' : 'false'}
            onClick={() => { setFocus(`pad-${k}`); if (k === 'del') onDelete(); else if (k === 'ok') onSubmit(); else onDigit(k); }}
            className={`tv-ring w-full h-16 rounded-xl text-2xl font-bold flex items-center justify-center ${focus === `pad-${k}` ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
            aria-label={k === 'del' ? t('common.delete') : k === 'ok' ? t('profiles.pad.done') : k}
          >
            {k === 'del' ? <Delete className="w-7 h-7" /> : k === 'ok' ? <Check className="w-7 h-7" /> : k}
          </button>
        </div>
      ))}
    </div>
  </div>
  );
};

// ── the overlay ────────────────────────────────────────────────────────────

const ProfileScreens = ({ mode, onClose, onGrownUpOk, onSignIn }: Props) => {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [stack, setStack] = useState<Screen[]>(() => [mode === 'grownup' ? { kind: 'pin', purpose: 'grownup', then: 'grownup' } : { kind: 'pick' }]);
  const screen = stack[stack.length - 1];
  const [focus, setFocus] = useState<string>(() => (mode === 'grownup' ? 'pad-1' : `p-${lastPickedId()}`));
  const [digits, setDigitsState] = useState('');
  const digitsRef = useRef('');
  const setDigits = useCallback((next: string | ((d: string) => string)) => {
    const v = typeof next === 'function' ? next(digitsRef.current) : next;
    digitsRef.current = v;
    setDigitsState(v);
  }, []);
  const [message, setMessage] = useState<Msg | null>(null);
  // Profiles whose PIN was given while this is open: not asked twice.
  const unlocked = useRef(new Set<string>());
  // A grown-up's PIN was given while this is open (the grown-up pad, or a
  // grown-up profile's own): not asked for again.
  const grownUpOk = useRef(false);
  const current = useMemo(() => activeProfile(), [profiles]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = () => setProfiles(loadProfiles());
    window.addEventListener(PROFILES_EVENT, on);
    // The account's list: a PIN support cleared, a profile added on another box.
    void pullProfiles();
    return () => window.removeEventListener(PROFILES_EVENT, on);
  }, []);

  const push = useCallback((s: Screen, firstFocus: string) => {
    setStack((st) => [...st, s]); setDigits(''); setMessage(null); setFocus(firstFocus);
  }, [setDigits]);
  const pop = useCallback((firstFocus?: string) => {
    setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)); setDigits(''); setMessage(null);
    if (firstFocus) setFocus(firstFocus);
  }, [setDigits]);
  const replace = useCallback((s: Screen, firstFocus: string) => {
    setStack((st) => [...st.slice(0, -1), s]); setDigits(''); setMessage(null); setFocus(firstFocus);
  }, [setDigits]);

  // The editor's working copy: set when the editor opens, kept while a PIN
  // is set from it.
  const [draft, setDraft] = useState<{ name: string; avatar: string; kidsLevel: KidsLevel | null }>({ name: '', avatar: 'blue', kidsLevel: null });
  const loadDraft = useCallback((id: string | null) => {
    const p = id ? getProfile(id) : null;
    const used = new Set(loadProfiles().map((x) => x.avatar));
    setDraft(p ? { name: profileName(p), avatar: p.avatar, kidsLevel: p.kidsLevel }
      : { name: '', avatar: AVATARS.find((a) => !used.has(a.id))?.id ?? 'blue', kidsLevel: null });
  }, []);

  // ── what happens after a PIN (or none) ──
  const finish = useCallback((then: After, profileId?: string) => {
    if (then === 'grownup') { onGrownUpOk?.(); return; }
    if (then === 'manage') { replace({ kind: 'manage' }, `m-${profiles[0]?.id ?? MAIN_PROFILE}`); return; }
    if (then === 'edit' && profileId) { loadDraft(profileId); replace({ kind: 'edit', id: profileId }, 'name'); return; }
    if (then === 'pick' && profileId) {
      if (pickProfile(profileId) === 'reload') {
        try { window.location.reload(); } catch { onClose(); }
      } else onClose();
    }
  }, [loadDraft, onClose, onGrownUpOk, profiles, replace]);

  const choose = useCallback((p: Profile) => {
    if (p.pinHash && !unlocked.current.has(p.id)) push({ kind: 'pin', purpose: 'unlock', profileId: p.id, then: 'pick' }, 'pad-1');
    // Out of a Kids profile kept from an account that signed out: one of its
    // grown-ups says so.
    else if (!p.kidsLevel && !grownUpOk.current && kidsHoldNeedsGrownUp()) push({ kind: 'pin', purpose: 'grownup', then: 'pick', forId: p.id }, 'pad-1');
    else finish('pick', p.id);
  }, [finish, push]);

  // Changing profiles is a grown-up's job from a Kids profile, and at the
  // start-up gate of a house that has one (whoever is picking may be the kid).
  const needGrownUp = useCallback(() => {
    if (grownUpOk.current || grownUpsWithPin().length === 0) return false;
    return !!current.kidsLevel || (mode === 'gate' && profiles.some((p) => !!p.kidsLevel));
  }, [current.kidsLevel, mode, profiles]);

  const openManage = useCallback(() => {
    if (needGrownUp()) push({ kind: 'pin', purpose: 'grownup', then: 'manage' }, 'pad-1');
    else push({ kind: 'manage' }, `m-${profiles[0]?.id ?? MAIN_PROFILE}`);
  }, [needGrownUp, profiles, push]);

  const openEdit = useCallback((p: Profile | null) => {
    if (p?.pinHash && !unlocked.current.has(p.id)) push({ kind: 'pin', purpose: 'unlock', profileId: p.id, then: 'edit' }, 'pad-1');
    else { loadDraft(p?.id ?? null); push({ kind: 'edit', id: p?.id ?? null }, 'name'); }
  }, [loadDraft, push]);

  // Settings → Profiles opens straight onto Manage (the same way the button does).
  const openedManage = useRef(false);
  useEffect(() => {
    if (mode !== 'manage' || openedManage.current) return;
    openedManage.current = true;
    openManage();
  }, [mode, openManage]);

  // ── PIN entry ──
  const submitPin = useCallback((value: string) => {
    if (screen.kind !== 'pin') return;
    if (screen.purpose === 'unlock') {
      const p = getProfile(screen.profileId);
      if (!p) { pop(); return; }
      const wait = pinLockedFor(p.id);
      if (wait > 0) { setDigits(''); setMessage({ key: 'profiles.pin.waitTooMany', params: { count: Math.ceil(wait / 1000) } }); return; }
      if (checkPin(p, value)) {
        unlocked.current.add(p.id);
        if (!p.kidsLevel) grownUpOk.current = true;
        finish(screen.then, p.id);
        return;
      }
      setDigits('');
      const left = pinLockedFor(p.id);
      setMessage(left > 0 ? { key: 'profiles.pin.wrongWait', params: { count: Math.ceil(left / 1000) } } : { key: 'profiles.pin.wrong' });
      return;
    }
    if (screen.purpose === 'grownup') {
      const wait = grownUpPadLockedFor();
      if (wait > 0) { setDigits(''); setMessage({ key: 'profiles.pin.waitTooMany', params: { count: Math.ceil(wait / 1000) } }); return; }
      if (checkGrownUpPin(value)) { grownUpOk.current = true; finish(screen.then, screen.forId); return; }
      setDigits('');
      const left = grownUpPadLockedFor();
      setMessage(left > 0 ? { key: 'profiles.pin.notGrownUpWait', params: { count: Math.ceil(left / 1000) } } : { key: 'profiles.pin.notGrownUp' });
      return;
    }
    if (screen.purpose === 'new') {
      replace({ kind: 'pin', purpose: 'confirm', profileId: screen.profileId, first: value }, 'pad-1');
      return;
    }
    if (screen.purpose === 'confirm') {
      if (value !== screen.first) {
        replace({ kind: 'pin', purpose: 'new', profileId: screen.profileId }, 'pad-1');
        setMessage({ key: 'profiles.pin.mismatch' });
        return;
      }
      setPin(screen.profileId, value);
      unlocked.current.add(screen.profileId);
      pop('pin');
    }
  }, [finish, pop, replace, screen, setDigits]);

  const typeDigit = useCallback((d: string) => {
    if (screen.kind !== 'pin' && screen.kind !== 'forgot') return;
    const len = screen.kind === 'forgot' ? 6 : 4;
    const cur = digitsRef.current;
    if (cur.length >= len) return;
    const next = cur + d;
    setDigits(next);
    // The last digit submits (a code is checked by the effect below).
    if (next.length === len && screen.kind === 'pin') window.setTimeout(() => submitPin(next), 120);
  }, [screen, setDigits, submitPin]);

  // ── Forgot PIN ──
  const [forgot, setForgot] = useState<{ state: 'sending' | 'sent' | 'failed'; msg: Msg } | null>(null);
  const forgotFor = screen.kind === 'forgot' ? screen.profileId : null;
  useEffect(() => {
    if (!forgotFor) { setForgot(null); return; }
    let alive = true;
    setForgot({ state: 'sending', msg: { key: 'profiles.forgot.sending' } });
    void requestPinReset(forgotFor).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        setForgot({
          state: 'failed',
          msg: { key: r.reason === 'too_many' ? 'profiles.forgot.tooManyRequests'
            : r.reason === 'signed_out' ? 'profiles.forgot.signedOut'
              : r.reason === 'no_pin' ? 'profiles.forgot.noPin'
                : 'profiles.forgot.unreachable' },
        });
        return;
      }
      const sent = !!(r.emailed && r.email);
      const key = sent
        ? (r.ticket ? 'profiles.forgot.emailedSupport' : 'profiles.forgot.emailed')
        : (r.ticket ? 'profiles.forgot.notEmailedSupport' : 'profiles.forgot.notEmailed');
      setForgot({ state: r.emailed ? 'sent' : 'failed', msg: { key, params: { email: r.email } } });
    });
    return () => { alive = false; };
  }, [forgotFor]);

  const submitCode = useCallback(async () => {
    if (screen.kind !== 'forgot' || digits.length !== 6) return;
    setMessage({ key: 'profiles.pin.checking' });
    const r = await verifyPinReset(screen.profileId, digits);
    if (r.ok) { unlocked.current.add(screen.profileId); finish(screen.then, screen.profileId); return; }
    setDigits('');
    setMessage(r.reason === 'wrong_code'
      ? (typeof r.left === 'number' ? { key: 'profiles.forgot.wrongCodeLeft', params: { count: r.left } } : { key: 'profiles.forgot.wrongCode' })
      : r.reason === 'expired' ? { key: 'profiles.forgot.expired' }
        : r.reason === 'too_many' ? { key: 'profiles.forgot.tooManyCodes' }
          : { key: 'profiles.forgot.unreachableShort' });
  }, [digits, finish, screen, setDigits]);

  // ── the editor's working copy ──
  const editing = screen.kind === 'edit' ? screen : null;

  const saveEdit = useCallback(() => {
    if (!editing) return;
    const name = draft.name.trim();
    if (!name) { setMessage({ key: 'profiles.edit.giveName' }); setFocus('name'); return; }
    if (editing.id) updateProfile(editing.id, { name, avatar: draft.avatar, kidsLevel: editing.id === MAIN_PROFILE ? null : draft.kidsLevel });
    else if (!createProfile({ name, avatar: draft.avatar, kidsLevel: draft.kidsLevel })) { setMessage({ key: 'profiles.edit.maxProfiles', params: { max: MAX_PROFILES } }); return; }
    pop(`m-${editing.id ?? MAIN_PROFILE}`);
  }, [draft, editing, pop]);

  // ── keys ──
  const handlersRef = useRef<{ back: () => void; ok: () => void }>({ back: () => {}, ok: () => {} });
  handlersRef.current.back = () => {
    if (stack.length > 1) { pop(); return; }
    // The gate holding a Kids profile's limits can be left with them kept:
    // otherwise a forgotten grown-up PIN would leave no way on.
    if (mode !== 'gate' || kidsHoldNeedsGrownUp()) onClose();
  };
  handlersRef.current.ok = () => {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-pf="${focus}"]`);
    if (!el) return;
    if (el instanceof HTMLInputElement) { el.focus(); return; }
    el.click();
  };

  const lastBackRef = useRef(0);
  const leftInputAtRef = useRef(0);
  const doBack = useCallback(() => {
    const now = Date.now();
    if (now - lastBackRef.current < 350) return; // the key and the hardware event are one press
    lastBackRef.current = now;
    (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = now;
    handlersRef.current.back();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement;
      if (typing) {
        // The name box: the TV keyboard has it; Up/Down, OK (Enter) and Back
        // leave it. Backspace, space and letters are typing.
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || isEnter(e) || isTypingBack(e)) {
          e.preventDefault(); e.stopImmediatePropagation();
          leftInputAtRef.current = Date.now();
          (document.activeElement as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            const next = rootRef.current && nearest(rootRef.current, focus, e.key === 'ArrowUp' ? 'up' : 'down');
            if (next) setFocus(next);
          }
        } else e.stopImmediatePropagation();
        return;
      }
      e.stopImmediatePropagation();
      if (isBack(e)) { e.preventDefault(); doBack(); return; }
      if (isOk(e)) {
        e.preventDefault();
        // Amazon's keyboard sends one more Enter as it closes: that must not
        // press the name box again and reopen the keyboard.
        if (Date.now() - leftInputAtRef.current < 700) return;
        handlersRef.current.ok();
        return;
      }
      const d = digitOf(e);
      if (d != null) { e.preventDefault(); typeDigit(d); return; }
      const dir = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : null;
      if (dir) {
        e.preventDefault();
        const next = rootRef.current && nearest(rootRef.current, focus, dir);
        if (next) setFocus(next);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [doBack, focus, typeDigit]);

  // Hardware Back that never reaches the WebView as a key.
  useEffect(() => {
    let handle: { remove: () => void } | null = null;
    let cancelled = false;
    void CapApp.addListener('backButton', () => doBack()).then((h) => { if (cancelled) h.remove(); else handle = h; }).catch(() => { /* web */ });
    return () => { cancelled = true; handle?.remove(); };
  }, [doBack]);

  // Keep the focused control on screen; a focus that no longer exists (a
  // screen changed under it) goes to the first control.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-pf="${focus}"]`);
    if (!el) {
      const first = root.querySelector<HTMLElement>('[data-pf]');
      if (first?.dataset.pf) setFocus(first.dataset.pf);
      return;
    }
    try { el.scrollIntoView({ block: 'nearest' }); } catch { /* old WebView */ }
  }, [focus, stack, profiles]);

  const fp = { focus, setFocus };

  // ── screens ──
  let body: React.ReactNode = null;
  let title = '';
  let subtitle: string | null = null;
  // The subtitle is a warning (a wrong PIN): above the pad, where a 540-line
  // screen still shows it.
  let alert = false;
  // Most boxes are 540 or 720 lines tall: no room there for a picture over the
  // PIN pad, nor for buttons under it — they go beside the pad.
  const roomy = window.innerHeight >= 800;

  if (screen.kind === 'pick' || screen.kind === 'manage') {
    const managing = screen.kind === 'manage';
    const cancelable = mode === 'pick' || mode === 'manage' || kidsHoldNeedsGrownUp();
    title = managing ? t('profiles.manage.title') : t('profiles.pick.title');
    const toBring = managing ? boxProfilesToBring() : [];
    // Just the main profile: say what adding one is for.
    subtitle = managing ? t('profiles.manage.subtitle')
      : profiles.length === 1
        ? t('profiles.pick.introSingle')
        : null;
    body = (
      <>
        <div className="flex flex-wrap justify-center">
          {profiles.map((p) => {
            const id = `${managing ? 'm' : 'p'}-${p.id}`;
            return (
              <button
                key={p.id}
                type="button"
                data-pf={id}
                data-focused={focus === id ? 'true' : 'false'}
                onClick={() => { setFocus(id); if (managing) openEdit(p); else choose(p); }}
                className="flex flex-col items-center m-4 rounded-2xl p-2 outline-none"
              >
                <div className="relative">
                  <Avatar p={p} focused={focus === id} />
                  {managing && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40">
                      <Pencil className="w-9 h-9 text-white" />
                    </div>
                  )}
                </div>
                <div className={`mt-3 text-xl ${focus === id ? 'text-white font-bold' : 'text-white/70'}`}>{profileName(p)}</div>
              </button>
            );
          })}
          {profiles.length < MAX_PROFILES && (
            <button
              type="button"
              data-pf="add"
              data-focused={focus === 'add' ? 'true' : 'false'}
              onClick={() => { setFocus('add'); if (!managing && needGrownUp()) openManage(); else openEdit(null); }}
              className="flex flex-col items-center m-4 rounded-2xl p-2 outline-none"
            >
              <div
                className="rounded-2xl flex items-center justify-center border-2 border-dashed border-white/50"
                style={{ width: 112, height: 112, boxShadow: focus === 'add' ? '0 0 0 4px #fff' : 'none' }}
              >
                <Plus className="w-12 h-12 text-white/80" />
              </div>
              <div className={`mt-3 text-xl ${focus === 'add' ? 'text-white font-bold' : 'text-white/70'}`}>{t('profiles.manage.addProfile')}</div>
            </button>
          )}
        </div>
        <div className="flex flex-wrap justify-center mt-8">
          {managing
            ? <Btn id="done" {...fp} onPress={() => pop(`p-${current.id}`)}>{t('profiles.manage.doneBtn')}</Btn>
            : <Btn id="manage" {...fp} onPress={openManage}><span className="inline-flex items-center"><Pencil className="w-5 h-5 mr-2" />{t('profiles.manage.manageBtn')}</span></Btn>}
          {/* Made on this box before signing in: the account's list doesn't have them. */}
          {toBring.length > 0 && profiles.length < MAX_PROFILES && (
            <Btn id="bring" {...fp} className="ml-4" onPress={() => { const first = toBring[0].id; if (bringBoxProfiles() > 0) setFocus(`m-${first}`); }}>
              {t('profiles.manage.bringBtn', { names: toBring.map((p) => profileName(p)).join(', ') })}
            </Btn>
          )}
          {!managing && cancelable && <Btn id="cancel" {...fp} className="ml-4" onPress={onClose}>{t('common.cancel')}</Btn>}
        </div>
      </>
    );
  } else if (screen.kind === 'edit') {
    const isNew = !screen.id;
    const p = screen.id ? getProfile(screen.id) : null;
    const isMain = screen.id === MAIN_PROFILE;
    title = isNew ? t('profiles.edit.addTitle') : p?.name ? t('profiles.edit.editTitle', { name: profileName(p) }) : t('profiles.edit.editTitleUnnamed');
    body = (
      <div className="w-full max-w-2xl mx-auto">
        <div className="flex items-center mb-6">
          <Avatar p={{ id: p?.id ?? '', name: draft.name || '?', avatar: draft.avatar, kidsLevel: draft.kidsLevel, pinHash: p?.pinHash ?? null }} size={96} />
          <div className="ml-6 flex-1">
            <label className="block text-white/70 text-sm mb-1" htmlFor="profile-name">{t('profiles.edit.nameLabel')}</label>
            <input
              id="profile-name"
              data-pf="name"
              data-focused={focus === 'name' ? 'true' : 'false'}
              value={draft.name}
              maxLength={24}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onFocus={() => setFocus('name')}
              placeholder={t('profiles.edit.namePlaceholder')}
              className={`tv-ring w-full rounded-xl bg-white/10 px-4 py-3 text-2xl text-white outline-none ${focus === 'name' ? 'bg-white/20' : ''}`}
            />
          </div>
        </div>

        <div className="text-white/70 text-sm mb-2">{t('profiles.edit.colorLabel')}</div>
        <div className="flex flex-wrap mb-6">
          {AVATARS.map((a) => {
            const id = `c-${a.id}`;
            const picked = draft.avatar === a.id;
            const focused = focus === id;
            // The picked color: a white ring. The one the remote is on: a
            // bigger ring in its own light shade, and a little larger. (The
            // two were joined as "none, 0 0 0 7px …" for a color not picked,
            // which is not a valid shadow: the remote's place never showed.)
            const rings = [picked ? '0 0 0 3px #fff' : '', focused ? `0 0 0 ${picked ? 7 : 5}px ${a.ring}` : ''].filter(Boolean);
            return (
              <button
                key={a.id}
                type="button"
                data-pf={id}
                data-focused={focused ? 'true' : 'false'}
                onClick={() => { setFocus(id); setDraft((d) => ({ ...d, avatar: a.id })); }}
                aria-label={t(`profiles.colors.${a.id}`, { defaultValue: a.id })}
                aria-pressed={picked}
                className="mr-4 mb-3 rounded-full outline-none"
                style={{
                  width: 48, height: 48, backgroundColor: a.bg,
                  boxShadow: rings.length ? rings.join(', ') : 'none',
                  transform: focused ? 'scale(1.15)' : 'none',
                }}
              />
            );
          })}
        </div>

        {!isMain && (
          <>
            <div className="text-white/70 text-sm mb-2">{t('profiles.edit.kidsLabel')}</div>
            <div className="flex flex-wrap mb-2">
              {[{ id: null as KidsLevel | null }, ...KIDS_LEVELS].map((k) => {
                const id = `k-${k.id ?? 'off'}`;
                const on = draft.kidsLevel === k.id;
                return (
                  <button
                    key={id}
                    type="button"
                    data-pf={id}
                    data-focused={focus === id ? 'true' : 'false'}
                    onClick={() => { setFocus(id); setDraft((d) => ({ ...d, kidsLevel: k.id })); }}
                    className={`tv-ring mr-3 mb-2 rounded-xl px-4 py-2 text-left ${on ? 'bg-brand-gold text-black' : focus === id ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
                  >
                    <div className="font-semibold">{t(LEVEL_TEXT[k.id ?? 'off'].label)}</div>
                    <div className="text-xs opacity-80">{t(LEVEL_TEXT[k.id ?? 'off'].hint)}</div>
                  </button>
                );
              })}
            </div>
            <p className="text-white/60 text-sm mb-6">
              {t('profiles.edit.kidsInfo')}
            </p>
          </>
        )}

        {!isNew && (
          <>
            <div className="text-white/70 text-sm mb-2">{t('profiles.edit.pinLabel')}</div>
            <div className="flex flex-wrap items-center mb-6">
              {pinsAvailable() ? (
                <>
                  <Btn id="pin" {...fp} className="mr-3" onPress={() => screen.id && push({ kind: 'pin', purpose: 'new', profileId: screen.id }, 'pad-1')}>
                    <span className="inline-flex items-center"><Lock className="w-5 h-5 mr-2" />{p?.pinHash ? t('profiles.edit.changePinBtn') : t('profiles.edit.addPinBtn')}</span>
                  </Btn>
                  {p?.pinHash && <Btn id="pin-off" {...fp} onPress={() => { if (screen.id) setPin(screen.id, null); }}>{t('profiles.edit.removePinBtn')}</Btn>}
                </>
              ) : (
                <p className="text-white/60">{t('profiles.edit.signInForPin')}</p>
              )}
            </div>
          </>
        )}

        {message && <p className="text-amber-300 mb-4">{t(message.key, message.params)}</p>}
        <div className="flex flex-wrap">
          <Btn id="save" {...fp} className="mr-3" onPress={saveEdit}>{t('common.save')}</Btn>
          <Btn id="cancel-edit" {...fp} className="mr-3" onPress={() => pop()}>{t('common.cancel')}</Btn>
          {!isNew && !isMain && (
            <Btn
              id="delete"
              {...fp}
              disabled={screen.id === current.id}
              onPress={() => { if (screen.id && screen.id !== current.id) { deleteProfile(screen.id); pop(`m-${MAIN_PROFILE}`); } }}
            >
              {t('profiles.edit.deleteBtn')}
            </Btn>
          )}
        </div>
        {!isNew && !isMain && screen.id === current.id && (
          <p className="text-white/50 text-sm mt-3">{t('profiles.edit.inUseNote')}</p>
        )}
      </div>
    );
  } else if (screen.kind === 'pin') {
    const p = 'profileId' in screen ? getProfile(screen.profileId) : null;
    const who = p ? profileName(p) : t('profiles.pin.thisProfile');
    title = screen.purpose === 'unlock' ? t('profiles.pin.unlockTitle', { name: who })
      : screen.purpose === 'grownup' ? t('profiles.pin.grownupTitle')
        : screen.purpose === 'new' ? t('profiles.pin.newTitle', { name: who })
          : t('profiles.pin.confirmTitle');
    subtitle = message ? t(message.key, message.params) : (screen.purpose === 'grownup' ? t('profiles.pin.grownupHint')
      : screen.purpose === 'new' ? t('profiles.pin.newHint') : null);
    alert = !!message;
    const showForgot = screen.purpose === 'unlock' && p && pinFailures(p.id) >= FORGOT_AFTER;
    // Its account signed out, so no "Forgot PIN?" here: signing in to it
    // again brings back its profiles, and the reset with them.
    const showSignIn = screen.purpose === 'grownup' && !!onSignIn && kidsHoldNeedsGrownUp();
    body = (
      <div className={roomy ? 'flex flex-col items-center' : 'flex items-center justify-center'}>
        {p && roomy && <div className="mb-6"><Avatar p={p} size={80} /></div>}
        <PinPad {...fp} length={4} value={digits} onDigit={typeDigit} onDelete={() => setDigits((d) => d.slice(0, -1))} onSubmit={() => { if (digits.length === 4) submitPin(digits); }} />
        <div className={roomy ? 'flex mt-6' : 'flex flex-col ml-10'}>
          {showForgot && p && pinsAvailable() && (
            <Btn id="forgot" {...fp} className={roomy ? 'mr-3' : 'mb-3'} onPress={() => push({ kind: 'forgot', profileId: p.id, then: screen.purpose === 'unlock' ? screen.then : 'pick' }, 'pad-1')}>{t('profiles.pin.forgotBtn')}</Btn>
          )}
          {showSignIn && <Btn id="signin" {...fp} className={roomy ? 'mr-3' : 'mb-3'} onPress={() => onSignIn?.()}>{t('profiles.pin.signInAgainBtn')}</Btn>}
          <Btn id="pin-back" {...fp} onPress={() => handlersRef.current.back()}>{t('common.back')}</Btn>
        </div>
      </div>
    );
  } else if (screen.kind === 'forgot') {
    const p = getProfile(screen.profileId);
    const codeSent = forgot?.state === 'sent';
    title = t('profiles.forgot.title', { name: p ? profileName(p) : t('profiles.pin.thisProfile') });
    body = (
      <div className="flex flex-col items-center max-w-xl mx-auto text-center">
        <p className={`mb-6 text-lg ${forgot?.state === 'failed' ? 'text-amber-300' : 'text-white/80'}`}>{forgot ? t(forgot.msg.key, forgot.msg.params) : ''}</p>
        {/* Above the pad, where a 540-line screen still shows it. */}
        {codeSent && message && <p className="text-amber-300 mb-4 text-lg">{t(message.key, message.params)}</p>}
        <div className={roomy || forgot?.state !== 'sent' ? 'flex flex-col items-center' : 'flex items-center justify-center'}>
          {codeSent && (
            <PinPad {...fp} length={6} value={digits} onDigit={typeDigit} onDelete={() => setDigits((d) => d.slice(0, -1))} onSubmit={() => { /* the sixth digit checks it */ }} />
          )}
          <div className={roomy || forgot?.state !== 'sent' ? 'flex mt-6' : 'flex ml-10'}>
            <Btn id="forgot-back" {...fp} onPress={() => handlersRef.current.back()}>{t('common.back')}</Btn>
          </div>
        </div>
      </div>
    );
  }

  // Six digits of a code: OK on the last one checks it.
  useEffect(() => {
    if (screen.kind === 'forgot' && digits.length === 6) void submitCode();
  }, [digits, screen.kind, submitCode]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      // Screens that stand aside for an open Radix dialog (Settings) look for this.
      data-state="open"
      aria-label={title}
      data-profile-screens
      // tv-safe-scroll: a control scrolled into view stops short of the
      // screen's overscan edge rather than flush against it.
      className="fixed inset-0 z-[150] overflow-y-auto tv-safe-scroll text-white"
      style={{ backgroundColor: '#071b3a', backgroundImage: 'linear-gradient(157deg, #071b3a 0%, #0e2550 30%, #2b1550 65%, #143f5c 100%)' }}
    >
      <div className="min-h-full flex flex-col items-center justify-center px-8 py-10">
        <div className="flex items-center mb-2 text-white/60">
          <UserRound className="w-5 h-5 mr-2" />
          <span className="text-sm uppercase tracking-widest">{t('profiles.header')}</span>
        </div>
        <h1 className="text-4xl font-bold text-center mb-3">{title}</h1>
        {subtitle && <p className={`${alert ? 'text-amber-300' : 'text-white/70'} text-lg text-center max-w-2xl mb-6`}>{subtitle}</p>}
        <div className="mt-4 w-full">{body}</div>
      </div>
    </div>
  );
};

export default ProfileScreens;
