import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Smartphone, ExternalLink } from 'lucide-react';

interface QRCheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string | null;
  title?: string;
  description?: string;
  /** Called when user clicks "I've completed payment". If omitted, button isn't shown. */
  onConfirmPaid?: () => void | Promise<void>;
  confirming?: boolean;
  confirmLabel?: string;
}

export const QRCheckoutDialog = ({
  open,
  onOpenChange,
  url,
  title = 'Scan to Checkout',
  description = 'Scan this QR code with your phone to complete the payment.',
  onConfirmPaid,
  confirming = false,
  confirmLabel = "I've Completed Payment",
}: QRCheckoutDialogProps) => {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !url) { setQrDataUrl(null); return; }
    QRCode.toDataURL(url, { width: 360, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
      .then(setQrDataUrl)
      .catch((e) => console.error('QR generation failed', e));
  }, [open, url]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-blue-500/40 text-white w-[92vw] max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Smartphone className="w-6 h-6 text-blue-400" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-blue-200">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <div className="bg-white p-3 rounded-lg shadow-lg">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Checkout QR Code" className="w-[min(60vh,18rem)] h-[min(60vh,18rem)]" />
            ) : (
              <div className="w-[min(60vh,18rem)] h-[min(60vh,18rem)] flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-slate-700 animate-spin" />
              </div>
            )}
          </div>

          <div className="text-center space-y-2 w-full">
            <p className="text-sm text-white/70">
              Open your phone camera and point it at the QR code.
            </p>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline break-all"
              >
                <ExternalLink className="w-3 h-3" />
                Or open this link
              </a>
            )}
          </div>

          {onConfirmPaid && (
            <Button
              onClick={() => onConfirmPaid()}
              disabled={confirming}
              className="w-full bg-green-600 hover:bg-green-700 text-white mt-2"
              size="lg"
            >
              {confirming ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying...</>
              ) : (
                confirmLabel
              )}
            </Button>
          )}

          <Button
            onClick={() => onOpenChange(false)}
            variant="outline"
            className="w-full bg-blue-600/20 border-blue-400/50 text-white hover:bg-blue-600/30"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QRCheckoutDialog;
