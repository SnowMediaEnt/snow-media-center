import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, User, Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { trackEvent } from '@/lib/analytics';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';

type Step = 'email' | 'password' | 'create';
type FocusEl =
  | 'back'
  | 'email'
  | 'continue'
  | 'skip'
  | 'password'
  | 'submit'
  | 'change-email'
  | 'name'
  | 'confirm';

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

  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [step, setStep] = useState<Step>('email');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
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

  const handleSkip = () => {
    try {
      trackEvent('auth_skip', 'auth');
    } catch {
      /* ignore */
    }
    navigate('/');
  };

  const handleContinue = async () => {
    const email = loginForm.email.trim();
    if (!email) return;
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
            ? ['back', 'password', 'submit', 'change-email']
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

        toast({
          title: "Login failed",
          description: error.message || "Invalid email or password.",
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
          title: "Welcome back!",
          description: "Successfully logged in.",
        });
        markPostAuthView();
        navigate('/');
      } else {
        console.warn('[Auth Page] No session after login');
        toast({
          title: "Login issue",
          description: "Please check your email to confirm your account.",
        });
      }
    } catch (error) {
      console.error('[Auth Page] Login exception:', error);
      toast({
        title: "Login failed",
        description: "An unexpected error occurred. Please try again.",
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
        title: "Password mismatch",
        description: "Passwords do not match.",
        variant: "destructive",
      });
      return;
    }

    if (signupForm.password.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters long.",
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
            title: "Account already exists",
            description: "This email is already registered. Please sign in instead, or use 'Forgot password' to reset it.",
            variant: "destructive",
          });
          setLoginForm((prev) => ({ ...prev, email: signupForm.email }));
          
          setStep('password');
        } else {
          toast({
            title: "Signup failed",
            description: error.message,
            variant: "destructive",
          });
        }
      } else {
        markPostAuthView();
        // Auto-confirm / confirmations disabled → session exists immediately.
        if (data?.session) {
          toast({
            title: "Account created!",
            description: "You're signed in.",
          });
        } else {
          toast({
            title: "Account created!",
            description: "Check your email to confirm your account.",
          });
        }
      }
    } catch (error) {
      console.error('[Auth] Signup error:', error);
      toast({
        title: "Signup failed",
        description: "An unexpected error occurred.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white px-[5vw] py-[4vh] overflow-y-auto"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 6rem)' }}
    >
      {/* Back Button — normal flow at the top-left of the page content */}
      <div className={BACK_ROW}>
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
          label="Back to Home"
          focused={focusedElement === 'back'}
        />
      </div>

      <div className="max-w-md mx-auto">



        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-2">
            Snow Media Center
          </h1>
          <p className="text-xl text-blue-200">Your Snow Media account</p>
        </div>

        <Card className="bg-gradient-to-br from-blue-600/20 to-blue-800/20 border-blue-500/50 backdrop-blur-sm p-6">
          {/* ===== STEP 1: EMAIL ===== */}
          {step === 'email' && (
            <div className="space-y-4">
              <p className="text-xs text-blue-200/90 bg-blue-950/40 border border-blue-500/30 rounded-md p-3">
                This is your Snow Media WEBSITE account — for purchases, support tickets, messages, and your profile. It is NOT your TV/streaming login (Dreamstreams, VibezTV). Your streaming service keeps working either way.
              </p>
              <p className="text-xs text-blue-200/70 px-1">
                Looking for your streaming (Dreamstreams / Vibez) login? Press Back, then open My Account and choose "Sign in with Dreamstreams / Vibez".
              </p>


              <div>
                <Label htmlFor="auth-email" className="text-white">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                  <Input
                    id="auth-email"
                    type="email"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                    placeholder="Enter your email"
                    className={`pl-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600 transition-all duration-200 ${
                      focusedElement === 'email' ? 'ring-4 ring-blue-400/60 scale-105' : ''
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
                  focusedElement === 'continue' ? 'ring-4 ring-white/60 scale-105' : ''
                }`}
              >
                {checking ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Checking…
                  </span>
                ) : 'Continue'}
              </Button>

              <Button
                id="auth-skip"
                type="button"
                variant="outline"
                onClick={handleSkip}
                className={`w-full bg-blue-600/20 hover:bg-blue-500/30 border-blue-400/50 text-white transition-all duration-200 ${
                  focusedElement === 'skip' ? 'ring-4 ring-white/60 scale-105' : ''
                }`}
              >
                Skip — continue as guest
              </Button>
            </div>
          )}

          {/* ===== STEP 2: PASSWORD ===== */}
          {step === 'password' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <p className="text-xs text-blue-200/90 bg-blue-950/40 border border-blue-500/30 rounded-md p-3">
                Welcome back! Enter your password to sign in.
              </p>

              <div>
                <Label className="text-white">Email</Label>
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
                <Label htmlFor="login-password" className="text-white">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                  <Input
                    id="login-password"
                    type={showLoginPassword ? "text" : "password"}
                    value={loginForm.password}
                    onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    placeholder="Enter your password"
                    className={`pl-10 pr-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600 transition-all duration-200 ${
                      focusedElement === 'password' ? 'ring-4 ring-blue-400/60 scale-105' : ''
                    }`}
                    required
                  />
                  <button
                    type="button"
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
                  focusedElement === 'submit' ? 'ring-4 ring-white/60 scale-105' : ''
                }`}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Signing In...
                  </span>
                ) : 'Sign In'}
              </Button>

              <button
                id="auth-change-email"
                type="button"
                onClick={() => { setStep('email'); setFocusedElement('email'); }}
                className={`w-full text-sm text-blue-300 hover:text-blue-100 underline transition-all duration-200 ${
                  focusedElement === 'change-email' ? 'ring-4 ring-white/60 scale-105 rounded' : ''
                }`}
              >
                Use a different email
              </button>
            </form>
          )}

          {/* ===== STEP 3: CREATE ===== */}
          {step === 'create' && (
            <form onSubmit={handleSignup} className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-white mb-2">Create your free website account</h2>
                <p className="text-xs text-blue-200/90 bg-blue-950/40 border border-blue-500/30 rounded-md p-3">
                  No account found for {signupForm.email || loginForm.email}. Create a free Snow Media WEBSITE account to see your purchases, get support replies in-app, and manage your profile. This is not a streaming subscription — it won't change or replace your Dreamstreams / VibezTV login.
                </p>
              </div>

              <div>
                <Label htmlFor="signup-name" className="text-white">Full Name (optional)</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                  <Input
                    id="signup-name"
                    type="text"
                    value={signupForm.fullName}
                    onChange={(e) => setSignupForm({ ...signupForm, fullName: e.target.value })}
                    placeholder="Enter your full name"
                    className={`pl-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600 transition-all duration-200 ${
                      focusedElement === 'name' ? 'ring-4 ring-blue-400/60 scale-105' : ''
                    }`}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="signup-password" className="text-white">Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                  <Input
                    id="signup-password"
                    type={showSignupPassword ? "text" : "password"}
                    value={signupForm.password}
                    onChange={(e) => setSignupForm({ ...signupForm, password: e.target.value })}
                    placeholder="Create a password"
                    className={`pl-10 pr-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600 transition-all duration-200 ${
                      focusedElement === 'password' ? 'ring-4 ring-blue-400/60 scale-105' : ''
                    }`}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowSignupPassword(!showSignupPassword)}
                    className="absolute right-3 top-3 text-blue-600 hover:text-blue-700 z-10"
                  >
                    {showSignupPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-blue-300/80 mt-1">At least 6 characters</p>
              </div>

              <div>
                <Label htmlFor="signup-confirm" className="text-white">Confirm Password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                  <Input
                    id="signup-confirm"
                    type={showConfirmPassword ? "text" : "password"}
                    value={signupForm.confirmPassword}
                    onChange={(e) => setSignupForm({ ...signupForm, confirmPassword: e.target.value })}
                    placeholder="Confirm your password"
                    className={`pl-10 pr-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600 transition-all duration-200 ${
                      focusedElement === 'confirm' ? 'ring-4 ring-blue-400/60 scale-105' : ''
                    }`}
                    required
                  />
                  <button
                    type="button"
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
                  focusedElement === 'submit' ? 'ring-4 ring-white/60 scale-105' : ''
                }`}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating Account...
                  </span>
                ) : 'Create Account'}
              </Button>

              <p className="text-xs text-blue-300/80 text-center">
                You'll get a confirmation email — open it on this device or your phone.
              </p>

              <Button
                id="auth-skip-2"
                type="button"
                variant="outline"
                onClick={handleSkip}
                className={`w-full bg-blue-600/20 hover:bg-blue-500/30 border-blue-400/50 text-white transition-all duration-200 ${
                  focusedElement === 'skip' ? 'ring-4 ring-white/60 scale-105' : ''
                }`}
              >
                Skip — continue as guest
              </Button>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Auth;
