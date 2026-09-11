import { memo, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CreditCard, Loader2 } from 'lucide-react';
import { useTVFocus, type TVFocusNavigationMap } from '@/hooks/useTVFocus';
import { useToast } from '@/hooks/use-toast';
import { SmcBilling, type BillingSession } from '@/capacitor/SmcBilling';
import { toBillingError, billingErrorText, BILLING_SITE } from '@/lib/billing';
import { BTN, BTN_GOLD, INPUT, focusAttrs, scaleIf, useRateLimit, useFocusRecovery } from './shared';
import { RateLimitNote } from './SharedUi';

type Mode = 'login' | 'register';

interface Props {
  initialMode?: Mode;
  initialEmail?: string;
  /** Why the viewer is being asked, e.g. "Create an account to start your free trial". */
  heading?: string;
  onSuccess: (session: BillingSession) => void;
  onCancel: () => void;
}

const MIN_PASSWORD = 8;

/**
 * WHMCS wants a surname; someone typing on a TV remote will not give one.
 * If the field is blank, take the last word of what they typed as a name
 * ("Josh Perez" -> Josh / Perez), and fall back to repeating the first name
 * so the account is still created rather than rejected at 422.
 */
const splitName = (first: string, last: string): { firstName: string; lastName: string } => {
  const f = first.trim().replace(/\s+/g, ' ');
  const l = last.trim();
  if (l) return { firstName: f, lastName: l };
  const parts = f.split(' ');
  if (parts.length > 1) return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
  return { firstName: f, lastName: f };
};

/**
 * Sign in / create account for the billing (WHMCS) account. This is NOT the
 * streaming login and NOT the website account — the copy says so, because
 * the app already has two other sign-ins.
 *
 * The token never reaches this component: the native plugin stores it and
 * resolves with the client only.
 */
