import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Loader2, KeyRound, ArrowLeft, Trash2 } from 'lucide-react';
import { useTVFocus, type TVFocusNavigationMap } from '@/hooks/useTVFocus';
import { useToast } from '@/hooks/use-toast';
import type { XtreamCreds } from '@/lib/xtream';
import { applyServiceToPlayer } from '@/lib/billing';
import { VIBEZ_HOST } from '@/lib/signupLinks';
import { PasswordRevealButton, PASSWORD_REVEAL_PAD } from '@/components/ui/PasswordRevealButton';
import { BTN, BTN_GOLD, CARD, INPUT, SCREEN } from '@/components/billing/shared';
import { focusAttrs, scaleIf, useFocusRecovery } from '@/components/billing/shared';
import { clearPending } from './pending';

interface Props {
  onDone: (creds: XtreamCreds) => void;
  onBack: () => void;
  /** Shown when the viewer is resuming a hand-off from a previous session. */
  resumedLabel?: string | null;
}

/**
 * Type in the Vibez login that was emailed after paying.
 *
 * This deliberately does NOT go through the shared sign-in form. That form
 * routes on the username: pickServerForUsername sends anything without an '@'
 * to Dreamstreams, and authenticateRouted probes that one server with no
 * fallback. A Vibez username like `zg4471x` would be checked against
 * dstreams.xyz and rejected forever, with no way for the viewer to correct it.
 *
 * applyServiceToPlayer resolves the server from the HOST instead and never
 * consults the username, so the line is checked against Vibez as intended.
 */
