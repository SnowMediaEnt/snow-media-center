import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { completeAccountClaim, getClaimSession, type ClaimSessionSnapshot } from '@/lib/accountClaim';
import { BellRing, CheckCircle, Loader2, XCircle } from 'lucide-react';

const DEVICE_TYPES = [
  'Fire TV Stick',
  'Fire TV Stick 4K / Max',
  'Fire TV Cube',
  'Android TV Box',
  'Google TV / Chromecast',
  'NVIDIA Shield',
  'Smart TV app',
  'Phone / Tablet',
  'Other',
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Status = 'loading' | 'invalid' | 'form' | 'confirm' | 'done' | 'already';

/**
 * Phone-side landing page for the account-claim QR (/claim?token=...).
 * "Claim your Snow Media account": existing account → sign in and link;
 * new → create. On completion the TV's polling sees the session flip and
 * closes itself.
 */
const ClaimAccount = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [status, setStatus] = useState<Status>('loading');
  const [claim, setClaim] = useState<ClaimSessionSnapshot | null>(null);
  const [mode, setMode] = useState<'create' | 'signin'>('create');
  const [hasSession, setHasSession] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneEmail, setDoneEmail] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setStatus('invalid'); return; }
      try {
        const s = await getClaimSession(token);
        if (cancelled) return;
        if (!s) { setStatus('invalid'); return; }
        setClaim(s);
        if (s.completed_at) {
          setDoneEmail(s.claimed_email || '');
          setStatus('already');
          return;
        }
        // Already signed in on this phone → skip straight to linking.
        const { data } = await supabase.auth.getSession();
        if (!cancelled && data.session) setHasSession(true);
        if (!cancelled) setStatus('form');
      } catch {
        if (!cancelled) setStatus('invalid');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const finishClaim = async (): Promise<void> => {
    const res = await completeAccountClaim(token, fullName.trim() || null, deviceType || null);
    if (res.ok) {
      setDoneEmail(res.email || email.trim().toLowerCase());
      setStatus('done');
      return;
    }
    if (res.reason === 'invalid_or_expired') {
      setStatus('invalid');
      return;
    }
    if (res.reason === 'email_in_use') {
      setError('That email is linked to a different account. Sign in with that account instead.');
      return;
    }
    setError('Could not complete the claim — please try again.');
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    const em = email.trim().toLowerCase();

    setBusy(true);
    try {
      if (hasSession) {
        await finishClaim();
        return;
      }
      if (!EMAIL_RE.test(em)) { setError('Please enter a valid email address.'); return; }
      if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }

      if (mode === 'create') {
        const { data, error: suErr } = await supabase.auth.signUp({
          email: em,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/sso`,
            data: { full_name: fullName.trim(), tenant_code: 'snowmedia' },
          },
        });
        if (suErr) { setError(suErr.message); return; }
        // Supabase answers success with empty identities when the email exists.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setMode('signin');
          setError('That email already has an account — sign in instead.');
          return;
        }
        // Background Wix member sync (mirrors the in-app sign-up).
        try {
          const nameParts = fullName.trim().split(' ').filter(Boolean);
          void supabase.functions.invoke('wix-integration', {
            body: {
              action: 'create-member',
              memberData: {
                email: em,
                firstName: nameParts[0] || '',
                lastName: nameParts.slice(1).join(' ') || '',
                nickname: em.split('@')[0],
              },
            },
          });
        } catch { /* ignore */ }
        if (data.session) {
          // Auto-confirm / confirmations disabled → session exists immediately.
          await finishClaim();
        } else {
          // Email confirmation required — confirm, then finish below.
          setStatus('confirm');
        }
        return;
      }

      const { error: siErr } = await supabase.auth.signInWithPassword({ email: em, password });
      if (siErr) { setError(siErr.message); return; }
      await finishClaim();
    } catch (err) {
      setError((err as Error)?.message || 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmAndFinish = async () => {
    setError(null);
    setBusy(true);
    try {
      const { error: siErr } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (siErr) { setError(siErr.message); return; }
      await finishClaim();
    } catch (err) {
      setError((err as Error)?.message || 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const expLabel = claim?.expiration_date
    ? new Date(`${claim.expiration_date}T00:00:00`).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
      <Card className="bg-gradient-to-br from-blue-600/10 to-purple-600/10 border-blue-500/20 w-full max-w-md">
        <CardContent className="p-8 space-y-6">
          <div className="flex items-center justify-center gap-2">
            <BellRing className="w-7 h-7 text-blue-400 shrink-0" />
            <h1 className="text-2xl font-bold text-white text-center">Claim your Snow Media account</h1>
          </div>

          {status === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="w-12 h-12 animate-spin text-blue-400" />
              <p className="text-white/70 text-sm">Loading your claim link…</p>
            </div>
          )}

          {status === 'invalid' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <XCircle className="w-14 h-14 text-red-400" />
              <h2 className="text-lg font-semibold text-white">Link expired or invalid</h2>
              <p className="text-white/80 text-sm leading-relaxed">
                Ask the TV to show the QR code again — in the Player go to Settings → Renewal Reminders.
              </p>
            </div>
          )}

          {status === 'already' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle className="w-14 h-14 text-green-400" />
              <h2 className="text-lg font-semibold text-white">Already claimed</h2>
              <p className="text-white/80 text-sm leading-relaxed">
                This claim link was already completed{doneEmail ? (
                  <> for <span className="font-semibold text-white break-all">{doneEmail}</span></>
                ) : ''}. You can close this page.
              </p>
            </div>
          )}

          {status === 'done' && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle className="w-14 h-14 text-green-400" />
              <h2 className="text-lg font-semibold text-white">You're all set</h2>
              <p className="text-white/80 text-sm leading-relaxed">
                Reminders will go to <span className="font-semibold text-white break-all">{doneEmail}</span>.
                The TV updates itself — you can close this page.
              </p>
            </div>
          )}

          {status === 'confirm' && (
            <div className="space-y-4 text-center">
              <h2 className="text-lg font-semibold text-white">Confirm your email</h2>
              <p className="text-white/80 text-sm leading-relaxed">
                We sent a confirmation link to <span className="font-semibold text-white break-all">{email}</span>.
                Tap it, then come back here and finish linking.
              </p>
              {error && <p className="text-red-300 text-sm">{error}</p>}
              <Button
                onClick={confirmAndFinish}
                disabled={busy}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                I've confirmed — finish linking
              </Button>
            </div>
          )}

          {status === 'form' && claim && (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-white/80 text-sm text-center leading-relaxed">
                Linking subscription <span className="font-semibold text-white break-all">{claim.panel_username}</span>
                {claim.server_label ? ` (${claim.server_label})` : ''}
                {expLabel ? ` — expires ${expLabel}` : ''}.
              </p>

              {!hasSession && (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    onClick={() => setMode('create')}
                    className={mode === 'create'
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-white/10 border border-white/20 text-white hover:bg-white/20'}
                  >
                    Create account
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setMode('signin')}
                    className={mode === 'signin'
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-white/10 border border-white/20 text-white hover:bg-white/20'}
                  >
                    Sign in
                  </Button>
                </div>
              )}

              {hasSession ? (
                <p className="text-white/70 text-xs text-center">
                  You're already signed in on this phone — just confirm the details below.
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="claim-email" className="text-white">Email</Label>
                    <Input
                      id="claim-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      className="bg-black/30 text-white border-white/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="claim-pass" className="text-white">Password</Label>
                    <Input
                      id="claim-pass"
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'create' ? 'Choose a password (6+ characters)' : 'Your password'}
                      autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                      className="bg-black/30 text-white border-white/20"
                    />
                  </div>
                </>
              )}

              {(hasSession || mode === 'create') && (
                <div className="space-y-2">
                  <Label htmlFor="claim-name" className="text-white">
                    Your name <span className="text-white/50">(optional)</span>
                  </Label>
                  <Input
                    id="claim-name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jane Smith"
                    autoComplete="name"
                    className="bg-black/30 text-white border-white/20"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="claim-device" className="text-white">
                  Device type <span className="text-white/50">(optional)</span>
                </Label>
                <select
                  id="claim-device"
                  value={deviceType}
                  onChange={(e) => setDeviceType(e.target.value)}
                  className="w-full h-10 rounded-md bg-black/30 text-white border border-white/20 px-3 text-sm"
                >
                  <option value="">Select…</option>
                  {DEVICE_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {error && <p className="text-red-300 text-sm text-center">{error}</p>}

              <Button
                type="submit"
                disabled={busy}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {hasSession ? 'Link my account' : mode === 'create' ? 'Create account & link' : 'Sign in & link'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ClaimAccount;
