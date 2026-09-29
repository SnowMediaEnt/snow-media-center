import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LogIn, Coins } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface FreeAiBlockedDialogProps {
  open: boolean;
  reason?: string | null;
  onSignIn: () => void;
  onBuyCredits: () => void;
  onClose: () => void;
}

// Which pair of texts to show for the reason the server gave (keys, translated when drawn).
const keyForReason = (reason?: string | null): string => {
  switch ((reason || '').toLowerCase()) {
    case 'disabled': return 'disabled';
    case 'rate_limited':
    case 'rate': return 'rate';
    case 'device_cap':
    case 'device': return 'device';
    case 'ip_cap':
    case 'ip': return 'ip';
    case 'global_cap':
    case 'global': return 'global';
    case 'paused': return 'paused';
    default: return 'default';
  }
};

const FreeAiBlockedDialog = ({ open, reason, onSignIn, onBuyCredits, onClose }: FreeAiBlockedDialogProps) => {
  const { t } = useTranslation();
  const which = keyForReason(reason);
  const title = t(`ai.freeBlocked.${which}Title`);
  const body = t(`ai.freeBlocked.${which}Body`);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-gradient-to-br from-slate-900 to-slate-800 border-brand-gold/40 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-2xl text-brand-gold">{title}</DialogTitle>
          <DialogDescription className="text-slate-200 mt-2">{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2 mt-4">
          <Button
            autoFocus
            onClick={onSignIn}
            className="w-full sm:w-auto bg-brand-gold text-brand-charcoal hover:bg-brand-gold/90 focus:ring-4 focus:ring-brand-ice"
          >
            <LogIn className="w-4 h-4 mr-2" />
            {t('ai.freeBlocked.signInBtn')}
          </Button>
          <Button
            onClick={onBuyCredits}
            className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700 text-white focus:ring-4 focus:ring-brand-ice"
          >
            <Coins className="w-4 h-4 mr-2" />
            {t('ai.freeBlocked.buyGemsBtn')}
          </Button>
          <Button
            onClick={onClose}
            variant="outline"
            className="w-full sm:w-auto border-slate-500 text-slate-200 hover:bg-slate-700 focus:ring-4 focus:ring-brand-ice"
          >
            {t('ai.freeBlocked.notNowBtn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FreeAiBlockedDialog;
