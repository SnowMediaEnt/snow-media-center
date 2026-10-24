import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tv, Loader2, Sparkles, KeyRound } from 'lucide-react';
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
  const hasCancel = !!onCancel;
  const navigation = useMemo<TVFocusNavigationMap>(() => {
    // Below the Sign in row: Sign in with a PIN (when offered), then Get started.
    const belowSubmit = showPinOption ? 'cf-pin' : showStart ? 'cf-start' : undefined;
    return {
      // Right stays put: the nearest thing to the right is the password's Show, a row down.
      'cf-user':   { down: 'cf-pass', right: null },
      'cf-pass':   { up: 'cf-user', down: 'cf-submit', right: 'cf-pass-show' },
      // Show / Hide inside the password box: Up / Down go where the box's go,
      // Left back to it, Right stays (spatial search would reach Cancel).
      'cf-pass-show': { up: 'cf-user', down: 'cf-submit', left: 'cf-pass', right: null },
      'cf-submit': { up: 'cf-pass', right: hasCancel ? 'cf-cancel' : undefined, down: belowSubmit },
      'cf-cancel': { up: 'cf-pass', left: 'cf-submit', down: belowSubmit },
      'cf-pin':    { up: 'cf-submit', down: showStart ? 'cf-start' : null, left: null, right: null },
      // Only `up` is pinned. Left/right/down are left undefined so useTVFocus
      // falls through to spatial search — a `null` here would swallow the key
      // and make this button a dead end the viewer cannot leave sideways.
      'cf-start':  { up: showPinOption ? 'cf-pin' : 'cf-submit' },
      // The PIN screen: the field (its Show / Hide on the right), Sign in,
      // then the way back to username and password.
      'cf-pin-input':  { up: null, down: 'cf-pin-submit', left: null, right: 'cf-pin-show' },
      'cf-pin-show':   { up: null, down: 'cf-pin-submit', left: 'cf-pin-input', right: null },
      'cf-pin-submit': { up: 'cf-pin-input', down: 'cf-pin-back', left: null, right: null },
      'cf-pin-back':   { up: 'cf-pin-submit', down: null, left: null, right: null },
    };
  }, [hasCancel, showStart, showPinOption]);

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

  return (
    <div ref={containerRef} className="min-h-screen flex items-center justify-center px-6 py-12">
      <form
        onSubmit={pinMode ? submitPin : submit}
        // A tapped button keeps the typing box's focus (phones: the keyboard
        // stays up and the form doesn't jump from under the finger).
        onMouseDown={keepTypingFocus}
        data-creds-form
        className="w-full max-w-xl rounded-3xl p-8 [background:var(--gradient-navy)] shadow-2xl border border-white/10"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-brand-gold/20 flex items-center justify-center">
            <Tv className="w-8 h-8 text-brand-gold" />
          </div>
          <div>
            <h2 className="text-2xl font-quicksand font-bold text-white">{t('liveAccount.credentials.title')}</h2>
            <p className="text-brand-ice/70 font-nunito text-sm">
              {pinMode ? t('liveAccount.credentials.pin.subtitle') : t('liveAccount.credentials.subtitle')}
            </p>
          </div>
        </div>

        {pinMode ? (
          <div className="space-y-2">
            <Label htmlFor="lt-pin" className="text-brand-ice font-nunito">{t('liveAccount.credentials.pin.label')}</Label>
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
                className={`rounded-xl h-12 bg-black/30 text-white text-lg tracking-widest border-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 ${PASSWORD_REVEAL_PAD}`}
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
          <div className="space-y-4">
            <div className="space-y-2" data-howto="signin.username">
              <Label htmlFor="lt-user" className="text-brand-ice font-nunito">{t('liveAccount.credentials.username')}</Label>
              <Input
                id="lt-user"
                {...focusProps('cf-user')}
                placeholder={t('liveAccount.credentials.username')}
                aria-label={t('liveAccount.credentials.username')}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="rounded-xl h-12 bg-black/30 text-white border-white/20 focus-visible:ring-0 focus-visible:ring-offset-0"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                disabled={testing}
              />
            </div>
            <div className="space-y-2" data-howto="signin.password">
              <Label htmlFor="lt-pass" className="text-brand-ice font-nunito">{t('liveAccount.credentials.password')}</Label>
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
                  className={`rounded-xl h-12 bg-black/30 text-white border-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 ${PASSWORD_REVEAL_PAD}`}
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

        {testing && (
          <div className="mt-4 flex items-center gap-3 text-brand-ice/90 font-nunito text-sm">
            <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />
            <span>
              {probingServer ? t('liveAccount.credentials.checking', { server: probingServer.label }) : t('liveAccount.credentials.connecting')}
            </span>
          </div>
        )}

        {pinMode ? (
          <>
            <Button
              type="submit"
              variant="gold"
              {...focusProps('cf-pin-submit')}
              disabled={testing}
              className="w-full mt-8 rounded-xl h-12 transition-transform duration-150 ease-out"
            >
              {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              <span className="min-w-0 truncate">{testing ? t('liveAccount.credentials.signingIn') : t('liveAccount.credentials.signIn')}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={leavePinMode}
              {...focusProps('cf-pin-back')}
              disabled={testing}
              className="w-full mt-3 rounded-xl min-h-12 h-auto py-2 whitespace-normal text-brand-ice underline underline-offset-4 hover:bg-white/10 hover:text-white"
            >
              <span className="min-w-0 text-center leading-snug">{t('liveAccount.credentials.pin.back')}</span>
            </Button>
          </>
        ) : (
          <>
          <div className="flex gap-3 mt-8">
            <Button
              type="submit"
              variant="gold"
              {...focusProps('cf-submit')}
              data-howto="signin.submit"
              disabled={testing}
              className="flex-1 rounded-xl h-12 transition-transform duration-150 ease-out"
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
                className="rounded-xl h-12 transition-transform duration-150 ease-out"
              >
                {t('common.cancel')}
              </Button>
            )}
          </div>

          {showPinOption && (
            <Button
              type="button"
              variant="white"
              onClick={() => { setShowPassword(false); setShowPin(false); setPin(''); setPinMode(true); }}
              {...focusProps('cf-pin')}
              disabled={testing}
              className="w-full mt-3 rounded-xl min-h-12 h-auto py-2 whitespace-normal transition-transform duration-150 ease-out"
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
              // The way in for someone with no login yet: the whole line shows,
              // wrapping on a narrow screen rather than cut off.
              className="w-full mt-3 rounded-xl min-h-12 h-auto py-2 whitespace-normal transition-transform duration-150 ease-out"
            >
              <Sparkles className="w-4 h-4 mr-2 shrink-0 text-brand-gold" />
              <span className="min-w-0 text-center leading-snug">{pending ? t('liveAccount.credentials.finishSetup', { label: pending.label }) : t('liveAccount.credentials.getStarted')}</span>
            </Button>
          )}
          </>
        )}

        <p className="text-brand-ice/60 text-xs font-nunito mt-4" data-howto="signin.note">
          {pinMode ? t('liveAccount.credentials.pin.note') : t('liveAccount.credentials.note')}
        </p>
      </form>
    </div>
  );
});

CredentialsForm.displayName = 'CredentialsForm';
export default CredentialsForm;
