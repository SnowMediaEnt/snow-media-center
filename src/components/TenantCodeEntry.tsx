import { useState } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

// First-run screen for "universal" builds (VITE_TENANT_CODE='ask') where no
// reseller code has been stored yet. TV/remote friendly: large input + on-screen
// confirm button + a secondary "Continue to Canvas by Snow Media" button.
const TenantCodeEntry = () => {
  const { setTenantCode } = useTenant();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    const ok = await setTenantCode(value);
    if (!ok) {
      setError('Invalid code, try again.');
      setBusy(false);
    }
    // On success the provider swaps activeCode and this screen unmounts.
  };

  const onConfirm = () => {
    if (!code.trim() || busy) return;
    void submit(code);
  };

  const onCanvas = () => {
    if (busy) return;
    void submit('canvas');
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-8"
      style={{ background: 'linear-gradient(180deg, #0b1220 0%, #000000 100%)' }}
    >
      <div className="w-full max-w-2xl text-center text-white">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Welcome</h1>
        <p className="text-lg md:text-xl text-slate-300 mb-8">
          Enter your reseller code to activate this device.
        </p>

        <div className="space-y-4">
          <Input
            autoFocus
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(); }}
            placeholder="reseller code"
            disabled={busy}
            className="h-16 text-2xl text-center tracking-wider bg-slate-900/80 border-slate-600 text-white placeholder:text-slate-500"
          />
          {error && (
            <p className="text-rose-400 text-base">{error}</p>
          )}
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy || !code.trim()}
            className="w-full h-14 text-lg bg-blue-600 hover:bg-blue-500 text-white"
          >
            {busy ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : null}
            Activate
          </Button>
        </div>

        <div className="my-8 flex items-center gap-4 text-slate-500">
          <div className="flex-1 h-px bg-slate-700" />
          <span className="text-sm">or</span>
          <div className="flex-1 h-px bg-slate-700" />
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={onCanvas}
          disabled={busy}
          className="w-full h-14 text-lg bg-slate-800/60 border-slate-600 text-white hover:bg-slate-700"
        >
          Continue to Canvas by Snow Media
        </Button>

        <p className="mt-6 text-xs text-slate-500">
          You can change this later from Settings.
        </p>
      </div>
    </div>
  );
};

export default TenantCodeEntry;
