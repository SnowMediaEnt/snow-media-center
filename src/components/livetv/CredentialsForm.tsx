import { memo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tv, Loader2 } from 'lucide-react';
import { authenticate, normalizeCreds, saveCreds, type XtreamCreds } from '@/lib/xtream';
import { useToast } from '@/hooks/use-toast';

interface Props {
  initial?: Partial<XtreamCreds> | null;
  onSaved: (creds: XtreamCreds) => void;
  onCancel?: () => void;
}

const CredentialsForm = memo(({ initial, onSaved, onCancel }: Props) => {
  const [host, setHost] = useState(initial?.host || '');
  const [username, setUsername] = useState(initial?.username || '');
  const [password, setPassword] = useState(initial?.password || '');
  const [testing, setTesting] = useState(false);
  const { toast } = useToast();

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!host || !username || !password) {
      toast({ title: 'Missing info', description: 'Please fill in host, username and password.', variant: 'destructive' });
      return;
    }
    const creds = normalizeCreds({ host, username, password, output: 'm3u8' });
    setTesting(true);
    try {
      const info: any = await authenticate(creds);
      if (info?.user_info?.auth === 0 || info?.user_info?.status === 'Disabled') {
        throw new Error('Server rejected credentials');
      }
      await saveCreds(creds);
      toast({ title: 'Connected', description: 'Live TV is loading your channels.' });
      onSaved(creds);
    } catch (err) {
      toast({
        title: 'Could not connect',
        description: (err as Error).message || 'Please check your credentials and try again.',
        variant: 'destructive',
      });
    } finally {
      setTesting(false);
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
            <h2 className="text-2xl font-quicksand font-bold text-white">Connect Live TV</h2>
            <p className="text-brand-ice/70 font-nunito text-sm">Enter your Xtream Codes credentials</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="lt-host" className="text-brand-ice font-nunito">Server URL</Label>
            <Input
              id="lt-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="http://your-server.com:8080"
              className="tv-focusable bg-black/30 text-white border-white/20"
              autoComplete="off"
            />
          </div>
          <div>
            <Label htmlFor="lt-user" className="text-brand-ice font-nunito">Username</Label>
            <Input
              id="lt-user"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="tv-focusable bg-black/30 text-white border-white/20"
              autoComplete="off"
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
            />
          </div>
        </div>

        <div className="flex gap-3 mt-8">
          <Button
            type="submit"
            variant="gold"
            disabled={testing}
            className="tv-focusable home-focus-surface flex-1"
          >
            {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {testing ? 'Connecting…' : 'Connect'}
          </Button>
          {onCancel && (
            <Button
              type="button"
              variant="white"
              onClick={onCancel}
              className="tv-focusable home-focus-surface"
            >
              Cancel
            </Button>
          )}
        </div>

        <p className="text-brand-ice/50 text-xs font-nunito mt-6">
          Your credentials are stored only on this device. We never share them.
        </p>
      </form>
    </div>
  );
});

CredentialsForm.displayName = 'CredentialsForm';
export default CredentialsForm;
