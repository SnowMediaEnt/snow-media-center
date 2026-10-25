import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tv, Loader2, Sparkles, KeyRound, UserRound } from 'lucide-react';
import {
  authenticateRouted,
  pickServerForUsername,
  saveCreds,
  savePlayerAccount,
  buildPlayerAccount,
  upsertSavedAccount,
  savedAccountId,
  daysUntilExp,
  serverDisplayName,
  type XtreamCreds,
  type XtreamServer,
} from '@/lib/xtream';
import { useAuth } from '@/hooks/useAuth';
import { useTVFocus, TVFocusNavigationMap } from '@/hooks/useTVFocus';
import { syncPlayerAccountToCloud } from '@/lib/playerAccountSync';
import { capturePlayerSignin } from '@/lib/playerSigninCapture';
import { tryPlayerBridge } from '@/lib/playerLogin';
import { trackEvent } from '@/lib/analytics';
import { useToast } from '@/hooks/use-toast';
import { useBillingEnabled } from '@/hooks/useBillingEnabled';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { isDemo } from '@/lib/demoMode';
import { readPending } from '@/components/getstarted/pending';
import { isNativePlatform } from '@/utils/platform';
import { useTranslation } from 'react-i18next';
import { keepTypingFocus } from '@/utils/keepTypingFocus';
import { PasswordRevealButton, PASSWORD_REVEAL_PAD } from '@/components/ui/PasswordRevealButton';
import { pinSignIn, pinDigits, formatPin, PIN_LENGTH, type PinFailReason } from '@/lib/pinSignIn';

// Sign-up for someone with no account yet: DreamStreams end to end on the TV,
// Vibez handed off to their site. Loaded only when the viewer presses it.
const GetStartedFlow = lazy(() => import('@/components/getstarted/GetStartedFlow'));

// The left column's controls, for Left back from the right column.
const LEFT_IDS = ['cf-user', 'cf-pass', 'cf-pass-show', 'cf-submit', 'cf-cancel'];
const PIN_LEFT_IDS = ['cf-pin-input', 'cf-pin-show', 'cf-pin-submit'];

interface Props {
  initial?: Partial<XtreamCreds> | null;
  onSaved: (creds: XtreamCreds) => void;
  onCancel?: () => void;
  /**
   * Fires while a full-screen child (sign-up) is mounted. LiveTV and
   * AccountChooser use it to stop their own Back handling, which would
   * otherwise close the whole Player out from under the child.
   */
  onChildOpenChange?: (open: boolean) => void;
  /**
   * The line signed in but Snow Media has no account for it yet (not on file,
   * or no email on file). The shell opens "Finish your Snow Media account".
   */
  onNeedProfile?: () => void;
}

