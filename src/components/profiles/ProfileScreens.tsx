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
//   gate     at start: pick someone to continue (Back does nothing)
//   pick     switching from Settings or the Kids home button (Back closes)
//   manage   Settings → Profiles: straight to adding and editing (Back to pick)
//   grownup  a Kids profile opening Settings: any grown-up's PIN, when a
//            grown-up profile has one (the caller only opens it then)
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Check, Delete, Lock, Pencil, Plus, UserRound } from 'lucide-react';
import { KIDS_LEVELS, type KidsLevel } from '@/lib/kidsFilter';
import {
  AVATARS, FORGOT_AFTER, MAX_PROFILES, PROFILES_EVENT, activeProfile, avatarColors, checkPin, createProfile,
  deleteProfile, getProfile, grownUpsWithPin, lastPickedId, loadProfiles, pickProfile, pinFailures, pinLockedFor, pinsAvailable,
  requestPinReset, setPin, updateProfile, verifyPinReset, type Profile,
} from '@/lib/profiles';
import { MAIN_PROFILE } from '@/lib/viewer';

export type ProfileScreensMode = 'gate' | 'pick' | 'manage' | 'grownup';

type After = 'pick' | 'edit' | 'manage' | 'grownup';
type Screen =
  | { kind: 'pick' }
  | { kind: 'manage' }
  | { kind: 'edit'; id: string | null }
  | { kind: 'pin'; purpose: 'unlock'; profileId: string; then: After }
  | { kind: 'pin'; purpose: 'grownup'; then: After }
  | { kind: 'pin'; purpose: 'new'; profileId: string }
  | { kind: 'pin'; purpose: 'confirm'; profileId: string; first: string }
  | { kind: 'forgot'; profileId: string; then: After };

interface Props {
  mode: ProfileScreensMode;
  onClose: () => void;
  /** grownup: the PIN was right (or nobody has one). */
  onGrownUpOk?: () => void;
}

