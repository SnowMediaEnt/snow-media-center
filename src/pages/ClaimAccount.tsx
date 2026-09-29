import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { completeAccountClaim, getClaimSession, type ClaimSessionSnapshot } from '@/lib/accountClaim';
import { BellRing, CheckCircle, Loader2, XCircle } from 'lucide-react';
import { formatDate } from '@/i18n/format';

// `value` is what gets saved with the claim (always English); `labelKey` is only
// what the phone shows. Brand names have no key and are shown as they are.
const DEVICE_TYPES: Array<{ value: string; labelKey?: string }> = [
  { value: 'Fire TV Stick' },
  { value: 'Fire TV Stick 4K / Max' },
  { value: 'Fire TV Cube' },
  { value: 'Android TV Box', labelKey: 'auth.claim.devices.androidTvBox' },
  { value: 'Google TV / Chromecast' },
  { value: 'NVIDIA Shield' },
  { value: 'Smart TV app', labelKey: 'auth.claim.devices.smartTvApp' },
  { value: 'Phone / Tablet', labelKey: 'auth.claim.devices.phoneTablet' },
  { value: 'Other', labelKey: 'auth.claim.devices.other' },
];

/** A message to show: one of our own (translated when drawn) or the server's own text. */
type Msg = { key: string } | { text: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Status = 'loading' | 'invalid' | 'form' | 'confirm' | 'done' | 'already';

/**
 * Phone-side landing page for the account-claim QR (/claim?token=...).
 * "Claim your Snow Media account": existing account → sign in and link;
 * new → create. On completion the TV's polling sees the session flip and
 * closes itself.
 */
const ClaimAccount = () => {
  const { t } = useTranslation();
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
  const [error, setError] = useState<Msg | null>(null);
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
      setError({ key: 'auth.claim.errors.emailInUse' });
      return;
    }
    setError({ key: 'auth.claim.errors.claimFailed' });
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
      if (!EMAIL_RE.test(em)) { setError({ key: 'auth.claim.errors.invalidEmail' }); return; }
      if (password.length < 6) { setError({ key: 'auth.claim.errors.passwordShort' }); return; }

      if (mode === 'create') {
        const { data, error: suErr } = await supabase.auth.signUp({
          email: em,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/sso`,
            data: { full_name: fullName.trim(), tenant_code: 'snowmedia' },
          },
        });
        if (suErr) { setError({ text: suErr.message }); return; }
        // Supabase answers success with empty identities when the email exists.
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setMode('signin');
          setError({ key: 'auth.claim.errors.alreadyHasAccount' });
          return;
        }
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
      if (siErr) { setError({ text: siErr.message }); return; }
      await finishClaim();
    } catch (err) {
      const text = (err as Error)?.message;
      setError(text ? { text } : { key: 'auth.claim.errors.generic' });
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
      if (siErr) { setError({ text: siErr.message }); return; }
      await finishClaim();
    } catch (err) {
      const text = (err as Error)?.message;
      setError(text ? { text } : { key: 'auth.claim.errors.generic' });
    } finally {
      setBusy(false);
    }
  };

  const expLabel = claim?.expiration_date
    ? formatDate(new Date(`${claim.expiration_date}T00:00:00`))
    : null;
  const showName = hasSession || mode === 'create';
  const isLoading = status === 'loading';
  const isInvalid = status === 'invalid';
  const isAlready = status === 'already';
  const isDone = status === 'done';
  const isConfirm = status === 'confirm';
  const isForm = status === 'form';
  const errorText = error ? ('key' in error ? t(error.key) : error.text) : '';
  const bold = <span className="font-semibold text-white break-all" />;
  const linkingKey = claim?.server_label
    ? (expLabel ? 'auth.claim.linkingServerExpires' : 'auth.claim.linkingServer')
    : (expLabel ? 'auth.claim.linkingExpires' : 'auth.claim.linking');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center p-4">
      <Card className="bg-gradient-to-br from-blue-600/10 to-purple-600/10 border-blue-500/20 w-full max-w-md">
        <CardContent className="p-8 space-y-6">
          <div className="flex items-center justify-center gap-2">
            <BellRing className="w-7 h-7 text-blue-400 shrink-0" />
            <h1 className="text-2xl font-bold text-white text-center">{t('auth.claim.title')}</h1>
          </div>

          {isLoading && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="w-12 h-12 animate-spin text-blue-400" />
              <p className="text-white/70 text-sm">{t('auth.claim.loading')}</p>
            </div>
          )}

          {isInvalid && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <XCircle className="w-14 h-14 text-red-400" />
              <h2 className="text-lg font-semibold text-white">{t('auth.claim.invalidTitle')}</h2>
              <p className="text-white/80 text-sm leading-relaxed">
                {t('auth.claim.invalidDesc')}
              </p>
            </div>
          )}

          {isAlready && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle className="w-14 h-14 text-green-400" />
              <h2 className="text-lg font-semibold text-white">{t('auth.claim.alreadyTitle')}</h2>
              <p className="text-white/80 text-sm leading-relaxed">
                {doneEmail
                  ? <Trans i18nKey="auth.claim.alreadyDescFor" values={{ email: doneEmail }} components={{ b: bold }} />
                  : t('auth.claim.alreadyDesc')}
              </p>
            </div>
          )}

          {isDone && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle className="w-14 h-14 text-green-400" />
              <h2 className="text-lg font-semibold text-white">{t('auth.claim.doneTitle')}</h2>
              <p className="text-white/80 text-sm leading-relaxed">
                <Trans i18nKey="auth.claim.doneDesc" values={{ email: doneEmail }} components={{ b: bold }} />
              </p>
            </div>
          )}

          {isConfirm && (
            <div className="space-y-4 text-center">
              <h2 className="text-lg font-semibold text-white">{t('auth.claim.confirmTitle')}</h2>
              <p className="text-white/80 text-sm leading-relaxed">
                <Trans i18nKey="auth.claim.confirmDesc" values={{ email }} components={{ b: bold }} />
              </p>
              {error && <p className="text-red-300 text-sm">{errorText}</p>}
              <Button
                onClick={confirmAndFinish}
                disabled={busy}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {t('auth.claim.confirmBtn')}
              </Button>
            </div>
          )}

          {isForm && claim && (
            <form onSubmit={submit} className="space-y-4">
              <p className="text-white/80 text-sm text-center leading-relaxed">
                <Trans
                  i18nKey={linkingKey}
                  values={{ username: claim.panel_username, server: claim.server_label ?? '', date: expLabel ?? '' }}
                  components={{ b: bold }}
                />
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
                    {t('auth.claim.createTabBtn')}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setMode('signin')}
                    className={mode === 'signin'
                      ? 'bg-blue-600 hover:bg-blue-700 text-white'
                      : 'bg-white/10 border border-white/20 text-white hover:bg-white/20'}
                  >
                    {t('common.signInAction')}
                  </Button>
                </div>
              )}

              {hasSession ? (
                <p className="text-white/70 text-xs text-center">
                  {t('auth.claim.alreadySignedIn')}
                </p>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="claim-email" className="text-white">{t('auth.claim.emailLabel')}</Label>
                    <Input
                      id="claim-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t('auth.claim.emailPlaceholder')}
                      autoComplete="email"
                      className="bg-black/30 text-white border-white/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="claim-pass" className="text-white">{t('auth.claim.passwordLabel')}</Label>
                    <Input
                      id="claim-pass"
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === 'create' ? t('auth.claim.passwordCreatePlaceholder') : t('auth.claim.passwordPlaceholder')}
                      autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
                      className="bg-black/30 text-white border-white/20"
                    />
                  </div>
                </>
              )}

              {showName && (
                <div className="space-y-2">
                  <Label htmlFor="claim-name" className="text-white">
                    {t('auth.claim.nameLabel')} <span className="text-white/50">{t('auth.claim.optional')}</span>
                  </Label>
                  <Input
                    id="claim-name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={t('auth.claim.namePlaceholder')}
                    autoComplete="name"
                    className="bg-black/30 text-white border-white/20"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="claim-device" className="text-white">
                  {t('auth.claim.deviceLabel')} <span className="text-white/50">{t('auth.claim.optional')}</span>
                </Label>
                <select
                  id="claim-device"
                  value={deviceType}
                  onChange={(e) => setDeviceType(e.target.value)}
                  className="w-full h-10 rounded-md bg-black/30 text-white border border-white/20 px-3 text-sm"
                >
                  <option value="">{t('auth.claim.select')}</option>
                  {DEVICE_TYPES.map((d) => <option key={d.value} value={d.value}>{d.labelKey ? t(d.labelKey) : d.value}</option>)}
                </select>
              </div>

              {error && <p className="text-red-300 text-sm text-center">{errorText}</p>}

              <Button
                type="submit"
                disabled={busy}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white"
              >
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {hasSession ? t('auth.claim.linkBtn') : mode === 'create' ? t('auth.claim.createLinkBtn') : t('auth.claim.signinLinkBtn')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ClaimAccount;