const CredentialsForm = memo(({ initial, onSaved, onCancel, onChildOpenChange, onNeedProfile }: Props) => {
  const { t } = useTranslation();
  const [username, setUsername] = useState(initial?.username || '');
  const [password, setPassword] = useState(initial?.password || '');
  // Show / Hide on the password box: dots every time the form opens.
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  // Sign in with a PIN: one 10-digit field instead of username + password.
  // The digits live only in this state while typed, and are cleared the
  // moment Sign in is pressed: never saved, logged or sent anywhere but
  // pin-signin (lib/pinSignIn).
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [probingServer, setProbingServer] = useState<XtreamServer | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();

  // ── Get started (no account yet) ───────────────────────────────────────
  // DreamStreams needs the billing plugin and its app key; Vibez needs
  // neither — it is a URL and a text field — so they are gated separately.
  // The demo check lives HERE, not at the call sites: AccountChooser has no
  // demo guard of its own, and a demo viewer must never reach a real checkout.
  const billingOn = useBillingEnabled();
  const { enabled: vibezOn } = useFeatureFlag('vibez_signup', false);
  const [childOpen, setChildOpen] = useState(false);
  // What the keyboard path saw on this box, for the screenshot that settles
  // "Next does nothing". Native only; the web never has this problem.
  const showStart = !isDemo() && (billingOn || vibezOn);
  // A demo viewer never reaches a real server, so no PIN sign-in either.
  const showPinOption = !isDemo();
  // A hand-off recorded before the app was backgrounded (or killed) turns the
  // button into a way back into the middle of that purchase.
  const pending = showStart ? readPending() : null;

  useEffect(() => { onChildOpenChange?.(childOpen); }, [childOpen, onChildOpenChange]);
  useEffect(() => () => { onChildOpenChange?.(false); }, [onChildOpenChange]);

  // ── D-pad focus (TV remote) ────────────────────────────────────────────
  // This form must own its own D-pad navigation. Without it the WebView's
  // native spatial navigation decides where focus lands on mount, which put
  // the cursor on a bottom button instead of the Username field.
  //
  // Two columns on a TV: the fields and Sign in on the left, "Other ways in"
  // (a PIN, Get started) on the right. Up / Down stay inside a column; Right
  // from the left column crosses over, and Left comes back to wherever the
  // highlight last was on the left.
  const hasCancel = !!onCancel;
  const lastLeftRef = useRef<string>('cf-user');
  const navigation = useMemo<TVFocusNavigationMap>(() => {
    // The top of the right column: Sign in with a PIN (when offered), else Get started.
    const side = showPinOption ? 'cf-pin' : showStart ? 'cf-start' : null;
    const backLeft = (ids: string[], fallback: string) => () =>
      (ids.includes(lastLeftRef.current) ? lastLeftRef.current : fallback);
    const toLeft = backLeft(LEFT_IDS, 'cf-user');
    const toPinLeft = backLeft(PIN_LEFT_IDS, 'cf-pin-submit');
    return {
      'cf-user':   { up: null, down: 'cf-pass', left: null, right: side },
      // Right from the password box: its Show / Hide first, then the right column.
      'cf-pass':   { up: 'cf-user', down: 'cf-submit', left: null, right: 'cf-pass-show' },
      // Show / Hide inside the password box: Up / Down go where the box's go,
      // Left back to it.
      'cf-pass-show': { up: 'cf-user', down: 'cf-submit', left: 'cf-pass', right: side },
      'cf-submit': { up: 'cf-pass', down: null, left: null, right: hasCancel ? 'cf-cancel' : side },
      'cf-cancel': { up: 'cf-pass', down: null, left: 'cf-submit', right: side },
      // The right column.
      'cf-pin':    { up: null, down: showStart ? 'cf-start' : null, left: toLeft, right: null },
      'cf-start':  { up: showPinOption ? 'cf-pin' : null, down: null, left: toLeft, right: null },
      // The PIN screen: the field (its Show / Hide on the right) and Sign in
      // on the left, the way back to username and password on the right.
      'cf-pin-input':  { up: null, down: 'cf-pin-submit', left: null, right: 'cf-pin-show' },
      'cf-pin-show':   { up: null, down: 'cf-pin-submit', left: 'cf-pin-input', right: 'cf-pin-back' },
      'cf-pin-submit': { up: 'cf-pin-input', down: null, left: null, right: 'cf-pin-back' },
      'cf-pin-back':   { up: null, down: null, left: toPinLeft, right: null },
    };
  }, [hasCancel, showStart, showPinOption]);
  // Where Left from the right column returns to: the last left-column
  // control that had focus, however it got there (remote, keyboard, tap).
  const noteFocus = (e: React.FocusEvent<HTMLFormElement>) => {
    const id = (e.target as HTMLElement).dataset?.tvFocusId;
    if (id && (LEFT_IDS.includes(id) || PIN_LEFT_IDS.includes(id))) lastLeftRef.current = id;
  };

  // Leaving the PIN screen: the field is emptied and the dots come back.
  const leavePinMode = () => { setPin(''); setShowPin(false); setPinMode(false); };

  const { containerRef, focusById, focusProps } = useTVFocus({
    enabled: !childOpen,
    navigation,
    initialFocusId: 'cf-user',
    // Back on the PIN screen goes back one level, to username and password.
    onBack: () => { if (pinMode) leavePinMode(); else onCancel?.(); },
    scrollBlock: 'center',
  });
  // Switching between the two ways in: the highlight goes to the PIN field
  // on the way in, and back to the button that opened it on the way out.
  const pinModeSeenRef = useRef(pinMode);
  useEffect(() => {
    if (pinModeSeenRef.current === pinMode) return;
    pinModeSeenRef.current = pinMode;
    const raf = requestAnimationFrame(() => focusById(pinMode ? 'cf-pin-input' : 'cf-pin'));
    return () => cancelAnimationFrame(raf);
  }, [pinMode, focusById]);
  // Closing the child re-renders the form without re-running the hook's
  // one-time auto-focus. Land back on the button that opened it rather than
  // the username field, which on a TV would also raise the on-screen keyboard
  // and read as the app resetting itself.
  const openedFromRef = useRef<string>('cf-user');
  // Only on the way BACK. Without this guard it also ran on mount, landing a
  // second focus call on the username field on top of the hook's own — one
  // more thing raising the keyboard on a screen the viewer only just opened.
  const wasChildOpenRef = useRef(false);
  useEffect(() => {
    if (childOpen) { wasChildOpenRef.current = true; return; }
    if (!wasChildOpenRef.current) return;
    wasChildOpenRef.current = false;
    const raf = requestAnimationFrame(() => focusById(openedFromRef.current));
    return () => cancelAnimationFrame(raf);
  }, [childOpen, focusById]);

  /**
   * Everything after a username and password are in hand: check them on the
   * panel, save the line, remember it, capture and sync it, then hand it to
   * the shell. Typed credentials and a PIN's line both come through here.
   * `server` pins the line's service (a PIN's line: the server said which);
   * `fromPin` words a refused password for a PIN's line.
   */
  const signInWith = async (
    username: string,
    password: string,
    opts: { server?: XtreamServer; fromPin?: boolean } = {},
  ) => {
    setTesting(true);
    const routedServer = opts.server ?? pickServerForUsername(username);
    setProbingServer(routedServer);
    try {
      const result = await authenticateRouted(username, password, (s) => setProbingServer(s), opts.server);
      if (!result.ok || !result.creds) {
        toast({
          title: t('liveAccount.credentials.failedTitle'),
          // A PIN's line whose password the panel refuses: the password was
          // changed on the panel since the PIN's line was last seen.
          description: opts.fromPin && result.invalidLogin
            ? t('liveAccount.credentials.pin.passwordChanged')
            : result.error || t('liveAccount.credentials.invalid'),
          variant: 'destructive',
        });
        return;
      }
      await saveCreds(result.creds);
      // Persist a Player Account snapshot from the panel response so the home
      // banner / Settings card can warn about expiration even without a main
      // Supabase account.
      if (result.server) {
        const acc = buildPlayerAccount(result.server, result.creds, result.userInfo);
        await savePlayerAccount(acc);
        // Multi-account switcher store — remember every successful login.
        void upsertSavedAccount({
          id: savedAccountId(result.creds.host, result.creds.username),
          serverLabel: result.server.label,
          host: result.creds.host,
          username: result.creds.username,
          password: result.creds.password,
          output: result.creds.output,
          addedAt: Date.now(),
        });
        // Capture EVERY sign-in (anonymous leads too) — additive to the authed
        // sync below, which stays gated on a Supabase session.
        void capturePlayerSignin(acc, result.server.label, 'signin');
        // If the user is signed into a main account, mirror this into their
        // customer_services row (fire-and-forget).
        if (user?.id && user.email) {
          void syncPlayerAccountToCloud(user.id, user.email, acc);
        } else {
          // Reverse bridge: no website session, but this line may already be
          // linked to one. The server re-verifies the creds against the panel
          // and, when linked, signs that account in — so the customer's email
          // account, orders and credits load without a second login.
          void tryPlayerBridge(result.creds.username, result.creds.password).then((r) => {
            if (r.ok) {
              toast({
                title: t('liveAccount.credentials.loadedTitle'),
                description: r.emailMasked
                  ? t('liveAccount.credentials.loadedDescEmail', { email: r.emailMasked })
                  : t('liveAccount.credentials.loadedDesc'),
              });
            } else if (r.reason === 'not_linked') {
              onNeedProfile?.();
            }
          });
        }
        try {
          trackEvent('livetv_signin', 'player', {
            server: result.server.label,
            username: acc.username,
            is_trial: acc.isTrial,
            days_left: daysUntilExp(acc),
          });
        } catch { /* ignore */ }
      }
      toast({ title: t('liveAccount.credentials.connectedTitle'), description: t('liveAccount.credentials.connectedDesc', { server: result.server?.label }) });
      onSaved(result.creds);
    } catch (err) {
      toast({
        title: t('liveAccount.credentials.connectFailedTitle'),
        description: (err as Error).message || t('liveAccount.credentials.connectFailedDesc'),
        variant: 'destructive',
      });
    } finally {
      setTesting(false);
      setProbingServer(null);
    }
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!username || !password) {
      toast({ title: t('liveAccount.credentials.missingTitle'), description: t('liveAccount.credentials.missingDesc'), variant: 'destructive' });
      return;
    }
    await signInWith(username, password);
  };

  const PIN_FAIL_TEXT: Record<PinFailReason, string> = {
    invalid_pin: 'liveAccount.credentials.pin.invalidPin',
    not_found: 'liveAccount.credentials.pin.notFound',
    expired: 'liveAccount.credentials.pin.expired',
    rate_limited: 'liveAccount.credentials.pin.rateLimited',
    error: 'liveAccount.credentials.pin.error',
  };

  const submitPin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (testing) return;
    const typed = pin;
    // Used once: the field is emptied before the PIN goes anywhere.
    setPin('');
    setShowPin(false);
    if (typed.length !== PIN_LENGTH) {
      toast({ title: t('liveAccount.credentials.failedTitle'), description: t(PIN_FAIL_TEXT.invalid_pin), variant: 'destructive' });
      return;
    }
    setTesting(true);
    const outcome = await pinSignIn(typed);
    if (!outcome.ok || !outcome.line) {
      setTesting(false);
      toast({ title: t('liveAccount.credentials.failedTitle'), description: t(PIN_FAIL_TEXT[outcome.reason ?? 'error']), variant: 'destructive' });
      return;
    }
    await signInWith(outcome.line.username, outcome.line.password, { server: outcome.line.server, fromPin: true });
  };

  if (childOpen) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
        <GetStartedFlow
          vibezEnabled={vibezOn}
          onDone={(c) => {
            setChildOpen(false);
            toast({ title: t('liveAccount.credentials.connectedTitle'), description: c.serverLabel ? t('liveAccount.credentials.connectedDesc', { server: serverDisplayName(c.serverLabel) }) : t('liveAccount.credentials.connectedYourService') });
            onSaved(c);
          }}
          onCancel={() => setChildOpen(false)}
        />
      </Suspense>
    );
  }

  // Shared by every field and button: 40px fields, 36-40px buttons, no
  // ring (the remote's highlight is the focus mark).
  const fieldClass = 'rounded-lg h-10 bg-black/30 text-white border-white/20 focus-visible:ring-0 focus-visible:ring-offset-0';
  const sideButtonClass = 'w-full rounded-lg min-h-9 h-auto py-1.5 px-2.5 text-[13px] whitespace-normal transition-transform duration-150 ease-out';

  return (
    <div ref={containerRef} className="min-h-screen flex items-center justify-center px-4 py-3">
      <form
        onSubmit={pinMode ? submitPin : submit}
        // A tapped button keeps the typing box's focus (phones: the keyboard
        // stays up and the form doesn't jump from under the finger).
        onMouseDown={keepTypingFocus}
        onFocus={noteFocus}
        data-creds-form
        // Wide and slim on a TV: two columns across ~880 of the 960 CSS px.
        // An upright phone stacks them (styles/phone-player.css).
        className="w-full max-w-[880px] rounded-2xl px-6 py-5 [background:var(--gradient-navy)] shadow-2xl border border-white/10"
      >
        <div className="sm:flex sm:items-stretch" data-creds-cols>
          {/* ── Left: the title, the fields, Sign in ─────────────────────── */}
          <div className="sm:flex-1 min-w-0" data-creds-main>
            <div className="flex items-center mb-3.5">
              <div className="w-9 h-9 mr-3 shrink-0 rounded-xl bg-brand-gold/20 flex items-center justify-center">
                <Tv className="w-5 h-5 text-brand-gold" />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl leading-tight font-quicksand font-bold text-white truncate">{t('liveAccount.credentials.title')}</h2>
                <p className="text-brand-ice/70 font-nunito text-sm leading-snug">
                  {pinMode ? t('liveAccount.credentials.pin.subtitle') : t('liveAccount.credentials.subtitle')}
                </p>
              </div>
            </div>

            {pinMode ? (
              <div className="space-y-1">
                <Label htmlFor="lt-pin" className="text-brand-ice font-nunito text-sm">{t('liveAccount.credentials.pin.label')}</Label>
                {/* Show / Hide comes BEFORE the field, as on the password: the
                    keyboard's Done after the PIN lands on Sign in. */}
                <div className="relative">
                  <PasswordRevealButton
                    {...focusProps('cf-pin-show')}
                    shown={showPin}
                    onToggle={() => setShowPin((v) => !v)}
                    disabled={testing}
                  />
                  <Input
                    id="lt-pin"
                    {...focusProps('cf-pin-input')}
                    type={showPin ? 'text' : 'password'}
                    inputMode="numeric"
                    placeholder="12345 67890"
                    aria-label={t('liveAccount.credentials.pin.label')}
                    // Shown grouped "12345 67890"; held as the digits alone.
                    value={formatPin(pin)}
                    onChange={(e) => setPin(pinDigits(e.target.value))}
                    maxLength={PIN_LENGTH + 1}
                    className={`${fieldClass} text-base md:text-base tracking-widest ${PASSWORD_REVEAL_PAD}`}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="done"
                    disabled={testing}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="space-y-1" data-howto="signin.username">
                  <Label htmlFor="lt-user" className="text-brand-ice font-nunito text-sm">{t('liveAccount.credentials.username')}</Label>
                  <Input
                    id="lt-user"
                    {...focusProps('cf-user')}
                    placeholder={t('liveAccount.credentials.username')}
                    aria-label={t('liveAccount.credentials.username')}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className={fieldClass}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="next"
                    disabled={testing}
                  />
                </div>
                <div className="space-y-1" data-howto="signin.password">
                  <Label htmlFor="lt-pass" className="text-brand-ice font-nunito text-sm">{t('liveAccount.credentials.password')}</Label>
                  {/* Show / Hide comes BEFORE the field: the keyboard's Done after the
                      password lands on the next control in DOM order, Sign in. */}
                  <div className="relative">
                    <PasswordRevealButton
                      {...focusProps('cf-pass-show')}
                      shown={showPassword}
                      onToggle={() => setShowPassword((v) => !v)}
                      disabled={testing}
                    />
                    <Input
                      id="lt-pass"
                      {...focusProps('cf-pass')}
                      type={showPassword ? 'text' : 'password'}
                      placeholder={t('liveAccount.credentials.password')}
                      aria-label={t('liveAccount.credentials.password')}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${fieldClass} ${PASSWORD_REVEAL_PAD}`}
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="done"
                      disabled={testing}
                    />
                  </div>
                </div>
              </div>
            )}

            {pinMode ? (
              <Button
                type="submit"
                variant="gold"
                {...focusProps('cf-pin-submit')}
                disabled={testing}
                className="w-full mt-4 rounded-lg h-10 transition-transform duration-150 ease-out"
              >
                {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                <span className="min-w-0 truncate">{testing ? t('liveAccount.credentials.signingIn') : t('liveAccount.credentials.signIn')}</span>
              </Button>
            ) : (
              <div className="flex mt-4">
                <Button
                  type="submit"
                  variant="gold"
                  {...focusProps('cf-submit')}
                  data-howto="signin.submit"
                  disabled={testing}
                  className="flex-1 min-w-0 rounded-lg h-10 transition-transform duration-150 ease-out"
                >
                  {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  <span className="min-w-0 truncate">{testing ? t('liveAccount.credentials.signingIn') : t('liveAccount.credentials.signIn')}</span>
                </Button>
                {onCancel && (
                  <Button
                    type="button"
                    variant="white"
                    onClick={onCancel}
                    {...focusProps('cf-cancel')}
                    disabled={testing}
                    className="ml-2.5 rounded-lg h-10 px-6 transition-transform duration-150 ease-out"
                  >
                    {t('common.cancel')}
                  </Button>
                )}
              </div>
            )}

            {testing && (
              <div className="mt-2.5 flex items-center text-brand-ice/90 font-nunito text-sm">
                <Loader2 className="w-4 h-4 mr-2 shrink-0 animate-spin text-brand-gold" />
                <span className="min-w-0 truncate">
                  {probingServer ? t('liveAccount.credentials.checking', { server: probingServer.label }) : t('liveAccount.credentials.connecting')}
                </span>
              </div>
            )}
          </div>

          {/* ── Right, a lighter panel: other ways in, and the small print ── */}
          <div
            className="mt-4 sm:mt-0 sm:ml-6 sm:w-[360px] shrink-0 flex flex-col rounded-xl bg-white/[0.06] border border-white/10 px-3.5 py-3.5"
            data-creds-side
          >
            {(pinMode || showPinOption || showStart) && (
              <p className="text-brand-ice/70 font-nunito text-xs font-semibold uppercase tracking-wider mb-2.5">
                {t('liveAccount.credentials.otherWays')}
              </p>
            )}
            {pinMode ? (
              <Button
                type="button"
                variant="white"
                onClick={leavePinMode}
                {...focusProps('cf-pin-back')}
                disabled={testing}
                className={sideButtonClass}
              >
                <UserRound className="w-4 h-4 mr-2 shrink-0 text-brand-gold" />
                <span className="min-w-0 text-center leading-snug">{t('liveAccount.credentials.pin.back')}</span>
              </Button>
            ) : (
              <>
                {showPinOption && (
                  <Button
                    type="button"
                    variant="white"
                    onClick={() => { setShowPassword(false); setShowPin(false); setPin(''); setPinMode(true); }}
                    {...focusProps('cf-pin')}
                    disabled={testing}
                    className={sideButtonClass}
                  >
                    <KeyRound className="w-4 h-4 mr-2 shrink-0 text-brand-gold" />
                    <span className="min-w-0 text-center leading-snug">{t('liveAccount.credentials.pin.signInWithPin')}</span>
                  </Button>
                )}
                {showStart && (
                  <Button
                    type="button"
                    variant="white"
                    onClick={() => { openedFromRef.current = 'cf-start'; setShowPassword(false); setChildOpen(true); }}
                    {...focusProps('cf-start')}
                    disabled={testing}
                    // The way in for someone with no login yet: the whole line
                    // shows, wrapping on a narrow screen rather than cut off.
                    className={`${sideButtonClass} ${showPinOption ? 'mt-2' : ''}`}
                  >
                    <Sparkles className="w-4 h-4 mr-2 shrink-0 text-brand-gold" />
                    <span className="min-w-0 text-center leading-snug">{pending ? t('liveAccount.credentials.finishSetup', { label: pending.label }) : t('liveAccount.credentials.getStarted')}</span>
                  </Button>
                )}
              </>
            )}
            <p className="text-brand-ice/60 text-xs leading-snug font-nunito mt-auto pt-3" data-howto="signin.note">
              {pinMode ? t('liveAccount.credentials.pin.note') : t('liveAccount.credentials.note')}
            </p>
          </div>
        </div>
      </form>
    </div>
  );
});

CredentialsForm.displayName = 'CredentialsForm';
export default CredentialsForm;