const BACK_KEYS = new Set(['Escape', 'Backspace', 'GoBack', 'BrowserBack']);
const isBack = (e: KeyboardEvent) => BACK_KEYS.has(e.key) || e.keyCode === 4 || e.keyCode === 27;
const isOk = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66;
const digitOf = (e: KeyboardEvent): string | null => {
  if (/^[0-9]$/.test(e.key)) return e.key;
  if (e.keyCode >= 7 && e.keyCode <= 16) return String(e.keyCode - 7); // Android KEYCODE_0..9
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

const Avatar = memo(({ p, size = 112, focused = false }: { p: Pick<Profile, 'name' | 'avatar' | 'kidsLevel' | 'pinHash'>; size?: number; focused?: boolean }) => {
  const c = avatarColors(p.avatar);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        className="w-full h-full rounded-2xl flex items-center justify-center font-bold text-white select-none"
        style={{ backgroundColor: c.bg, fontSize: size * 0.45, boxShadow: focused ? `0 0 0 4px ${c.ring}, 0 0 24px ${c.ring}` : 'none' }}
      >
        {(p.name.trim()[0] || '?').toUpperCase()}
      </div>
      {p.pinHash && (
        <div className="absolute -bottom-2 -right-2 rounded-full bg-black/80 p-1.5 border border-white/30">
          <Lock className="w-4 h-4 text-white" />
        </div>
      )}
      {p.kidsLevel && (
        <div className="absolute -top-2 -left-2 rounded-full bg-brand-gold px-2 py-0.5 text-xs font-bold text-black">KIDS</div>
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
const PinPad = ({ length, value, onDigit, onDelete, onSubmit, focus, setFocus }: PadProps) => (
  <div className="flex flex-col items-center">
    <div className="flex mb-6" aria-label={`${value.length} of ${length} digits`}>
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
            aria-label={k === 'del' ? 'Delete' : k === 'ok' ? 'Done' : k}
          >
            {k === 'del' ? <Delete className="w-7 h-7" /> : k === 'ok' ? <Check className="w-7 h-7" /> : k}
          </button>
        </div>
      ))}
    </div>
  </div>
);

// ── the overlay ────────────────────────────────────────────────────────────

const ProfileScreens = ({ mode, onClose, onGrownUpOk }: Props) => {
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
  const [message, setMessage] = useState<string | null>(null);
  // Profiles whose PIN was given while this is open: not asked twice.
  const unlocked = useRef(new Set<string>());
  const current = useMemo(() => activeProfile(), [profiles]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = () => setProfiles(loadProfiles());
    window.addEventListener(PROFILES_EVENT, on);
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
    setDraft(p ? { name: p.name, avatar: p.avatar, kidsLevel: p.kidsLevel }
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
    else finish('pick', p.id);
  }, [finish, push]);

  const openManage = useCallback(() => {
    // From a Kids profile, changing profiles is a grown-up's job.
    if (current.kidsLevel && grownUpsWithPin().length > 0) push({ kind: 'pin', purpose: 'grownup', then: 'manage' }, 'pad-1');
    else push({ kind: 'manage' }, `m-${profiles[0]?.id ?? MAIN_PROFILE}`);
  }, [current.kidsLevel, profiles, push]);

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
      if (wait > 0) { setDigits(''); setMessage(`Too many tries — wait ${Math.ceil(wait / 1000)} seconds.`); return; }
      if (checkPin(p, value)) { unlocked.current.add(p.id); finish(screen.then, p.id); return; }
      setDigits('');
      const left = pinLockedFor(p.id);
      setMessage(left > 0 ? `Wrong PIN. Too many tries — wait ${Math.ceil(left / 1000)} seconds.` : 'Wrong PIN. Try again.');
      return;
    }
    if (screen.purpose === 'grownup') {
      const ok = grownUpsWithPin().some((p) => pinLockedFor(p.id) === 0 && checkPin(p, value));
      if (ok) { finish(screen.then); return; }
      setDigits(''); setMessage('That isn\'t a grown-up\'s PIN.');
      return;
    }
    if (screen.purpose === 'new') {
      replace({ kind: 'pin', purpose: 'confirm', profileId: screen.profileId, first: value }, 'pad-1');
      return;
    }
    if (screen.purpose === 'confirm') {
      if (value !== screen.first) {
        replace({ kind: 'pin', purpose: 'new', profileId: screen.profileId }, 'pad-1');
        setMessage('Those didn\'t match. Enter the new PIN again.');
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
  const [forgot, setForgot] = useState<{ state: 'sending' | 'sent' | 'failed'; text: string } | null>(null);
  const forgotFor = screen.kind === 'forgot' ? screen.profileId : null;
  useEffect(() => {
    if (!forgotFor) { setForgot(null); return; }
    let alive = true;
    setForgot({ state: 'sending', text: 'Sending a reset code…' });
    void requestPinReset(forgotFor).then((r) => {
      if (!alive) return;
      if (!r.ok) {
        setForgot({
          state: 'failed',
          text: r.reason === 'too_many' ? 'Too many reset requests. Try again in an hour, or contact Snow Media support.'
            : r.reason === 'signed_out' ? 'Sign in to your Snow Media account on this box to reset the PIN.'
              : r.reason === 'no_pin' ? 'This profile has no PIN any more — pick it again.'
                : 'Couldn\'t reach Snow Media. Check the internet connection and try again.',
        });
        return;
      }
      const where = r.emailed && r.email ? `We emailed a 6-digit code to ${r.email}. Enter it below.` : 'We couldn\'t email a code to this account.';
      const support = r.ticket ? ' Snow Media support has been told too — if the email doesn\'t come, they can reset it for you.' : '';
      setForgot({ state: r.emailed ? 'sent' : 'failed', text: where + support });
    });
    return () => { alive = false; };
  }, [forgotFor]);

  const submitCode = useCallback(async () => {
    if (screen.kind !== 'forgot' || digits.length !== 6) return;
    setMessage('Checking…');
    const r = await verifyPinReset(screen.profileId, digits);
    if (r.ok) { unlocked.current.add(screen.profileId); finish(screen.then, screen.profileId); return; }
    setDigits('');
    setMessage(r.reason === 'wrong_code' ? `That code isn't right.${typeof r.left === 'number' ? ` ${r.left} tries left.` : ''}`
      : r.reason === 'expired' ? 'That code has expired. Go back and ask for a new one.'
        : r.reason === 'too_many' ? 'Too many wrong codes. Go back and ask for a new one.'
          : 'Couldn\'t reach Snow Media. Try again.');
  }, [digits, finish, screen, setDigits]);

  // ── the editor's working copy ──
  const editing = screen.kind === 'edit' ? screen : null;

  const saveEdit = useCallback(() => {
    if (!editing) return;
    const name = draft.name.trim();
    if (!name) { setMessage('Give the profile a name.'); setFocus('name'); return; }
    if (editing.id) updateProfile(editing.id, { name, avatar: draft.avatar, kidsLevel: editing.id === MAIN_PROFILE ? null : draft.kidsLevel });
    else if (!createProfile({ name, avatar: draft.avatar, kidsLevel: draft.kidsLevel })) { setMessage(`Up to ${MAX_PROFILES} profiles.`); return; }
    pop(`m-${editing.id ?? MAIN_PROFILE}`);
  }, [draft, editing, pop]);

  // ── keys ──
  const handlersRef = useRef<{ back: () => void; ok: () => void }>({ back: () => {}, ok: () => {} });
  handlersRef.current.back = () => {
    if (stack.length > 1) { pop(); return; }
    if (mode !== 'gate') onClose();
  };
  handlersRef.current.ok = () => {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-pf="${focus}"]`);
    if (!el) return;
    if (el instanceof HTMLInputElement) { el.focus(); return; }
    el.click();
  };

  const lastBackRef = useRef(0);
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
        // The name box: the TV keyboard has it; Up/Down, OK and Back leave it.
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || isOk(e) || isBack(e)) {
          e.preventDefault(); e.stopImmediatePropagation();
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
      const d = digitOf(e);
      if (d != null) { e.preventDefault(); typeDigit(d); return; }
      const dir = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : null;
      if (dir) {
        e.preventDefault();
        const next = rootRef.current && nearest(rootRef.current, focus, dir);
        if (next) setFocus(next);
        return;
      }
      if (isOk(e)) { e.preventDefault(); handlersRef.current.ok(); }
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

  if (screen.kind === 'pick' || screen.kind === 'manage') {
    const managing = screen.kind === 'manage';
    title = managing ? 'Manage profiles' : 'Who\'s watching?';
    const introSeen = (() => { try { return !!localStorage.getItem('smc-profiles-intro-seen'); } catch { return true; } })();
    subtitle = managing ? 'Pick a profile to change it.'
      : !introSeen && profiles.length === 1
        ? 'Everyone in the house can have their own profile — their own Continue Watching, My List, favourites and home screen. Kids profiles only show what\'s right for their age.'
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
                <div className={`mt-3 text-xl ${focus === id ? 'text-white font-bold' : 'text-white/70'}`}>{p.name}</div>
              </button>
            );
          })}
          {profiles.length < MAX_PROFILES && (
            <button
              type="button"
              data-pf="add"
              data-focused={focus === 'add' ? 'true' : 'false'}
              onClick={() => { setFocus('add'); if (current.kidsLevel && grownUpsWithPin().length > 0 && !managing) openManage(); else openEdit(null); }}
              className="flex flex-col items-center m-4 rounded-2xl p-2 outline-none"
            >
              <div
                className="rounded-2xl flex items-center justify-center border-2 border-dashed border-white/50"
                style={{ width: 112, height: 112, boxShadow: focus === 'add' ? '0 0 0 4px #fff' : 'none' }}
              >
                <Plus className="w-12 h-12 text-white/80" />
              </div>
              <div className={`mt-3 text-xl ${focus === 'add' ? 'text-white font-bold' : 'text-white/70'}`}>Add profile</div>
            </button>
          )}
        </div>
        <div className="flex justify-center mt-8">
          {managing
            ? <Btn id="done" {...fp} onPress={() => pop(`p-${current.id}`)}>Done</Btn>
            : <Btn id="manage" {...fp} onPress={openManage}><span className="inline-flex items-center"><Pencil className="w-5 h-5 mr-2" />Manage profiles</span></Btn>}
          {!managing && (mode === 'pick' || mode === 'manage') && <Btn id="cancel" {...fp} className="ml-4" onPress={onClose}>Cancel</Btn>}
        </div>
      </>
    );
  } else if (screen.kind === 'edit') {
    const isNew = !screen.id;
    const p = screen.id ? getProfile(screen.id) : null;
    const isMain = screen.id === MAIN_PROFILE;
    title = isNew ? 'Add a profile' : `Edit ${p?.name ?? 'profile'}`;
    body = (
      <div className="w-full max-w-2xl mx-auto">
        <div className="flex items-center mb-6">
          <Avatar p={{ name: draft.name || '?', avatar: draft.avatar, kidsLevel: draft.kidsLevel, pinHash: p?.pinHash ?? null }} size={96} />
          <div className="ml-6 flex-1">
            <label className="block text-white/70 text-sm mb-1" htmlFor="profile-name">Name</label>
            <input
              id="profile-name"
              data-pf="name"
              data-focused={focus === 'name' ? 'true' : 'false'}
              value={draft.name}
              maxLength={24}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onFocus={() => setFocus('name')}
              placeholder="Their name"
              className={`tv-ring w-full rounded-xl bg-white/10 px-4 py-3 text-2xl text-white outline-none ${focus === 'name' ? 'bg-white/20' : ''}`}
            />
          </div>
        </div>

        <div className="text-white/70 text-sm mb-2">Colour</div>
        <div className="flex flex-wrap mb-6">
          {AVATARS.map((a) => (
            <button
              key={a.id}
              type="button"
              data-pf={`c-${a.id}`}
              data-focused={focus === `c-${a.id}` ? 'true' : 'false'}
              onClick={() => { setFocus(`c-${a.id}`); setDraft((d) => ({ ...d, avatar: a.id })); }}
              aria-label={a.id}
              className="mr-3 mb-2 rounded-full outline-none"
              style={{ width: 48, height: 48, backgroundColor: a.bg, boxShadow: `${draft.avatar === a.id ? '0 0 0 3px #fff' : 'none'}${focus === `c-${a.id}` ? `, 0 0 0 7px ${a.ring}` : ''}` }}
            />
          ))}
        </div>

        {!isMain && (
          <>
            <div className="text-white/70 text-sm mb-2">Kids profile</div>
            <div className="flex flex-wrap mb-2">
              {[{ id: null as KidsLevel | null, label: 'Off', hint: 'Everything' }, ...KIDS_LEVELS].map((k) => {
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
                    <div className="font-semibold">{k.label}</div>
                    <div className="text-xs opacity-80">{k.hint}</div>
                  </button>
                );
              })}
            </div>
            <p className="text-white/60 text-sm mb-6">
              Kids profiles see Plex titles up to that rating and only the kids and family channels in Live TV (Teens: every channel that isn't adult), with no Store, Main Apps, Games, Settings, tickets or Remote Access.
            </p>
          </>
        )}

        {!isNew && (
          <>
            <div className="text-white/70 text-sm mb-2">PIN</div>
            <div className="flex flex-wrap items-center mb-6">
              {pinsAvailable() ? (
                <>
                  <Btn id="pin" {...fp} className="mr-3" onPress={() => screen.id && push({ kind: 'pin', purpose: 'new', profileId: screen.id }, 'pad-1')}>
                    <span className="inline-flex items-center"><Lock className="w-5 h-5 mr-2" />{p?.pinHash ? 'Change PIN' : 'Add a PIN'}</span>
                  </Btn>
                  {p?.pinHash && <Btn id="pin-off" {...fp} onPress={() => { if (screen.id) setPin(screen.id, null); }}>Remove PIN</Btn>}
                </>
              ) : (
                <p className="text-white/60">Sign in to your Snow Media account to add a PIN — that's how a forgotten one gets reset.</p>
              )}
            </div>
          </>
        )}

        {message && <p className="text-amber-300 mb-4">{message}</p>}
        <div className="flex flex-wrap">
          <Btn id="save" {...fp} className="mr-3" onPress={saveEdit}>Save</Btn>
          <Btn id="cancel-edit" {...fp} className="mr-3" onPress={() => pop()}>Cancel</Btn>
          {!isNew && !isMain && (
            <Btn
              id="delete"
              {...fp}
              disabled={screen.id === current.id}
              onPress={() => { if (screen.id && screen.id !== current.id) { deleteProfile(screen.id); pop(`m-${MAIN_PROFILE}`); } }}
            >
              Delete profile
            </Btn>
          )}
        </div>
        {!isNew && !isMain && screen.id === current.id && (
          <p className="text-white/50 text-sm mt-3">This is the profile in use — switch to another one to delete it.</p>
        )}
      </div>
    );
  } else if (screen.kind === 'pin') {
    const p = 'profileId' in screen ? getProfile(screen.profileId) : null;
    title = screen.purpose === 'unlock' ? `Enter the PIN for ${p?.name ?? 'this profile'}`
      : screen.purpose === 'grownup' ? 'Ask a grown-up'
        : screen.purpose === 'new' ? `New PIN for ${p?.name ?? 'this profile'}`
          : 'Enter the new PIN again';
    subtitle = screen.purpose === 'grownup' ? 'A grown-up\'s profile PIN opens this.'
      : screen.purpose === 'new' ? 'Four numbers. Use the number keys on the remote, or the pad.' : null;
    const showForgot = screen.purpose === 'unlock' && p && pinFailures(p.id) >= FORGOT_AFTER;
    body = (
      <div className="flex flex-col items-center">
        {p && <div className="mb-6"><Avatar p={p} size={80} /></div>}
        <PinPad {...fp} length={4} value={digits} onDigit={typeDigit} onDelete={() => setDigits((d) => d.slice(0, -1))} onSubmit={() => { if (digits.length === 4) submitPin(digits); }} />
        {message && <p className="text-amber-300 mt-4 text-lg">{message}</p>}
        <div className="flex mt-6">
          {showForgot && p && pinsAvailable() && (
            <Btn id="forgot" {...fp} className="mr-3" onPress={() => push({ kind: 'forgot', profileId: p.id, then: screen.purpose === 'unlock' ? screen.then : 'pick' }, 'pad-1')}>Forgot PIN?</Btn>
          )}
          <Btn id="pin-back" {...fp} onPress={() => handlersRef.current.back()}>Back</Btn>
        </div>
      </div>
    );
  } else if (screen.kind === 'forgot') {
    const p = getProfile(screen.profileId);
    title = `Reset the PIN for ${p?.name ?? 'this profile'}`;
    body = (
      <div className="flex flex-col items-center max-w-xl mx-auto text-center">
        <p className={`mb-6 text-lg ${forgot?.state === 'failed' ? 'text-amber-300' : 'text-white/80'}`}>{forgot?.text ?? ''}</p>
        {forgot?.state === 'sent' && (
          <>
            <PinPad {...fp} length={6} value={digits} onDigit={typeDigit} onDelete={() => setDigits((d) => d.slice(0, -1))} onSubmit={() => { /* the sixth digit checks it */ }} />
            {message && <p className="text-amber-300 mt-4 text-lg">{message}</p>}
          </>
        )}
        <div className="flex mt-6">
          <Btn id="forgot-back" {...fp} onPress={() => handlersRef.current.back()}>Back</Btn>
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
      className="fixed inset-0 z-[150] overflow-y-auto text-white"
      style={{ backgroundColor: '#071b3a', backgroundImage: 'linear-gradient(157deg, #071b3a 0%, #0e2550 30%, #2b1550 65%, #143f5c 100%)' }}
    >
      <div className="min-h-full flex flex-col items-center justify-center px-8 py-10">
        <div className="flex items-center mb-2 text-white/60">
          <UserRound className="w-5 h-5 mr-2" />
          <span className="text-sm uppercase tracking-widest">Profiles</span>
        </div>
        <h1 className="text-4xl font-bold text-center mb-3">{title}</h1>
        {subtitle && <p className="text-white/70 text-lg text-center max-w-2xl mb-6">{subtitle}</p>}
        <div className="mt-4 w-full">{body}</div>
      </div>
    </div>
  );
};

export default ProfileScreens;
