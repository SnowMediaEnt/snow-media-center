import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { App as CapApp } from '@capacitor/app';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle, XCircle, KeyRound, ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { readSignInLink, signInLinkEmail, type SignInLink } from '@/lib/ssoLink';
import { waitForStorageReady } from '@/utils/storage';

const isBack = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'BrowserBack' || e.keyCode === 4 || e.keyCode === 27;
const isOk = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 13;
const isArrow = (e: KeyboardEvent) => e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
/** OK pressed this soon after the question appears is the press that opened
 *  the link somewhere else, not an answer. */
const ARM_MS = 500;

/**
 * SsoConsume — landing page for magic links coming from snowmediaent.com
 *
 * Two URL shapes are supported:
 *
 * 1) Direct Supabase magic link (token_hash in query):
 *    /sso?token_hash=abc123&type=magiclink
 *    We call supabase.auth.verifyOtp to exchange it for a session.
 *
 * 2) Standard Supabase callback fragment:
 *    /sso#access_token=...&refresh_token=...
 *    We call supabase.auth.setSession with the parsed values.
 *
 * Neither is applied until the viewer presses OK on "Sign in as …?" (see
 * lib/ssoLink): any app on the box can open one of these links. Back, or
 * Cancel, leaves the box as it was.
 */
