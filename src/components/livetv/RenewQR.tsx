import { memo, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Renewal URL scanned by the phone — username + server label, encoded. */
export const buildRenewUrl = (username: string, serverLabel: string): string =>
  `https://snowmediaent.com/renew?u=${encodeURIComponent(username)}&s=${encodeURIComponent(serverLabel)}`;

interface Props {
  username: string;
  serverLabel: string;
  onBack: () => void;
}

/**
 * Shared "Renew now" QR panel used by ExpirationNoticeDialog,
 * PlexBlockedScreen and AccountInfoScreen. White-background QR of the
 * snowmediaent.com renewal URL. Owns the keyboard while visible:
 * Enter/OK on the Back button and Back/Escape all return to the calling
 * surface (never dismiss outright) via `onBack`.
 */
const RenewQR = memo(({ username, serverLabel, onBack }: Props) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const url = buildRenewUrl(username, serverLabel);

  useEffect(() => {
    let cancelled = false;
    setQrDataUrl(null);
    QRCode.toDataURL(url, { width: 360, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
      .then((d) => { if (!cancelled) setQrDataUrl(d); })
      .catch((e) => console.error('[RenewQR] generation failed', e));
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    setTimeout(() => backRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (['Enter', ' ', 'Escape', 'Backspace'].includes(e.key) || e.keyCode === 4 || e.keyCode === 13 || e.keyCode === 23) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onBack();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onBack]);

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="bg-white p-3 rounded-xl shadow-lg">
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt="Renewal QR code"
            className="w-[min(50vh,16rem)] h-[min(50vh,16rem)]"
          />
        ) : (
          <div className="w-[min(50vh,16rem)] h-[min(50vh,16rem)] flex items-center justify-center">
            <Loader2 className="w-10 h-10 text-slate-700 animate-spin" />
          </div>
        )}
      </div>
      <p className="text-sm text-white/80 text-center leading-relaxed">
        Scan with your phone to renew — <span className="font-semibold text-white break-all">{username}</span>
      </p>
      <Button
        ref={backRef}
        variant="white"
        onClick={onBack}
        data-focused="true"
        className="min-w-[140px] h-12 rounded-xl text-base font-semibold tv-ring relative transition-transform duration-150 ease-out scale-105 z-10"
      >
        <ArrowLeft className="w-4 h-4 mr-2" /> Back
      </Button>
    </div>
  );
});

RenewQR.displayName = 'RenewQR';
export default RenewQR;
