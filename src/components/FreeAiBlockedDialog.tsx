import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { LogIn, Coins } from 'lucide-react';

interface FreeAiBlockedDialogProps {
  open: boolean;
  reason?: string | null;
  onSignIn: () => void;
  onBuyCredits: () => void;
  onClose: () => void;
}

const copyForReason = (reason?: string | null) => {
  switch ((reason || '').toLowerCase()) {
    case 'disabled':
      return {
        title: 'Free AI is unavailable',
        body: "Free AI isn't enabled right now. Sign in to use Snow Media AI, or get Snow Gems to keep generating.",
      };
    case 'rate_limited':
    case 'rate':
      return {
        title: 'Whoa — slow down a sec',
        body: 'You hit the free-tier rate limit. Sign in for unlimited use, or grab some Snow Gems to keep going.',
      };
    case 'device_cap':
    case 'device':
      return {
        title: 'Free daily limit reached',
        body: "You've used today's free AI on this device. Sign in to keep your conversations, or buy Snow Gems to continue now.",
      };
    case 'ip_cap':
    case 'ip':
      return {
        title: 'Free network limit reached',
        body: 'The free tier hit its limit for this network. Sign in for your own credit pool, or buy Snow Gems to continue.',
      };
    case 'global_cap':
    case 'global':
      return {
        title: 'Free AI is taking a break',
        body: 'Our free pool is maxed out right now. Sign in for guaranteed access, or pick up Snow Gems to continue immediately.',
      };
    case 'paused':
      return {
        title: 'AI temporarily paused',
        body: 'Snow Media AI is briefly paused for maintenance. Try again shortly, or sign in / buy credits to be ready when it returns.',
      };
    default:
      return {
        title: "Free AI isn't available",
        body: 'Sign in to use Snow Media AI, or get Snow Gems to keep generating.',
      };
  }
};

const FreeAiBlockedDialog = ({ open, reason, onSignIn, onBuyCredits, onClose }: FreeAiBlockedDialogProps) => {
  const { title, body } = copyForReason(reason);
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
            Sign in
          </Button>
          <Button
            onClick={onBuyCredits}
            className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700 text-white focus:ring-4 focus:ring-brand-ice"
          >
            <Coins className="w-4 h-4 mr-2" />
            Buy Snow Gems
          </Button>
          <Button
            onClick={onClose}
            variant="outline"
            className="w-full sm:w-auto border-slate-500 text-slate-200 hover:bg-slate-700 focus:ring-4 focus:ring-brand-ice"
          >
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default FreeAiBlockedDialog;