const SsoConsume = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [status, setStatus] = useState<'checking' | 'confirm' | 'loading' | 'success' | 'error'>('checking');
  const [message, setMessage] = useState('Checking your sign-in link…');
  const [incomingEmail, setIncomingEmail] = useState<string | null>(null);
  // Who this box is signed in as now (email may be missing), or null.
  const [current, setCurrent] = useState<{ email: string | null } | null>(null);
  const [focus, setFocus] = useState<0 | 1>(0); // 0 Sign in · 1 Cancel
  const linkRef = useRef<SignInLink | null>(null);
  const shownAtRef = useRef(0);
  const doneTimerRef = useRef(0);

  const fail = useCallback((msg: string) => { setStatus('error'); setMessage(msg); }, []);

  // Read the link, take the tokens out of the address bar, and ask.
  useEffect(() => {
    const link = readSignInLink(location.search, location.hash);
    if (!link) {
      if (!linkRef.current) fail('No sign-in token found in the link.');
      return;
    }
    linkRef.current = link;
    try { window.history.replaceState(window.history.state, '', '/sso'); } catch { /* ignore */ }
    setStatus('checking');
    setMessage('Checking your sign-in link…');
    let alive = true;
    void (async () => {
      const [now, email] = await Promise.all([
        // After the saved session is restored (a link can open the app cold),
        // so "This box is signed in as …" is not missed.
        waitForStorageReady().then(() => supabase.auth.getSession()).then(
          ({ data }) => (data.session ? { email: data.session.user?.email ?? null } : null),
          () => null,
        ),
        link.kind === 'session' ? signInLinkEmail(link.accessToken) : Promise.resolve(null),
      ]);
      if (!alive) return;
      setCurrent(now);
      setIncomingEmail(email);
      setFocus(0);
      shownAtRef.current = Date.now();
      setStatus('confirm');
    })();
    return () => { alive = false; };
  }, [location.search, location.hash, fail]);

  useEffect(() => () => window.clearTimeout(doneTimerRef.current), []);

  const confirm = useCallback(async () => {
    const link = linkRef.current;
    if (!link) return;
    linkRef.current = null;
    setStatus('loading');
    setMessage('Signing you in…');
    try {
      const { data, error } = link.kind === 'session'
        ? await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
        : await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
      if (error) throw error;
      const email = data.user?.email ?? data.session?.user?.email;
      setStatus('success');
      setMessage(email ? `Signed in as ${email}. Redirecting…` : 'Signed in successfully. Redirecting…');
      toast({ title: 'Welcome back!', description: 'You are signed in.' });
      doneTimerRef.current = window.setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err) {
      console.error('[SsoConsume] Failed to consume magic link:', err instanceof Error ? err.message : 'unknown error');
      fail(
        err instanceof Error
          ? err.message
          : 'We could not sign you in with that link. It may have expired or already been used.'
      );
    }
  }, [fail, navigate, toast]);

  const leave = useCallback(() => {
    linkRef.current = null;
    navigate('/', { replace: true });
  }, [navigate]);

  // D-pad: arrows move between Sign in and Cancel, OK picks, Back leaves the
  // box as it was. Hardware Back may arrive only as Capacitor's backButton.
  const statusRef = useRef(status); statusRef.current = status;
  const focusRef = useRef(focus); focusRef.current = focus;
  const lastBackRef = useRef(0);
  useEffect(() => {
    const back = () => {
      const now = Date.now();
      if (now - lastBackRef.current < 350) return;
      lastBackRef.current = now;
      // Not while the OK'd link is being applied: that takes a moment.
      if (statusRef.current !== 'loading') leave();
    };
    const onKey = (e: KeyboardEvent) => {
      const st = statusRef.current;
      if (isBack(e)) { e.preventDefault(); back(); return; }
      if (st === 'confirm') {
        if (isArrow(e)) { e.preventDefault(); setFocus((f) => (f === 0 ? 1 : 0)); return; }
        if (isOk(e)) {
          e.preventDefault();
          if (e.repeat || Date.now() - shownAtRef.current < ARM_MS) return;
          if (focusRef.current === 0) void confirm(); else leave();
        }
        return;
      }
      if (st === 'error' && isOk(e)) { e.preventDefault(); navigate('/auth'); }
    };
    window.addEventListener('keydown', onKey, true);
    let handle: { remove: () => void } | null = null;
    let cancelled = false;
    void CapApp.addListener('backButton', back).then((h) => { if (cancelled) h.remove(); else handle = h; }).catch(() => { /* web */ });
    return () => { window.removeEventListener('keydown', onKey, true); cancelled = true; handle?.remove(); };
  }, [confirm, leave, navigate]);

  const Icon =
    status === 'checking' || status === 'loading' ? Loader2
    : status === 'confirm' ? ShieldAlert
    : status === 'success' ? CheckCircle : XCircle;
  const iconColor =
    status === 'checking' || status === 'loading'
      ? 'text-blue-400 animate-spin'
      : status === 'confirm'
      ? 'text-amber-300'
      : status === 'success'
      ? 'text-green-400'
      : 'text-red-400';
  const btn = (i: 0 | 1) =>
    `tv-ring rounded-xl px-6 py-3 text-lg font-semibold ${focus === i ? 'bg-white text-black' : 'bg-white/10 text-white'}`;
  const sameAccount = !!current?.email && current.email === incomingEmail;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
      <Card className="bg-gradient-to-br from-blue-600/10 to-purple-600/10 border-blue-500/20 w-full max-w-md">
        <CardContent className="p-8 text-center space-y-6">
          <div className="flex items-center justify-center gap-2 mb-2">
            <KeyRound className="w-7 h-7 text-blue-400" />
            <h1 className="text-2xl font-bold text-white">Snow Media Sign-In</h1>
          </div>

          <div className="flex flex-col items-center space-y-4">
            <Icon className={`w-16 h-16 ${iconColor}`} />
            {status === 'confirm' ? (
              <p className="text-white text-lg">
                {incomingEmail
                  ? <>Sign in as <span className="font-semibold break-all">{incomingEmail}</span>?</>
                  : 'Sign in with this link?'}
              </p>
            ) : (
              <p className="text-white/90 text-base">{message}</p>
            )}
          </div>

          {status === 'confirm' && (
            <div className="space-y-4">
              {current && (
                <p className="text-sm text-amber-200/90">
                  {sameAccount
                    ? 'This box is already signed in to that account.'
                    : <>This box is signed in as <span className="font-semibold break-all">{current.email ?? 'another account'}</span>. Signing in replaces it on this box.</>}
                </p>
              )}
              <p className="text-xs text-white/60">Only continue if you opened this link yourself.</p>
              <div className="flex justify-center gap-3">
                <button type="button" className={btn(0)} data-focused={focus === 0 ? 'true' : 'false'}
                  onMouseEnter={() => setFocus(0)} onClick={() => void confirm()}>Sign in</button>
                <button type="button" className={btn(1)} data-focused={focus === 1 ? 'true' : 'false'}
                  onMouseEnter={() => setFocus(1)} onClick={leave}>Cancel</button>
              </div>
            </div>
          )}

          {status === 'error' && (
            <div className="space-y-3">
              <Button
                onClick={() => navigate('/auth')}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                Go to Sign In
              </Button>
              <p className="text-xs text-white/60">
                Sign-in links are single-use and expire after 1 hour. Request a new one
                from snowmedia.com if needed.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default SsoConsume;
