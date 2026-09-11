import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tv, Loader2, Sparkles } from 'lucide-react';
import {
  authenticateRouted,
  pickServerForUsername,
  saveCreds,
  savePlayerAccount,
  buildPlayerAccount,
  upsertSavedAccount,
  savedAccountId,
  daysUntilExp,
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
}

const CredentialsForm = memo(({ initial, onSaved, onCancel, onChildOpenChange }: Props) => {
  const [username, setUsername] = useState(initial?.username || '');
  const [password, setPassword] = useState(initial?.password || '');
  const [testing, setTesting] = useState(false);
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
  const showStart = !isDemo() && (billingOn || vibezOn);
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
  const navigation = useMemo<TVFocusNavigationMap>(() => ({
    'cf-user':   { down: 'cf-pass' },
    'cf-pass':   { up: 'cf-user', down: 'cf-submit' },
    'cf-submit': { up: 'cf-pass', right: hasCancel ? 'cf-cancel' : undefined, down: showStart ? 'cf-start' : undefined },
    'cf-cancel': { up: 'cf-pass', left: 'cf-submit', down: showStart ? 'cf-start' : undefined },
    // Only `up` is pinned. Left/right/down are left undefined so useTVFocus
    // falls through to spatial search — a `null` here would swallow the key
    // and make this button a dead end the viewer cannot leave sideways.
    'cf-start':  { up: 'cf-submit' },
  }), [hasCancel, showStart]);

  const { containerRef, focusById, focusProps } = useTVFocus({
    enabled: !childOpen,
    navigation,
    initialFocusId: 'cf-user',
    onBack: () => onCancel?.(),
    scrollBlock: 'center',
  });
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

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!username || !password) {
      toast({ title: 'Missing info', description: 'Please enter your username and password.', variant: 'destructive' });
      return;
    }
    setTesting(true);
    const routedServer = pickServerForUsername(username);
    setProbingServer(routedServer);
    try {
      const result = await authenticateRouted(username, password, (s) => setProbingServer(s));
      if (!result.ok || !result.creds) {
        toast({
          title: 'Could not sign in',
          description: result.error || 'Invalid username or password.',
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
                title: 'Account loaded',
                description: r.emailMasked
                  ? `Also signed into your Snow Media account (${r.emailMasked}).`
                  : 'Also signed into your Snow Media account.',
              });
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
      toast({ title: 'Connected', description: `Signed in to ${result.server?.label}.` });
      onSaved(result.creds);
    } catch (err) {
      toast({
        title: 'Could not connect',
        description: (err as Error).message || 'Please check your credentials and try again.',
        variant: 'destructive',
      });
    } finally {
      setTesting(false);
      setProbingServer(null);
    }
  };

  if (childOpen) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-brand-gold" /></div>}>
        <GetStartedFlow
          vibezEnabled={vibezOn}
          onDone={(c) => {
            setChildOpen(false);
            toast({ title: 'Connected', description: `Signed in to ${c.serverLabel || 'your service'}.` });
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
        onSubmit={submit}
        className="w-full max-w-xl rounded-3xl p-8 [background:var(--gradient-navy)] shadow-2xl border border-white/10"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-14 h-14 rounded-2xl bg-brand-gold/20 flex items-center justify-center">
            <Tv className="w-8 h-8 text-brand-gold" />
          </div>
          <div>
            <h2 className="text-2xl font-quicksand font-bold text-white">Sign in to Player</h2>
            <p className="text-brand-ice/70 font-nunito text-sm">
              Use your subscription username & password
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lt-user" className="text-brand-ice font-nunito">Username</Label>
            <Input
              id="lt-user"
              {...focusProps('cf-user')}
              placeholder="Username"
              aria-label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="rounded-xl h-12 bg-black/30 text-white border-white/20 focus-visible:ring-0 focus-visible:ring-offset-0"
              autoComplete="off"
              disabled={testing}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lt-pass" className="text-brand-ice font-nunito">Password</Label>
            <Input
              id="lt-pass"
              {...focusProps('cf-pass')}
              data-tv-allow-enter="true"
              type="password"
              placeholder="Password"
              aria-label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-xl h-12 bg-black/30 text-white border-white/20 focus-visible:ring-0 focus-visible:ring-offset-0"
              autoComplete="off"
              disabled={testing}
            />
          </div>
        </div>

        {testing && (
          <div className="mt-4 flex items-center gap-3 text-brand-ice/90 font-nunito text-sm">
            <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />
            <span>
              {probingServer ? `Checking ${probingServer.label}…` : 'Connecting…'}
            </span>
          </div>
        )}

        <div className="flex gap-3 mt-8">
          <Button
            type="submit"
            variant="gold"
            {...focusProps('cf-submit')}
            disabled={testing}
            className="flex-1 rounded-xl h-12 transition-transform duration-150 ease-out"
          >
            {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {testing ? 'Signing in…' : 'Sign In'}
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
              Cancel
            </Button>
          )}
        </div>

        {showStart && (
          <Button
            type="button"
            variant="white"
            onClick={() => { openedFromRef.current = 'cf-start'; setChildOpen(true); }}
            {...focusProps('cf-start')}
            disabled={testing}
            className="w-full mt-3 rounded-xl h-12 transition-transform duration-150 ease-out"
          >
            <Sparkles className="w-4 h-4 mr-2 text-brand-gold" />
            {pending ? `Finish setting up ${pending.label}` : 'New here? Get started'}
          </Button>
        )}

        <p className="text-brand-ice/60 text-xs font-nunito mt-4">
          Email usernames connect to Vibez; all other usernames connect to Dreamstreams.
          Your credentials are stored only on this device.
        </p>
      </form>
    </div>
  );
});

CredentialsForm.displayName = 'CredentialsForm';
export default CredentialsForm;
