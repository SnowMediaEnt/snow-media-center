// The notice for a Download press on an app that now lives inside the
// Player (see src/lib/retiredApps.ts). Same remote handling as
// AppAlertDialog: the dialog owns the keys while it is up, Left/Right move
// between the two buttons, Back dismisses.
import { memo, useEffect, useRef, useState } from 'react';
import { Tv } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { retiredAppMessage, type RetiredApp } from '@/lib/retiredApps';
import { trackEvent } from '@/lib/analytics';

interface RetiredAppDialogProps {
  appName: string | null;
  info: RetiredApp | null;
  open: boolean;
  /** "Open Player": jump to the section the service lives in now. */
  onOpenPlayer: () => void;
  /** "Download anyway": the old APK, for whoever insists. */
  onDownloadAnyway: () => void;
  onDismiss: () => void;
}

const RetiredAppDialog = ({ appName, info, open, onOpenPlayer, onDownloadAnyway, onDismiss }: RetiredAppDialogProps) => {
  const playerRef = useRef<HTMLButtonElement>(null);
  const anywayRef = useRef<HTMLButtonElement>(null);
  const [focused, setFocused] = useState<'player' | 'anyway'>('player');

  const track = (action: string) => {
    try { trackEvent('retired_app_notice', 'alerts', { app: appName, action }); } catch { /* ignore */ }
  };
  const choosePlayer = () => { track('open_player'); onOpenPlayer(); };
  const chooseAnyway = () => { track('download_anyway'); onDownloadAnyway(); };
  const dismiss = () => { track('dismiss'); onDismiss(); };

  useEffect(() => {
    if (!open) return;
    track('shown');
    setFocused('player');
    const t = setTimeout(() => playerRef.current?.focus(), 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        setFocused('player');
        playerRef.current?.focus();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        setFocused('anyway');
        anywayRef.current?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (focused === 'anyway') chooseAnyway();
        else choosePlayer();
      } else if (e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.code === 'GoBack') {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, focused, onOpenPlayer, onDownloadAnyway, onDismiss]);

  if (!appName || !info) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white ring-2 ring-brand-gold/40">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <Tv className="w-7 h-7 text-brand-gold" />
            <DialogTitle className="text-2xl text-white">{appName} is now in the Player</DialogTitle>
          </div>
          <DialogDescription className="text-slate-300 text-base whitespace-pre-wrap">
            {retiredAppMessage(appName, info)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            ref={playerRef}
            variant="gold"
            onClick={choosePlayer}
            className={focused === 'player' ? 'ring-4 ring-brand-ice scale-105' : ''}
          >
            Open Player
          </Button>
          <Button
            ref={anywayRef}
            variant="outline"
            onClick={chooseAnyway}
            className={`bg-slate-800 border-slate-600 text-white hover:bg-slate-700 ${
              focused === 'anyway' ? 'ring-4 ring-brand-ice scale-105' : ''
            }`}
          >
            Download anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default memo(RetiredAppDialog);
