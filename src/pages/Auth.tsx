import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, User, Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

/**
 * Where a password-reset link lands.
 *
 * NOT the app's snowmedia:// scheme: a reset link is opened from an inbox, on
 * whatever device the person is holding, and a phone's mail client cannot open
 * a custom scheme belonging to a TV app. The website's own reset page can
 * handle it on any device — which is also where they would go if they had
 * started from the site.
 */
const PASSWORD_RESET_REDIRECT = 'https://snowmediaent.com/auth';
import { trackEvent } from '@/lib/analytics';
import { signInWithPlayerCredentials, looksLikeEmail } from '@/lib/playerLogin';
import { BackButton } from '@/components/ui/BackButton';
import { onFieldActionKey } from '@/utils/fieldEnter';
// A tapped button keeps the typing box's focus (phones; Tronix aa7b541).
import { keepTypingFocus } from '@/utils/keepTypingFocus';

type Step = 'email' | 'password' | 'create';
type FocusEl =
  | 'back'
  | 'email'
  | 'continue'
  | 'skip'
  | 'password'
  | 'submit'
  | 'change-email'
  | 'forgot'
  | 'name'
  | 'confirm';

// Which highlight a field or button belongs to, so the keyboard's action key
// (Next / Done) can move the ring along with the focus it moves.
const FOCUS_FOR_ID: Record<string, FocusEl> = {
  'auth-email': 'email',
  'auth-continue': 'continue',
  'login-password': 'password',
  'login-submit': 'submit',
  'signup-name': 'name',
  'signup-password': 'password',
  'signup-confirm': 'confirm',
  'signup-submit': 'submit',
};

const markPostAuthView = () => {
  try {
    sessionStorage.setItem('post_auth_view', 'user');
  } catch {
    /* ignore */
  }
};

