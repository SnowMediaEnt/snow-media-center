import { memo, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tv, Loader2 } from 'lucide-react';
import { authenticateRouted, pickServerForUsername, saveCreds, type XtreamCreds, type XtreamServer } from '@/lib/xtream';
import { useToast } from '@/hooks/use-toast';

interface Props {
  initial?: Partial<XtreamCreds> | null;
  onSaved: (creds: XtreamCreds) => void;
  onCancel?: () => void;
}

const CredentialsForm = memo(({ initial, onSaved, onCancel }: Props) => {
  const [username, setUsername] = useState(initial?.username || '');
  const [password, setPassword] = useState(initial?.password || '');
  const [testing, setTesting] = useState(false);
  const [probingServer, setProbingServer] = useState<XtreamServer | null>(null);
  const { toast } = useToast();

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

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10">
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
          <div>
            <Label htmlFor="lt-user" className="text-brand-ice font-nunito">Username</Label>
            <Input
              id="lt-user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="tv-focusable bg-black/30 text-white border-white/20"
              autoComplete="off"
              disabled={testing}
            />
          </div>
          <div>
            <Label htmlFor="lt-pass" className="text-brand-ice font-nunito">Password</Label>
            <Input
              id="lt-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="tv-focusable bg-black/30 text-white border-white/20"
              autoComplete="off"
              disabled={testing}
            />
          </div>
        </div>

        {testing && (
          <div className="mt-5 flex items-center gap-3 text-brand-ice/90 font-nunito text-sm">
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
            disabled={testing}
            className="tv-focusable home-focus-surface flex-1"
          >
            {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {testing ? 'Signing in…' : 'Sign In'}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="white"
              onClick={onCancel}
              disabled={testing}
              className="tv-focusable home-focus-surface"
            >
              Cancel
            </Button>
          )}
        </div>

        <p className="text-brand-ice/50 text-xs font-nunito mt-6">
          We try {SERVERS.map(s => s.label).join(' and ')} automatically and use whichever one accepts your login.
          Your credentials are stored only on this device.
        </p>
      </form>
    </div>
  );
});

CredentialsForm.displayName = 'CredentialsForm';
export default CredentialsForm;