const VibezSignInScreen = memo(({ onDone, onBack, resumedLabel }: Props) => {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // Show / Hide on the password box: dots every time the screen opens.
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const navigation = useMemo<TVFocusNavigationMap>(() => ({
    'vs-user': { down: 'vs-pass', right: null },
    'vs-pass': { up: 'vs-user', down: 'vs-submit', right: 'vs-pass-show' },
    // Show / Hide inside the password box: Up / Down go where the box's go.
    'vs-pass-show': { up: 'vs-user', down: 'vs-submit', left: 'vs-pass', right: null },
    'vs-submit': { up: 'vs-pass', right: 'vs-back' },
    'vs-back': { up: 'vs-pass', left: 'vs-submit', right: 'vs-forget' },
    'vs-forget': { up: 'vs-pass', left: 'vs-back' },
  }), []);

  const { containerRef, currentFocusId, focusById } = useTVFocus({
    navigation,
    initialFocusId: 'vs-user',
    onBack: () => { if (!busy) onBack(); },
    scrollBlock: 'center',
  });
  useFocusRecovery(containerRef, currentFocusId, focusById, 'vs-submit');

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const u = username.trim();
    const p = password.trim();
    if (!u || !p) {
      toast({ title: t('getStarted.signIn.missingTitle'), description: t('getStarted.signIn.missingDesc'), variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const r = await applyServiceToPlayer({ host: VIBEZ_HOST, username: u, password: p }, 'vibez');
      if (r.ok === false) {
        toast({ title: t('getStarted.signIn.couldNotTitle'), description: r.error, variant: 'destructive' });
        return;
      }
      // A hand-typed login on a flaky connection must not be saved unchecked.
      // applyServiceToPlayer tolerates an unreachable panel because a line it
      // just provisioned is known-good; here the viewer typed it with a remote,
      // so an unverified "success" would persist a typo as a real account.
      if (!r.probed) {
        toast({
          title: t('getStarted.signIn.unreachableTitle'),
          description: t('getStarted.signIn.unreachableDesc'),
          variant: 'destructive',
        });
        return;
      }
      clearPending();
      toast({ title: t('getStarted.signIn.connectedTitle'), description: t('getStarted.signIn.connectedDesc', { username: r.creds.username }) });
      onDone(r.creds);
    } catch (err) {
      toast({ title: t('getStarted.signIn.couldNotTitle'), description: (err as Error).message || t('getStarted.signIn.tryAgainDesc'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={containerRef} className={SCREEN}>
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className={`${CARD} w-full max-w-xl p-8`}>
          <form onSubmit={submit}>
            <h2 className="text-2xl font-quicksand font-bold text-white">{t('getStarted.signIn.title')}</h2>
            <p className="text-brand-ice/80 font-nunito mt-1">
              {resumedLabel
                ? t('getStarted.signIn.introResumed', { label: resumedLabel })
                : t('getStarted.signIn.intro')}
            </p>

            <div className="space-y-4 mt-6">
              <div className="space-y-2">
                <Label htmlFor="vs-user" className="text-brand-ice font-nunito">{t('getStarted.signIn.usernameLabel')}</Label>
                {/* Fire TV's full-screen keyboard covers the form, and the
                    placeholder is the only label it shows. */}
                <Input id="vs-user" autoComplete="off" enterKeyHint="next" disabled={busy} value={username}
                  placeholder={t('getStarted.signIn.usernamePlaceholder')} aria-label={t('getStarted.signIn.usernameAria')}
                  onChange={(e) => setUsername(e.target.value)} className={INPUT}
                  {...focusAttrs(currentFocusId, 'vs-user')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vs-pass" className="text-brand-ice font-nunito">{t('getStarted.signIn.passwordLabel')}</Label>
                {/* No allow-enter: the keyboard's Done closes it and lands on Sign in
                    (useTVFocus); it must not submit behind the viewer's back.
                    Show / Hide sits BEFORE the field so that Done skips it. */}
                <div className="relative">
                  <PasswordRevealButton shown={showPassword} onToggle={() => setShowPassword((v) => !v)} disabled={busy}
                    {...focusAttrs(currentFocusId, 'vs-pass-show')} />
                  <Input id="vs-pass" type={showPassword ? 'text' : 'password'} autoComplete="off" autoCorrect="off"
                    autoCapitalize="none" spellCheck={false} enterKeyHint="done" disabled={busy}
                    placeholder={t('getStarted.signIn.passwordPlaceholder')} aria-label={t('getStarted.signIn.passwordAria')}
                    value={password} onChange={(e) => setPassword(e.target.value)} className={`${INPUT} ${PASSWORD_REVEAL_PAD}`}
                    {...focusAttrs(currentFocusId, 'vs-pass')} />
                </div>
              </div>
            </div>

            {busy && (
              <div className="mt-4 flex items-center gap-3 text-brand-ice/90 font-nunito text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />
                <span>{t('getStarted.signIn.checking')}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-3 mt-7">
              <Button type="submit" variant="gold" disabled={busy}
                className={`${BTN_GOLD} flex-1 ${scaleIf(currentFocusId, 'vs-submit')}`} {...focusAttrs(currentFocusId, 'vs-submit')}>
                <KeyRound className="w-4 h-4 mr-2" /> {t('common.signInAction')}
              </Button>
              <Button type="button" variant="white" disabled={busy} onClick={onBack}
                className={`${BTN} ${scaleIf(currentFocusId, 'vs-back')}`} {...focusAttrs(currentFocusId, 'vs-back')}>
                <ArrowLeft className="w-4 h-4 mr-2" /> {t('common.back')}
              </Button>
              {resumedLabel && (
                <Button type="button" variant="white" disabled={busy}
                  onClick={() => { clearPending(); onBack(); }}
                  className={`${BTN} ${scaleIf(currentFocusId, 'vs-forget')}`} {...focusAttrs(currentFocusId, 'vs-forget')}>
                  <Trash2 className="w-4 h-4 mr-2 shrink-0" /> <span className="min-w-0 truncate">{t('getStarted.signIn.forgetBtn')}</span>
                </Button>
              )}
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
});

VibezSignInScreen.displayName = 'VibezSignInScreen';
export default VibezSignInScreen;
