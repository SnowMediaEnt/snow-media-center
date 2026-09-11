import { memo, useMemo, useState } from 'react';
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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const navigation = useMemo<TVFocusNavigationMap>(() => ({
    'vs-user': { down: 'vs-pass' },
    'vs-pass': { up: 'vs-user', down: 'vs-submit' },
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
      toast({ title: 'Missing info', description: 'Enter the username and password Vibez emailed you.', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      const r = await applyServiceToPlayer({ host: VIBEZ_HOST, username: u, password: p }, 'vibez');
      if (r.ok === false) {
        toast({ title: 'Could not sign in', description: r.error, variant: 'destructive' });
        return;
      }
      // A hand-typed login on a flaky connection must not be saved unchecked.
      // applyServiceToPlayer tolerates an unreachable panel because a line it
      // just provisioned is known-good; here the viewer typed it with a remote,
      // so an unverified "success" would persist a typo as a real account.
      if (!r.probed) {
        toast({
          title: 'Could not reach Vibez',
          description: 'We could not check that login just now. Check the connection and try again.',
          variant: 'destructive',
        });
        return;
      }
      clearPending();
      toast({ title: 'Connected', description: `Signed in to Vibez as ${r.creds.username}.` });
      onDone(r.creds);
    } catch (err) {
      toast({ title: 'Could not sign in', description: (err as Error).message || 'Please try again.', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={containerRef} className={SCREEN}>
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className={`${CARD} w-full max-w-xl p-8`}>
          <form onSubmit={submit}>
            <h2 className="text-2xl font-quicksand font-bold text-white">Enter your Vibez login</h2>
            <p className="text-brand-ice/80 font-nunito mt-1">
              {resumedLabel
                ? `Use the username and password Vibez emailed you for ${resumedLabel}.`
                : 'Use the username and password Vibez emailed you after paying.'}
            </p>

            <div className="space-y-4 mt-6">
              <div className="space-y-2">
                <Label htmlFor="vs-user" className="text-brand-ice font-nunito">Username</Label>
                {/* Fire TV's full-screen keyboard covers the form, and the
                    placeholder is the only label it shows. */}
                <Input id="vs-user" autoComplete="off" disabled={busy} value={username}
                  placeholder="Username from Vibez" aria-label="Vibez username"
                  onChange={(e) => setUsername(e.target.value)} className={INPUT}
                  {...focusAttrs(currentFocusId, 'vs-user')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vs-pass" className="text-brand-ice font-nunito">Password</Label>
                <Input id="vs-pass" type="password" autoComplete="off" disabled={busy} data-tv-allow-enter="true"
                  placeholder="Password from Vibez" aria-label="Vibez password"
                  value={password} onChange={(e) => setPassword(e.target.value)} className={INPUT}
                  {...focusAttrs(currentFocusId, 'vs-pass')} />
              </div>
            </div>

            {busy && (
              <div className="mt-4 flex items-center gap-3 text-brand-ice/90 font-nunito text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-brand-gold" />
                <span>Checking with Vibez…</span>
              </div>
            )}

            <div className="flex flex-wrap gap-3 mt-7">
              <Button type="submit" variant="gold" disabled={busy}
                className={`${BTN_GOLD} flex-1 ${scaleIf(currentFocusId, 'vs-submit')}`} {...focusAttrs(currentFocusId, 'vs-submit')}>
                <KeyRound className="w-4 h-4 mr-2" /> Sign in
              </Button>
              <Button type="button" variant="white" disabled={busy} onClick={onBack}
                className={`${BTN} ${scaleIf(currentFocusId, 'vs-back')}`} {...focusAttrs(currentFocusId, 'vs-back')}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              {resumedLabel && (
                <Button type="button" variant="white" disabled={busy}
                  onClick={() => { clearPending(); onBack(); }}
                  className={`${BTN} ${scaleIf(currentFocusId, 'vs-forget')}`} {...focusAttrs(currentFocusId, 'vs-forget')}>
                  <Trash2 className="w-4 h-4 mr-2" /> I did not buy anything
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