const Auth = () => {
  const navigate = useNavigate();
  const { signIn, signUp, user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [step, setStep] = useState<Step>('email');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  // Set once a reset email has gone out, so the link stops inviting repeat
  // presses — a second request invalidates the first link, which is exactly the
  // thing that leaves someone with a dead link in their inbox.
  const [resetSent, setResetSent] = useState(false);
  const [signupForm, setSignupForm] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: ''
  });

  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      navigate('/');
    }
  }, [user, navigate]);

  // TV remote navigation with focus handling
  const [focusedElement, setFocusedElement] = useState<FocusEl>('email');

  // The keyboard's Done / Go / Next on a field: on to the next field, or after
  // the last one close the keyboard and land on the form's button. It never
  // submits — the button is the viewer's to press.
  const onFieldKey = (buttonId?: string) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    onFieldActionKey(e, {
      buttonId,
      onLand: (el) => { const f = FOCUS_FOR_ID[el.id]; if (f) setFocusedElement(f); },
    });
  };

  const handleSkip = () => {
    try {
      trackEvent('auth_skip', 'auth');
    } catch {
      /* ignore */
    }
    navigate('/');
  };

  /**
   * Password reset, the same one the website offers.
   *
   * Supabase sends a link, so the actual reset happens in a browser or on a
   * phone — a TV is a bad place to type a new password anyway. The redirect
   * matches the app's own confirmation target so a device that CAN follow it
   * lands back in SMC rather than nowhere.
   */
  const handleForgotPassword = async () => {
    const email = loginForm.email.trim();
    if (!email) {
      toast({ title: t('auth.toast.enterEmailTitle'), description: t('auth.toast.enterEmailDesc'), variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: PASSWORD_RESET_REDIRECT,
      });
      if (error) throw error;
      setResetSent(true);
      toast({
        title: t('auth.toast.resetSentTitle'),
        description: t('auth.toast.resetSentDesc', { email }),
      });
    } catch (e) {
      toast({
        title: t('auth.toast.resetFailTitle'),
        description: (e as Error)?.message || t('auth.toast.tryAgainDesc'),
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleContinue = async () => {
    const email = loginForm.email.trim();
    if (!email) return;
    // Streaming usernames aren't emails (and Vibez ones merely contain '@').
    // Anything that can't be an email goes straight to the password step,
    // where handleLogin will try the player-login bridge — never to "create".
    if (!looksLikeEmail(email)) {
      setStep('password');
      return;
    }
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-account-email', {
        body: { email },
      });
      if (error) throw error;
      const exists = (data as { exists?: string } | null)?.exists;
      if (exists === 'app') {
        setStep('password');
      } else {
        setStep('create');
      }
    } catch (err) {
      console.warn('[Auth Page] Email check failed, defaulting to create:', err);
      setStep('create');
    } finally {
      setChecking(false);
    }
  };

  // Keep both forms' email in sync from step 1
  useEffect(() => {
    setSignupForm((prev) => ({ ...prev, email: loginForm.email }));
  }, [loginForm.email]);

  // Reset focus to the step's first input on every step change
  useEffect(() => {
    if (step === 'email') setFocusedElement('email');
    else if (step === 'password') setFocusedElement('password');
    else setFocusedElement('name');
  }, [step]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip navigation handling when user is typing in an input or textarea
      const target = event.target as HTMLElement;
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Allow Backspace when typing
      if (event.key === 'Backspace' && isTyping) {
        return; // Let the default behavior happen
      }

      // Handle Android back button and other back buttons (but not Backspace when typing)
      if (event.key === 'Escape' || event.keyCode === 4 || event.which === 4 || event.code === 'GoBack') {
        event.preventDefault();
        event.stopPropagation();
        if (step === 'password' || step === 'create') {
          setStep('email');
          setFocusedElement('email');
        } else {
          navigate('/');
        }
        return;
      }

      // Skip navigation when typing
      if (isTyping) {
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }

      const chain: FocusEl[] =
        step === 'email'
          ? ['back', 'email', 'continue', 'skip']
          : step === 'password'
            ? ['back', 'password', 'submit', 'forgot', 'change-email']
            : ['back', 'name', 'password', 'confirm', 'submit', 'skip'];

      switch (event.key) {
        case 'ArrowUp': {
          const i = chain.indexOf(focusedElement);
          if (i > 0) setFocusedElement(chain[i - 1]);
          break;
        }

        case 'ArrowDown': {
          const i = chain.indexOf(focusedElement);
          if (i >= 0 && i < chain.length - 1) setFocusedElement(chain[i + 1]);
          break;
        }

        case 'Enter':
        case ' ':
          if (focusedElement === 'back') {
            if (step === 'password' || step === 'create') {
              setStep('email');
              setFocusedElement('email');
            } else {
              navigate('/');
            }
          } else if (focusedElement === 'continue') {
            void handleContinue();
          } else if (focusedElement === 'skip') {
            handleSkip();
          } else if (focusedElement === 'forgot') {
            void handleForgotPassword();
          } else if (focusedElement === 'change-email') {
            setStep('email');
            setFocusedElement('email');
          } else if (focusedElement === 'email' || focusedElement === 'password' || focusedElement === 'name' || focusedElement === 'confirm') {
            const idMap: Record<string, string> = {
              email: 'auth-email',
              password: step === 'password' ? 'login-password' : 'signup-password',
              name: 'signup-name',
              confirm: 'signup-confirm',
            };
            const input = document.getElementById(idMap[focusedElement]) as HTMLInputElement | null;
            if (input) input.focus();
          } else if (focusedElement === 'submit') {
            const form = document.querySelector('form') as HTMLFormElement | null;
            if (form) form.requestSubmit();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, focusedElement, step, loginForm.email]);

  // Keep the focused element in view (TV / STB scrolling fix)
  useEffect(() => {
    const idMap: Record<string, string> = {
      'back': 'auth-back',
      'email': 'auth-email',
      'continue': 'auth-continue',
      'skip': step === 'create' ? 'auth-skip-2' : 'auth-skip',
      'password': step === 'password' ? 'login-password' : 'signup-password',
      'submit': step === 'password' ? 'login-submit' : 'signup-submit',
      'change-email': 'auth-change-email',
      'forgot': 'auth-forgot',
      'name': 'signup-name',
      'confirm': 'signup-confirm',
    };
    const el = document.getElementById(idMap[focusedElement]);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // Auto-focus input fields so user can type immediately
      if (el.tagName === 'INPUT' && document.activeElement !== el) {
        (el as HTMLInputElement).focus();
      }
    }
  }, [focusedElement, step]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      console.log('[Auth Page] Attempting login for:', loginForm.email);

      const { error } = await signIn(loginForm.email, loginForm.password);

      if (error) {
        console.error('[Auth Page] Login error:', error.message);

        // Not a website login? These may be STREAMING credentials. If the
        // line is linked to an app account, the bridge verifies against the
        // panel server-side and signs that account in.
        const bridged = await signInWithPlayerCredentials(loginForm.email, loginForm.password);
        if (bridged.ok) {
          toast({
            title: t('auth.toast.welcomeBackTitle'),
            description: bridged.emailMasked
              ? t('auth.toast.streamingSignedInMasked', { masked: bridged.emailMasked })
              : t('auth.toast.streamingSignedIn'),
          });
          markPostAuthView();
          navigate('/');
          setLoading(false);
          return;
        }
        if (bridged.reason === 'not_linked') {
          toast({
            title: t('auth.toast.loginFailedTitle'),
            description: t('auth.toast.notLinkedDesc'),
            variant: 'destructive',
          });
          setLoading(false);
          return;
        }

        toast({
          title: t('auth.toast.loginFailedTitle'),
          description: error.message || t('auth.toast.invalidCredsDesc'),
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      console.log('[Auth Page] Login successful, checking session...');

      // Verify session was created
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        console.log('[Auth Page] Session confirmed for:', session.user?.email);
        toast({
          title: t('auth.toast.welcomeBackTitle'),
          description: t('auth.toast.loggedInDesc'),
        });
        markPostAuthView();
        navigate('/');
      } else {
        console.warn('[Auth Page] No session after login');
        toast({
          title: t('auth.toast.loginIssueTitle'),
          description: t('auth.toast.loginIssueDesc'),
        });
      }
    } catch (error) {
      console.error('[Auth Page] Login exception:', error);
      toast({
        title: t('auth.toast.loginFailedTitle'),
        description: t('auth.toast.unexpectedLoginDesc'),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    if (signupForm.password !== signupForm.confirmPassword) {
      toast({
        title: t('auth.toast.passwordMismatchTitle'),
        description: t('auth.toast.passwordMismatchDesc'),
        variant: "destructive",
      });
      return;
    }

    if (signupForm.password.length < 6) {
      toast({
        title: t('auth.toast.passwordShortTitle'),
        description: t('auth.toast.passwordShortDesc'),
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const { error, data } = await signUp(
        signupForm.email,
        signupForm.password,
        signupForm.fullName
      );

      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('user already')) {
          toast({
            title: t('auth.toast.existsTitle'),
            description: t('auth.toast.existsDesc'),
            variant: "destructive",
          });
          setLoginForm((prev) => ({ ...prev, email: signupForm.email }));
          
          setStep('password');
        } else {
          toast({
            title: t('auth.toast.signupFailedTitle'),
            description: error.message,
            variant: "destructive",
          });
        }
      } else {
        markPostAuthView();
        // Auto-confirm / confirmations disabled → session exists immediately.
        if (data?.session) {
          toast({
            title: t('auth.toast.accountCreatedTitle'),
            description: t('auth.toast.accountCreatedSignedIn'),
          });
        } else {
          toast({
            title: t('auth.toast.accountCreatedTitle'),
            description: t('auth.toast.accountCreatedCheckEmail'),
          });
        }
      }
    } catch (error) {
      console.error('[Auth] Signup error:', error);
      toast({
        title: t('auth.toast.signupFailedTitle'),
        description: t('auth.toast.unexpectedSignupDesc'),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Named here so the screen below reads as plain layout.
  const onEmailStep = step === 'email';
  const onPasswordStep = step === 'password';
  const onCreateStep = step === 'create';

  return (
    <div
      className="fixed inset-0 text-white px-[5vw] py-[4vh] overflow-y-auto"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
    >
      {/* Back Button — normal flow at the top-left of the page content.
          Literal class string rather than BACK_ROW so the tighter bottom
          margin is not fighting BACK_ROW's own mb-6 on source order. */}
      <div className="flex items-center w-full justify-start mb-4">
        <BackButton
          id="auth-back"
          onClick={() => {
            if (step === 'password' || step === 'create') {
              setStep('email');
              setFocusedElement('email');
            } else {
              navigate('/');
            }
          }}
          label={t('common.backToHome')}
          focused={focusedElement === 'back'}
        />
      </div>

      <div className="max-w-2xl mx-auto">



        {onEmailStep && (
          <div className="text-center mb-3">
            <h1 className="text-3xl font-bold leading-tight bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Snow Media Center
            </h1>
            <p className="text-base text-blue-200">{t('auth.page.tagline')}</p>
          </div>
        )}

        <Card className="bg-gradient-to-br from-blue-600/20 to-blue-800/20 border-blue-500/50 backdrop-blur-sm p-5">
          {/* ===== STEP 1: EMAIL ===== */}
          {onEmailStep && (
            <div className="space-y-3">
              <p className="text-xs text-blue-200/90 bg-blue-950/40 border border-blue-500/30 rounded-md p-3">
                {t('auth.page.websiteNotice')}
              </p>


              <div>
                <Label htmlFor="auth-email" className="text-white">{t('auth.page.emailLabel')}</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                  <Input
                    id="auth-email"
                    type="email"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                    onKeyDown={onFieldKey('auth-continue')}
                    enterKeyHint="go"
                    placeholder={t('auth.page.emailPlaceholder')}
                    className={`pl-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600 transition-all duration-200 ${
                      focusedElement === 'email' ? 'ring-4 ring-blue-400/60' : ''
                    }`}
                    required
                  />
                </div>
              </div>

              <Button
                id="auth-continue"
                type="button"
                onClick={() => void handleContinue()}
                disabled={checking || !loginForm.email.trim()}
                className={`w-full bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 ${
                  focusedElement === 'continue' ? 'ring-4 ring-white/60' : ''
                }`}
              >
                {checking ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('auth.page.checking')}
                  </span>
                ) : t('auth.page.continueBtn')}
              </Button>

              <Button
                id="auth-skip"
                type="button"
                variant="outline"
                onClick={handleSkip}
                className={`w-full bg-blue-600/20 hover:bg-blue-500/30 border-blue-400/50 text-white transition-all duration-200 ${
                  focusedElement === 'skip' ? 'ring-4 ring-white/60' : ''
                }`}
              >
                <span className="min-w-0 truncate">{t('auth.page.skipBtn')}</span>
              </Button>
            </div>
          )}

          {/* ===== STEP 2: PASSWORD ===== */}
          {onPasswordStep && (
            <form onSubmit={handleLogin} onMouseDown={keepTypingFocus} className="space-y-3">
              <p className="text-xs text-blue-200/90 bg-blue-950/40 border border-blue-500/30 rounded-md p-3">
                {t('auth.page.welcomeBackNote')}
              </p>

              <div>
                <Label className="text-white">{t('auth.page.emailLabel')}</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                  <Input
                    type="email"
                    value={loginForm.email}
                    readOnly
                    className="pl-10 bg-white/70 border-white/20 text-black"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="login-password" className="text-white">{t('auth.page.passwordLabel')}</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                  <Input
                    id="login-password"
                    type={showLoginPassword ? "text" : "password"}
                    value={loginForm.password}
                    onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    onKeyDown={onFieldKey()}
                    enterKeyHint="done"
                    placeholder={t('auth.page.passwordPlaceholder')}
                    className={`pl-10 pr-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600 transition-all duration-200 ${
                      focusedElement === 'password' ? 'ring-4 ring-blue-400/60' : ''
                    }`}
                    required
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute right-3 top-3 text-blue-600 hover:text-blue-700 z-10"
                  >
                    {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                id="login-submit"
                type="submit"
                disabled={loading}
                className={`w-full bg-blue-600 hover:bg-blue-700 text-white transition-all duration-200 ${
                  focusedElement === 'submit' ? 'ring-4 ring-white/60' : ''
                }`}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('auth.page.signingIn')}
                  </span>
                ) : t('auth.page.signInSubmit')}
              </Button>

              <button
                id="auth-forgot"
                type="button"
                onClick={() => void handleForgotPassword()}
                disabled={resetSent || loading}
                className={`w-full text-sm text-blue-300 hover:text-blue-100 underline transition-all duration-200 disabled:opacity-60 disabled:no-underline ${
                  focusedElement === 'forgot' ? 'ring-4 ring-white/60 rounded' : ''
                }`}
              >
                {resetSent ? t('auth.page.resetSentNote') : t('auth.page.forgotLink')}
              </button>

              <button
                id="auth-change-email"
                type="button"
                onClick={() => { setStep('email'); setFocusedElement('email'); }}
                className={`w-full text-sm text-blue-300 hover:text-blue-100 underline transition-all duration-200 ${
                  focusedElement === 'change-email' ? 'ring-4 ring-white/60 rounded' : ''
                }`}
              >
                {t('auth.page.changeEmailLink')}
              </button>
            </form>
          )}

          {/* ===== STEP 3: CREATE ===== */}
          {onCreateStep && (
            <form onSubmit={handleSignup} onMouseDown={keepTypingFocus} className="space-y-2.5">
              <div>
                <h2 className="text-base font-semibold text-white mb-1.5">{t('auth.page.createTitle')}</h2>
                <p className="text-xs text-blue-200/90 bg-blue-950/40 border border-blue-500/30 rounded-md p-3">
                  {t('auth.page.noAccount', { email: signupForm.email || loginForm.email })}
                </p>
              </div>

              <div>
                <Label htmlFor="signup-name" className="text-white">{t('auth.page.fullNameLabel')}</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                  <Input
                    id="signup-name"
                    type="text"
                    value={signupForm.fullName}
                    onChange={(e) => setSignupForm({ ...signupForm, fullName: e.target.value })}
                    onKeyDown={onFieldKey()}
                    enterKeyHint="next"
                    placeholder={t('auth.page.fullNamePlaceholder')}
                    className={`pl-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600 transition-all duration-200 ${
                      focusedElement === 'name' ? 'ring-4 ring-blue-400/60' : ''
                    }`}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="signup-password" className="text-white">{t('auth.page.passwordLabel')} <span className="text-blue-300/80 font-normal">{t('auth.page.passwordHint')}</span></Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                  <Input
                    id="signup-password"
                    type={showSignupPassword ? "text" : "password"}
                    value={signupForm.password}
                    onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })}
                    onKeyDown={onFieldKey()}
                    enterKeyHint="next"
                    placeholder={t('auth.page.createPasswordPlaceholder')}
                    className={`pl-10 pr-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600 transition-all duration-200 ${
                      focusedElement === 'password' ? 'ring-4 ring-blue-400/60' : ''
                    }`}
                    required
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowSignupPassword(!showSignupPassword)}
                    className="absolute right-3 top-3 text-blue-600 hover:text-blue-700 z-10"
                  >
                    {showSignupPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div>
                <Label htmlFor="signup-confirm" className="text-white">{t('auth.page.confirmLabel')}</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                  <Input
                    id="signup-confirm"
                    type={showConfirmPassword ? "text" : "password"}
                    value={signupForm.confirmPassword}
                    onChange={(e) => setSignupForm({ ...signupForm, confirmPassword: e.target.value })}
                    onKeyDown={onFieldKey()}
                    enterKeyHint="done"
                    placeholder={t('auth.page.confirmPlaceholder')}
                    className={`pl-10 pr-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600 transition-all duration-200 ${
                      focusedElement === 'confirm' ? 'ring-4 ring-blue-400/60' : ''
                    }`}
                    required
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-3 text-blue-600 hover:text-blue-700 z-10"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                id="signup-submit"
                type="submit"
                disabled={loading}
                className={`w-full bg-purple-600 hover:bg-purple-700 text-white transition-all duration-200 ${
                  focusedElement === 'submit' ? 'ring-4 ring-white/60' : ''
                }`}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('auth.page.creating')}
                  </span>
                ) : t('auth.page.createBtn')}
              </Button>

              <Button
                id="auth-skip-2"
                type="button"
                variant="outline"
                onClick={handleSkip}
                className={`w-full bg-blue-600/20 hover:bg-blue-500/30 border-blue-400/50 text-white transition-all duration-200 ${
                  focusedElement === 'skip' ? 'ring-4 ring-white/60' : ''
                }`}
              >
                <span className="min-w-0 truncate">{t('auth.page.skipBtn')}</span>
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Auth;
