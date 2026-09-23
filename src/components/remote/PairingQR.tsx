// The phone remote's pairing QR and 6-digit code, refreshed when the code
// runs out. Used by Settings → Phone Remote and the "type on your phone" card.
import { memo, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Loader2 } from 'lucide-react';
import { getPairingCode, releasePairingListener, type PairingCode } from '@/lib/phoneRemote';

interface Props {
  /** QR size in px. */
  size?: number;
  /** Small layout for the typing card. */
  compact?: boolean;
}

const PairingQR = memo(({ size = 220, compact = false }: Props) => {
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    getPairingCode()
      .then(async (p) => {
        if (!alive) return;
        setPairing(p);
        const url = await QRCode.toDataURL(p.url, { width: size, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } });
        if (alive) setQr(url);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [round, size]);

  // Gone from the screen: stop listening unless a phone connected meanwhile.
  useEffect(() => () => releasePairingListener(), []);

  // A new code a little before this one runs out.
  useEffect(() => {
    if (!pairing) return;
    const t = window.setTimeout(() => setRound((r) => r + 1), Math.max(10_000, pairing.expiresAt - Date.now() - 15_000));
    return () => window.clearTimeout(t);
  }, [pairing]);

  if (failed) {
    return <p className={`${compact ? 'text-xs' : 'text-sm'} text-amber-300`}>Couldn't get a pairing code — check the internet connection.</p>;
  }
  if (!pairing || !qr) {
    return <div className="flex items-center justify-center" style={{ width: size, height: size }}><Loader2 className="w-6 h-6 animate-spin text-white/70" /></div>;
  }
  const code = `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}`;
  return (
    <div className={`flex ${compact ? 'items-center' : 'flex-col items-center'}`}>
      <img src={qr} alt="QR code to pair your phone" width={size} height={size} className="rounded-lg bg-white" />
      <div className={compact ? 'ml-3' : 'mt-3 text-center'}>
        <div className={`${compact ? 'text-xs' : 'text-sm'} text-white/70`}>or go to <span className="font-semibold text-white">snowmediaent.com/remote</span></div>
        <div className={`${compact ? 'text-2xl' : 'text-4xl'} font-bold tracking-[0.2em] text-brand-gold tabular-nums`}>{code}</div>
      </div>
    </div>
  );
});
PairingQR.displayName = 'PairingQR';

export default PairingQR;
