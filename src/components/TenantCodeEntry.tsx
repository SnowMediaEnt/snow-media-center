import { useEffect, useRef, useState } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { Loader2, Delete } from 'lucide-react';
import smeLogo from '@/assets/sme-logo-512.png';

// First-run screen for "universal" builds (VITE_TENANT_CODE='ask') only.
// Default focus = Snow Media Center primary card; secondary numeric keypad
// below for resellers. NOT shown in dedicated SMC or baked-reseller builds.
const TenantCodeEntry = () => {
  const { setTenantCode } = useTenant();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const smcRef = useRef<HTMLButtonElement>(null);
  // Focus the SMC primary option on mount so OK/Enter on remote = SMC.
  useEffect(() => {
    smcRef.current?.focus();
  }, []);

  const selectSnowMedia = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const ok = await setTenantCode('snowmedia');
    if (!ok) {
      setError('Could not load Snow Media Center. Try again.');
      setBusy(false);
    }
  };

  const submitCode = async () => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    const ok = await setTenantCode(trimmed);
    if (!ok) {
      setError('Invalid code — check with your provider.');
      setBusy(false);
    }
  };

  const appendDigit = (d: string) => {
    if (busy) return;
    setError(null);
    setCode((c) => (c + d).slice(0, 12));
  };
  const backspace = () => {
    if (busy) return;
    setError(null);
    setCode((c) => c.slice(0, -1));
  };

  const keypadBtn =
    'h-16 rounded-xl text-2xl font-semibold bg-white/10 border border-white/20 text-white ' +
    'hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-sky-300 focus:bg-white/25 ' +
    'transition-all focus:scale-105';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6 overflow-auto"
      style={{ background: 'linear-gradient(180deg, #092145 0%, #051633 100%)' }}
    >
      <div className="w-full max-w-2xl text-center text-white">
        <h1 className="text-4xl md:text-5xl font-bold mb-2">Welcome</h1>
        <p className="text-base md:text-lg text-sky-200/80 mb-8">
          Choose your experience
        </p>

        {/* PRIMARY: Snow Media Center — focused by default */}
        <button
          ref={smcRef}
          type="button"
          onClick={selectSnowMedia}
          disabled={busy}
          className="group w-full rounded-2xl bg-gradient-to-b from-white/15 to-white/5 border-2 border-white/30
                     hover:border-white/60 focus:outline-none focus:ring-4 focus:ring-sky-300
                     focus:border-sky-300 focus:scale-[1.02] transition-all p-6 mb-8"
        >
          <div className="flex items-center gap-5 justify-center">
            <img
              src={smeLogo}
              alt="Snow Media Center"
              className="w-20 h-20 md:w-24 md:h-24 object-contain drop-shadow-lg"
            />
            <div className="text-left">
              <div className="text-2xl md:text-3xl font-bold">Snow Media Center</div>
              <div className="text-sm md:text-base text-sky-200/80">
                Press OK to continue
              </div>
            </div>
            {busy && <Loader2 className="w-6 h-6 animate-spin ml-2" />}
          </div>
        </button>

        {/* SECONDARY: reseller numeric code */}
        <div className="opacity-90">
          <div className="text-sm uppercase tracking-widest text-sky-200/70 mb-3">
            Reseller? Enter your code
          </div>

          <div
            className="mx-auto mb-4 h-14 max-w-xs rounded-lg bg-black/30 border border-white/20
                       flex items-center justify-center text-3xl font-mono tracking-[0.4em] text-white"
            aria-live="polite"
          >
            {code || <span className="text-white/30 tracking-normal text-base">------</span>}
          </div>

          {error && <p className="text-rose-300 text-sm mb-3">{error}</p>}

          <div className="mx-auto max-w-xs grid grid-cols-3 gap-2">
            {['1','2','3','4','5','6','7','8','9'].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => appendDigit(d)}
                disabled={busy}
                className={keypadBtn}
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              onClick={backspace}
              disabled={busy}
              aria-label="Backspace"
              className={keypadBtn}
            >
              <Delete className="w-6 h-6 mx-auto" />
            </button>
            <button
              type="button"
              onClick={() => appendDigit('0')}
              disabled={busy}
              className={keypadBtn}
            >
              0
            </button>
            <button
              type="button"
              onClick={submitCode}
              disabled={busy || !code.trim()}
              className={
                'h-16 rounded-xl text-lg font-bold bg-sky-500 text-white border border-sky-300 ' +
                'hover:bg-sky-400 focus:outline-none focus:ring-4 focus:ring-white/60 focus:scale-105 ' +
                'transition-all disabled:opacity-40'
              }
            >
              {busy ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Go'}
            </button>
          </div>

          <p className="mt-5 text-xs text-sky-200/50">
            You can change this later from Settings.
          </p>
        </div>
      </div>
    </div>
  );
};

export default TenantCodeEntry;