const BillingAuthForm = memo(({ initialMode = 'login', initialEmail = '', heading, onSuccess, onCancel }: Props) => {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const { toast } = useToast();
  const { blocked, secondsLeft, block } = useRateLimit();

  const register = mode === 'register';

  const navigation = useMemo<TVFocusNavigationMap>(() => register ? ({
    'ba-email':  { down: 'ba-pass' },
    'ba-pass':   { up: 'ba-email', down: 'ba-first' },
    'ba-first':  { up: 'ba-pass', down: 'ba-submit', right: 'ba-last' },
    'ba-last':   { up: 'ba-pass', down: 'ba-submit', left: 'ba-first' },
    'ba-submit': { up: 'ba-first', right: 'ba-switch' },
    'ba-switch': { up: 'ba-last', left: 'ba-submit', right: 'ba-cancel' },
    'ba-cancel': { up: 'ba-last', left: 'ba-switch' },
  }) : ({
    'ba-email':  { down: 'ba-pass' },
    'ba-pass':   { up: 'ba-email', down: 'ba-submit' },
    'ba-submit': { up: 'ba-pass', right: 'ba-switch' },
    'ba-switch': { up: 'ba-pass', left: 'ba-submit', right: 'ba-cancel' },
    'ba-cancel': { up: 'ba-pass', left: 'ba-switch' },
  }), [register]);

  const { containerRef, currentFocusId, focusById } = useTVFocus({
    navigation,
    initialFocusId: 'ba-email',
    onBack: () => { if (!busy) onCancel(); },
    scrollBlock: 'center',
  });
  useFocusRecovery(containerRef, currentFocusId, focusById, 'ba-submit');

  const switchMode = () => {
    setMode((m) => (m === 'login' ? 'register' : 'login'));
    setNote(null);
    setFieldError(null);
  };

  const validate = (): string | null => {
    const e = email.trim();
    if (!e || !e.includes('@')) return 'Enter the email address for your billing account.';
    if (!password) return 'Enter your password.';
    if (register) {
      if (password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
      if (!first.trim()) return 'Enter your first name.';
    }
    return null;
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || blocked) return;
    const problem = validate();
    if (problem) { toast({ title: 'Missing info', description: problem, variant: 'destructive' }); return; }
    setBusy(true);
    setNote(null);
    setFieldError(null);
    try {
      const named = splitName(first, last);
      const session = register
        ? await SmcBilling.register({ email: email.trim(), password, firstName: named.firstName, lastName: named.lastName })
        : await SmcBilling.login({ email: email.trim(), password });
      setPassword('');
      onSuccess(session);
    } catch (err) {
      const info = toBillingError(err);
      if (info.code === 'email_exists') {
        // The spec's rule: switch to sign-in with the email kept.
        setMode('login');
        setNote('That email already has a billing account. Sign in with its password.');
      } else if (info.code === 'validation_error' && info.field) {
        setFieldError({ field: info.field, message: info.message });
      } else if (info.code === 'two_factor_required') {
        setNote(`This account uses two-factor sign-in, which the app cannot do. Sign in at ${BILLING_SITE.replace('https://', '')} on a phone or computer.`);
      } else if (info.code === 'rate_limited') {
        block(info.retryAfter ?? 30);
      } else {
        toast({ title: register ? 'Could not create the account' : 'Could not sign in', description: billingErrorText(info), variant: 'destructive' });
      }
    } finally {
      setBusy(false);
    }
  };

  const fieldNote = (name: string) =>
    fieldError && fieldError.field === name ? <p className="text-red-300 text-xs font-nunito">{fieldError.message}</p> : null;

  return (
    <div ref={containerRef} className="min-h-screen flex items-center justify-center px-6 py-10">
      <form onSubmit={submit} className="w-full max-w-xl rounded-3xl p-8 [background:var(--gradient-navy)] shadow-2xl border border-white/10">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-14 h-14 rounded-2xl bg-brand-gold/20 flex items-center justify-center">
            <CreditCard className="w-8 h-8 text-brand-gold" />
          </div>
          <div>
            <h2 className="text-2xl font-quicksand font-bold text-white">
              {register ? 'Create a billing account' : 'Sign in to billing'}
            </h2>
            <p className="text-brand-ice/70 font-nunito text-sm">
              {heading ?? 'Your Dreamstreams billing account — plans, renewals and trials.'}
            </p>
          </div>
        </div>

        {note && (
          <p className="mb-4 rounded-xl bg-amber-500/15 border border-amber-400/40 px-4 py-3 text-amber-100 text-sm font-nunito">{note}</p>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ba-email" className="text-brand-ice font-nunito">Email</Label>
            {/* The placeholder is not decoration here: Fire TV opens a
                full-screen keyboard that hides the form, and the field's
                placeholder is the only label it shows. Without one you cannot
                tell which box you are typing into. */}
            <Input id="ba-email" type="email" inputMode="email" autoComplete="off" disabled={busy}
              placeholder="Email address" aria-label="Email address"
              value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT}
              {...focusAttrs(currentFocusId, 'ba-email')} />
            {fieldNote('email')}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ba-pass" className="text-brand-ice font-nunito">
              Password{register ? ` (at least ${MIN_PASSWORD} characters)` : ''}
            </Label>
            <Input id="ba-pass" type="password" autoComplete="off" disabled={busy} data-tv-allow-enter="true"
              placeholder={register ? `Password — at least ${MIN_PASSWORD} characters` : 'Password'} aria-label="Password"
              value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT}
              {...focusAttrs(currentFocusId, 'ba-pass')} />
            {fieldNote('password')}
          </div>
          {register && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ba-first" className="text-brand-ice font-nunito">First name</Label>
                <Input id="ba-first" autoComplete="off" disabled={busy} value={first}
                  placeholder="First name" aria-label="First name"
                  onChange={(e) => setFirst(e.target.value)} className={INPUT}
                  {...focusAttrs(currentFocusId, 'ba-first')} />
                {fieldNote('first_name')}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ba-last" className="text-brand-ice font-nunito">Last name <span className="text-brand-ice/50">(optional)</span></Label>
                <Input id="ba-last" autoComplete="off" disabled={busy} value={last}
                  placeholder="Last name (optional)" aria-label="Last name, optional"
                  onChange={(e) => setLast(e.target.value)} className={INPUT}
                  {...focusAttrs(currentFocusId, 'ba-last')} />
                {fieldNote('last_name')}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 min-h-6">
          <RateLimitNote secondsLeft={secondsLeft} />
          {busy && (
            <div className="flex items-center gap-3 text-brand-ice/90 font-nunito text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />
              <span>{register ? 'Creating your account…' : 'Signing in…'}</span>
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <Button type="submit" variant="gold" disabled={busy || blocked}
            className={`${BTN_GOLD} flex-1 ${scaleIf(currentFocusId, 'ba-submit')}`}
            {...focusAttrs(currentFocusId, 'ba-submit')}>
            {register ? 'Create account' : 'Sign in'}
          </Button>
          <Button type="button" variant="white" disabled={busy} onClick={switchMode}
            className={`${BTN} ${scaleIf(currentFocusId, 'ba-switch')}`}
            {...focusAttrs(currentFocusId, 'ba-switch')}>
            {register ? 'I have an account' : 'Create account'}
          </Button>
          <Button type="button" variant="white" disabled={busy} onClick={onCancel}
            className={`${BTN} ${scaleIf(currentFocusId, 'ba-cancel')}`}
            {...focusAttrs(currentFocusId, 'ba-cancel')}>
            Cancel
          </Button>
        </div>

        <p className="text-brand-ice/60 text-xs font-nunito mt-4">
          This is your billing account, not your streaming username. Your password is sent only to the billing server and is never stored on this device.
        </p>
      </form>
    </div>
  );
});

BillingAuthForm.displayName = 'BillingAuthForm';
export default BillingAuthForm;
