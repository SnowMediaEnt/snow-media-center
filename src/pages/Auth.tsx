import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, User, Mail, Lock, UserPlus, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

const Auth = () => {
  const navigate = useNavigate();
  const { signIn, signUp, user } = useAuth();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(false);
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
  const [focusedElement, setFocusedElement] = useState<'back' | 'tab-login' | 'tab-signup' | 'email' | 'password' | 'submit' | 'name' | 'confirm'>('back');
  const [activeTab, setActiveTab] = useState('login');

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
        navigate('/');
        return;
      }
      
      // Skip navigation when typing
      if (isTyping) {
        return;
      }
      
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }
      
      switch (event.key) {
        case 'ArrowLeft':
          if (focusedElement === 'tab-signup') setFocusedElement('tab-login');
          break;
          
        case 'ArrowRight':
          if (focusedElement === 'tab-login') setFocusedElement('tab-signup');
          break;
          
        case 'ArrowUp':
          if (focusedElement === 'tab-login' || focusedElement === 'tab-signup') setFocusedElement('back');
          else if (focusedElement === 'email') setFocusedElement(activeTab === 'signup' ? 'name' : 'tab-login');
          else if (focusedElement === 'password') setFocusedElement('email');
          else if (focusedElement === 'confirm') setFocusedElement('password');
          else if (focusedElement === 'submit') setFocusedElement(activeTab === 'signup' ? 'confirm' : 'password');
          else if (focusedElement === 'name') setFocusedElement('tab-signup');
          break;
          
        case 'ArrowDown':
          if (focusedElement === 'back') setFocusedElement('tab-login');
          else if (focusedElement === 'tab-login' || focusedElement === 'tab-signup') {
            if (activeTab === 'login') setFocusedElement('email');
            else if (activeTab === 'signup') setFocusedElement('name');
          } else if (focusedElement === 'name') setFocusedElement('email');
          else if (focusedElement === 'email') setFocusedElement('password');
          else if (focusedElement === 'password') setFocusedElement(activeTab === 'signup' ? 'confirm' : 'submit');
          else if (focusedElement === 'confirm') setFocusedElement('submit');
          break;
          
        case 'Enter':
        case ' ':
          if (focusedElement === 'back') navigate('/');
          else if (focusedElement === 'tab-login') setActiveTab('login');
          else if (focusedElement === 'tab-signup') setActiveTab('signup');
          else if (focusedElement === 'email') {
            const emailInput = document.getElementById(activeTab === 'login' ? 'login-email' : 'signup-email') as HTMLInputElement;
            if (emailInput) emailInput.focus();
          } else if (focusedElement === 'password') {
            const passwordInput = document.getElementById(activeTab === 'login' ? 'login-password' : 'signup-password') as HTMLInputElement;
            if (passwordInput) passwordInput.focus();
          } else if (focusedElement === 'name') {
            const nameInput = document.getElementById('signup-name') as HTMLInputElement;
            if (nameInput) nameInput.focus();
          } else if (focusedElement === 'confirm') {
            const confirmInput = document.getElementById('signup-confirm') as HTMLInputElement;
            if (confirmInput) confirmInput.focus();
          } else if (focusedElement === 'submit') {
            if (activeTab === 'login') {
              const form = document.querySelector('form') as HTMLFormElement;
              if (form) form.requestSubmit();
            } else if (activeTab === 'signup') {
              const signupForm = document.querySelectorAll('form')[1] as HTMLFormElement;
              if (signupForm) signupForm.requestSubmit();
            }
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, focusedElement, activeTab]);

  // Keep the focused element in view (TV / STB scrolling fix)
  useEffect(() => {
    const idMap: Record<string, string> = {
      'back': 'auth-back',
      'tab-login': 'auth-tab-login',
      'tab-signup': 'auth-tab-signup',
      'name': 'signup-name',
      'email': activeTab === 'login' ? 'login-email' : 'signup-email',
      'password': activeTab === 'login' ? 'login-password' : 'signup-password',
      'confirm': 'signup-confirm',
      'submit': activeTab === 'login' ? 'login-submit' : 'signup-submit',
    };
    const el = document.getElementById(idMap[focusedElement]);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Auto-focus input fields so user can type immediately
      if (el.tagName === 'INPUT' && document.activeElement !== el) {
        (el as HTMLInputElement).focus();
      }
    }
  }, [focusedElement, activeTab]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      console.log('[Auth Page] Attempting login for:', loginForm.email);
      
      // Direct Supabase login - no Wix verification to avoid timeouts
      const { error } = await signIn(loginForm.email, loginForm.password);
      
      if (error) {
        console.error('[Auth Page] Login error:', error.message);

        // Wix bridge: if invalid credentials, confirm the email exists in Wix,
        // create/confirm the matching Supabase app account server-side, then retry login.
        const isInvalidCreds = /invalid login credentials/i.test(error.message || '');
        if (isInvalidCreds) {
          try {
            console.log('[Auth Page] Bridging Wix account:', loginForm.email);
            const { data: wixData, error: wixBridgeError } = await supabase.functions.invoke('wix-integration', {
              body: {
                action: 'bridge-wix-login',
                email: loginForm.email,
                password: loginForm.password,
              },
            });

            if (wixBridgeError || wixData?.error) {
              console.warn('[Auth Page] Wix bridge returned no login:', wixBridgeError || wixData?.error);
            } else if (wixData?.success) {
              console.log('[Auth Page] Wix account linked — retrying Supabase login');
              toast({
                title: "Linking your Wix account…",
                description: "Setting up your app login. One moment.",
              });

              const { error: retryError } = await signIn(loginForm.email, loginForm.password);
              if (!retryError) {
                toast({ title: "Welcome!", description: "Signed in with your Wix account." });
                navigate('/');
                setLoading(false);
                return;
              }

              toast({
                title: "Could not finish sign in",
                description: retryError.message || "Your Wix account was found, but app sign-in could not complete.",
                variant: "destructive",
              });
              setLoading(false);
              return;
            }
          } catch (wixErr) {
            console.warn('[Auth Page] Wix bridge check failed:', wixErr);
          }
        }

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
      const { error } = await signUp(
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
          setActiveTab('login');
          setLoginForm((prev) => ({ ...prev, email: signupForm.email }));
        } else {
          toast({
            title: "Signup failed",
            description: error.message,
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Account created!",
          description: "Check your email to confirm your account.",
        });
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
      className="fixed inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-4 md:p-8 overflow-y-auto"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 6rem)' }}
    >
      <div className="max-w-md mx-auto">
        {/* Back Button - Fixed to top left corner like other pages */}
        <div className="fixed top-4 left-4 z-50">
          <Button 
            id="auth-back"
            onClick={() => navigate('/')}
            variant="outline" 
            size="lg"
            className={`bg-blue-600/20 hover:bg-blue-500/30 border-blue-400/50 text-white transition-all duration-200 ${
              focusedElement === 'back' ? 'ring-4 ring-white/60 scale-105' : ''
            }`}
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Home
          </Button>
        </div>
        
        <div className="pt-16"></div>

        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-2">
            Snow Media Center
          </h1>
          <p className="text-xl text-blue-200">Sign in to your account</p>
        </div>

        <Card className="bg-gradient-to-br from-blue-600/20 to-blue-800/20 border-blue-500/50 backdrop-blur-sm">
          <Tabs defaultValue="login" className="w-full p-6">
            <TabsList className="grid w-full grid-cols-2 bg-blue-800/50 border-blue-600">
              <TabsTrigger 
                id="auth-tab-login"
                value="login" 
                className={`data-[state=active]:bg-blue-600 transition-all duration-200 ${
                  focusedElement === 'tab-login' ? 'ring-4 ring-white/60 scale-105' : ''
                }`}
                onClick={() => setActiveTab('login')}
              >
                <User className="w-4 h-4 mr-2" />
                Sign In
              </TabsTrigger>
              <TabsTrigger 
                id="auth-tab-signup"
                value="signup" 
                className={`data-[state=active]:bg-blue-600 transition-all duration-200 ${
                  focusedElement === 'tab-signup' ? 'ring-4 ring-white/60 scale-105' : ''
                }`}
                onClick={() => setActiveTab('signup')}
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Sign Up
              </TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <p className="text-xs text-blue-200/90 bg-blue-950/40 border border-blue-500/30 rounded-md p-3 mb-4">
                Already have an account on the Snow Media website (snowmediaent.com)? You can sign in here using the same email and password.
              </p>
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <Label htmlFor="login-email" className="text-white">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                    <Input
                      id="login-email"
                      type="email"
                      value={loginForm.email}
                      onChange={(e) => setLoginForm({...loginForm, email: e.target.value})}
                      placeholder="Enter your email"
                      className={`pl-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600 transition-all duration-200 ${
                        focusedElement === 'email' ? 'ring-4 ring-blue-400/60 scale-105' : ''
                      }`}
                      required
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
                      onChange={(e) => setLoginForm({...loginForm, password: e.target.value})}
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

              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignup} className="space-y-4">
                <div>
                  <Label htmlFor="signup-name" className="text-white">Full Name</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                    <Input
                      id="signup-name"
                      type="text"
                      value={signupForm.fullName}
                      onChange={(e) => setSignupForm({...signupForm, fullName: e.target.value})}
                      placeholder="Enter your full name"
                      className="pl-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600"
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="signup-email" className="text-white">Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                    <Input
                      id="signup-email"
                      type="email"
                      value={signupForm.email}
                      onChange={(e) => setSignupForm({...signupForm, email: e.target.value})}
                      placeholder="Enter your email"
                      className="pl-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600"
                      required
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
                      onChange={(e) => setSignupForm({...signupForm, password: e.target.value})}
                      placeholder="Create a password"
                      className="pl-10 pr-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600"
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
                </div>

                <div>
                  <Label htmlFor="signup-confirm" className="text-white">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-3 h-4 w-4 text-blue-600 z-10" />
                    <Input
                      id="signup-confirm"
                      type={showConfirmPassword ? "text" : "password"}
                      value={signupForm.confirmPassword}
                      onChange={(e) => setSignupForm({...signupForm, confirmPassword: e.target.value})}
                      placeholder="Confirm your password"
                      className="pl-10 pr-10 bg-white/90 border-white/20 text-black placeholder:text-gray-600"
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
                  type="submit" 
                  disabled={loading}
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                >
                {loading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating Account...
                    </span>
                  ) : 'Create Account'}
                </Button>
              </form>
            </TabsContent>

          </Tabs>
        </Card>
      </div>
    </div>
  );
};

export default Auth;