import { useEffect, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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
  /**
   * Override for the notice shown under the QR code. Defaults to the store
   * sign-in notice (CreditStore / MediaStore). Pass null to hide it entirely.
   */
  checkoutNotice?: { title: ReactNode; body: ReactNode } | null;
}

export const QRCheckoutDialog = ({
  open,
  onOpenChange,
  url,
  title,
  description,
  onConfirmPaid,
  confirming = false,
  confirmLabel,
  checkoutNotice,
}: QRCheckoutDialogProps) => {
  const { t } = useTranslation();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !url) { setQrDataUrl(null); return; }
    QRCode.toDataURL(url, { width: 360, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } })
      .then(setQrDataUrl)
      .catch((e) => console.error('QR generation failed', e));
  }, [open, url]);

  const notice =
    checkoutNotice === undefined
      ? {
          title: t('billing.qrCheckout.noticeTitle'),
          body: (
            <Trans i18nKey="billing.qrCheckout.noticeBody" components={[<span key="same" className="font-semibold" />]} />
          ),
        }
      : checkoutNotice;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-blue-500/40 text-white w-[92vw] max-w-md max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl">
            <Smartphone className="w-6 h-6 text-blue-400" />
            {title ?? t('billing.qrCheckout.title')}
          </DialogTitle>
          <DialogDescription className="text-blue-200">
            {description ?? t('billing.qrCheckout.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <div className="bg-white p-3 rounded-lg shadow-lg">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt={t('billing.qrCheckout.qrAlt')} className="w-[min(60vh,18rem)] h-[min(60vh,18rem)]" />
            ) : (
              <div className="w-[min(60vh,18rem)] h-[min(60vh,18rem)] flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-slate-700 animate-spin" />
              </div>
            )}
          </div>

          <div className="text-center space-y-2 w-full">
            <p className="text-sm text-white/70">
              {t('billing.qrCheckout.pointCamera')}
            </p>
            {notice && (
              <div className="bg-blue-600/15 border border-blue-400/40 rounded-md p-3 text-left text-xs text-blue-100 space-y-1">
                <p className="font-semibold text-blue-200">{notice.title}</p>
                <p>{notice.body}</p>
              </div>
            )}
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline break-all"
              >
                <ExternalLink className="w-3 h-3" />
                {t('billing.qrCheckout.openLink')}
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
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('billing.qrCheckout.verifying')}</>
              ) : (
                confirmLabel ?? t('billing.qrCheckout.confirmDefault')
              )}
            </Button>
          )}

          <Button
            onClick={() => onOpenChange(false)}
            variant="outline"
            className="w-full bg-blue-600/20 border-blue-400/50 text-white hover:bg-blue-600/30"
          >
            {t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default QRCheckoutDialog;
