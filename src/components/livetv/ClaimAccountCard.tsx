import { memo, useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { BellRing, Keyboard, Loader2, QrCode, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { trackEvent } from '@/lib/analytics';
import { focusTextInputForDpad, hideKeyboardForDpad } from '@/utils/dpadKeyboard';
import {
  buildClaimUrl,
  claimAccountManual,
  createClaimSession,
  getClaimSession,
  markClaimDone,
} from '@/lib/accountClaim';
import type { PlayerAccount } from '@/lib/xtream';

export type ClaimCloseOutcome = 'notnow' | 'back' | 'done';

interface Props {
  open: boolean;
  account: PlayerAccount;
  onClose: (outcome: ClaimCloseOutcome, email?: string) => void;
}

type View = 'prompt' | 'qr' | 'manual';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const FOCUSED_CLS = 'ring-4 ring-brand-ice scale-105';

/**
 * "Get renewal reminders" card for player-only users. Styled after
 * ExpirationNoticeDialog and owns the keyboard while open: capture phase,
 * preventDefault + stopPropagation only (no stopImmediatePropagation on
 * arrows), focus clamped — never wrapped.
 *
 * Views: prompt (Scan QR / Enter email / Not now) → qr (session QR + polling)
 * or manual (on-screen keyboard email). Back from the prompt closes the card
 * (session-only); Back from qr/manual returns to the prompt; "Not now" is the
 * 7-day dismissal (handled by the caller via the outcome).
 */
const ClaimAccountCard = memo(({ open, account, onClose }: Props) => {
  const [view, setView] = useState<View>('prompt');
  const [focusIdx, setFocusIdx] = useState(0);

  // QR view state
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrState, setQrState] = useState<'loading' | 'ready' | 'expired' | 'error'>('loading');

  // Manual view state
  const [email, setEmail] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Refs so the capture-phase keyboard handler never goes stale.
  const viewRef = useRef(view);
  const focusIdxRef = useRef(focusIdx);
  const qrStateRef = useRef(qrState);
  const onCloseRef = useRef(onClose);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { focusIdxRef.current = focusIdx; }, [focusIdx]);
  useEffect(() => { qrStateRef.current = qrState; }, [qrState]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // Reset everything each time the card opens.
  useEffect(() => {
    if (!open) return;
    setView('prompt');
    setFocusIdx(0);
    setQrUrl(null);
    setQrToken(null);
    setQrState('loading');
    setEmail('');
    setManualBusy(false);
    setManualError(null);
  }, [open]);

  const finishDone = useCallback((method: 'qr' | 'manual', doneEmail: string) => {
    markClaimDone(account.host, account.username, doneEmail);
    try { trackEvent('claim_completed', 'player', { method, server: account.serverLabel }); } catch { /* ignore */ }
    onCloseRef.current('done', doneEmail);
  }, [account.host, account.username, account.serverLabel]);

  // --- QR session lifecycle ---------------------------------------------------
  const startQrSession = useCallback(async () => {
    setQrState('loading');
    setQrUrl(null);
    setQrToken(null);
    setFocusIdx(0);
    try {
      const token = await createClaimSession(account);
      const dataUrl = await QRCode.toDataURL(buildClaimUrl(token), {
        width: 360,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
      });
      setQrToken(token);
      setQrUrl(dataUrl);
      setQrState('ready');
      try { trackEvent('claim_qr_shown', 'player', { server: account.serverLabel }); } catch { /* ignore */ }
    } catch (e) {
      console.warn('[ClaimAccountCard] session create failed:', e);
      setQrState('error');
    }
  }, [account]);

  useEffect(() => {
    if (open && view === 'qr') void startQrSession();
  }, [open, view, startQrSession]);

  // Poll for phone-side completion (same rhythm as the QR login polling).
  useEffect(() => {
    if (!open || view !== 'qr' || qrState !== 'ready' || !qrToken) return;
    let stopped = false;
    const iv = window.setInterval(async () => {
      try {
        const s = await getClaimSession(qrToken);
        if (stopped) return;
        if (!s) { setQrState('expired'); setFocusIdx(0); return; }
        if (s.completed_at) {
          window.clearInterval(iv);
          finishDone('qr', s.claimed_email || '');
        }
      } catch { /* keep polling through transient network errors */ }
    }, 2500);
    return () => { stopped = true; window.clearInterval(iv); };
  }, [open, view, qrState, qrToken, finishDone]);

  // --- Manual email submit ------------------------------------------------------
  const submitManual = useCallback(async () => {
    const em = email.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) {
      setManualError("That email doesn't look right — check it and try again.");
      return;
    }
    setManualBusy(true);
    setManualError(null);
    try {
      const res = await claimAccountManual(account, em);
      if (res.ok) {
        finishDone('manual', res.email || em);
        return;
      }
      if (res.reason === 'signin_not_found') {
        setManualError("We couldn't verify this box's sign-in yet — please use the QR option instead.");
      } else if (res.reason === 'bad_email') {
        setManualError("That email doesn't look right — check it and try again.");
      } else {
        setManualError('Something went wrong — please try the QR option.');
      }
    } catch {
      setManualError('Connection problem — check your network and try again.');
    } finally {
      setManualBusy(false);
    }
  }, [email, account, finishDone]);

  const openManual = useCallback(() => {
    setView('manual');
    setFocusIdx(0);
  }, []);

  const backToPrompt = useCallback(() => {
    setView('prompt');
    setFocusIdx(0);
  }, []);

  // --- Keyboard (D-pad) -----------------------------------------------------------
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const v = viewRef.current;
      const typing = document.activeElement === emailRef.current;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      const isOk = e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;

      // While the email field owns DOM focus, text-editing keys pass through;
      // only ArrowUp/Down leave the field (and hide the on-screen keyboard).
      if (v === 'manual' && typing) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          void hideKeyboardForDpad(emailRef.current);
          setFocusIdx(e.key === 'ArrowDown' ? 1 : 2);
        } else if (isBack) {
          // Let the OSK consume Back natively — never close mid-typing.
          e.stopPropagation();
        }
        return;
      }

      const isArrow = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key);
      if (!isArrow && !isOk && !isBack) return;
      e.preventDefault();
      e.stopPropagation();

      if (isBack) {
        if (v === 'prompt') onCloseRef.current('back');
        else backToPrompt();
        return;
      }

      // QR view has 1 button (Back) while loading/ready, 2 when expired/error.
      const qrBtnCount = (qrStateRef.current === 'expired' || qrStateRef.current === 'error') ? 2 : 1;

      if (v === 'prompt') {
        if (e.key === 'ArrowLeft') setFocusIdx((i) => Math.max(0, i - 1));
        else if (e.key === 'ArrowRight') setFocusIdx((i) => Math.min(2, i + 1));
        else if (isOk) {
          const i = focusIdxRef.current;
          if (i === 0) { setView('qr'); setFocusIdx(0); }
          else if (i === 1) openManual();
          else onCloseRef.current('notnow');
        }
      } else if (v === 'qr') {
        if (e.key === 'ArrowLeft') setFocusIdx((i) => Math.max(0, i - 1));
        else if (e.key === 'ArrowRight') setFocusIdx((i) => Math.min(qrBtnCount - 1, i + 1));
        else if (isOk) {
          const i = focusIdxRef.current;
          if (qrBtnCount === 1) backToPrompt();
          else if (i === 0) void startQrSession();
          else backToPrompt();
        }
      } else {
        // manual — vertical chain: input(0) → Save(1) → Back(2)
        if (e.key === 'ArrowUp') setFocusIdx((i) => Math.max(0, i - 1));
        else if (e.key === 'ArrowDown') setFocusIdx((i) => Math.min(2, i + 1));
        else if (isOk) {
          const i = focusIdxRef.current;
          if (i === 0) void focusTextInputForDpad(emailRef.current);
          else if (i === 1) void submitManual();
          else backToPrompt();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, openManual, backToPrompt, startQrSession, submitManual]);

  // Keep DOM focus in sync with the D-pad cursor.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      if (view === 'manual' && focusIdx === 0) {
        emailRef.current?.focus({ preventScroll: true });
        return;
      }
      document.getElementById(`claim-${view}-btn-${focusIdx}`)?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(t);
  }, [open, view, focusIdx, qrState]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCloseRef.current('back'); }}>
      <DialogContent
        className="max-w-lg w-full bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border-2 border-brand-gold/60 text-white ring-4 ring-brand-gold/30 shadow-[0_0_60px_rgba(212,175,55,0.35)] p-0 overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-brand-gold/40 flex items-center gap-3 bg-gradient-to-r from-brand-gold/30 via-yellow-500/20 to-brand-gold/30">
          <BellRing className="w-6 h-6 drop-shadow text-brand-gold" />
          <h2 className="text-2xl font-bold text-white leading-tight tracking-tight">
            Get renewal reminders
          </h2>
        </div>

        {view === 'prompt' && (
          <>
            <p className="px-6 py-5 text-base font-medium text-slate-100 leading-relaxed">
              Add your email so we can remind you before <span className="font-semibold text-white break-all">{account.username}</span> expires, and let you manage your subscription from your phone.
            </p>
            <div className="px-6 py-4 border-t border-brand-gold/30 bg-slate-950/60 flex justify-center gap-3 flex-wrap">
              <Button
                variant="gold"
                id="claim-prompt-btn-0"
                data-focused={focusIdx === 0 ? 'true' : 'false'}
                onClick={() => { setView('qr'); setFocusIdx(0); }}
                className={`text-base font-semibold py-3 ring-4 ring-brand-ice/40 transition tv-focusable home-focus-surface ${focusIdx === 0 ? FOCUSED_CLS : ''}`}
              >
                <QrCode className="w-4 h-4 mr-2" /> Scan QR with your phone
              </Button>
              <Button
                variant="white"
                id="claim-prompt-btn-1"
                data-focused={focusIdx === 1 ? 'true' : 'false'}
                onClick={openManual}
                className={`text-base font-semibold py-3 ring-4 ring-brand-ice/40 transition tv-focusable home-focus-surface ${focusIdx === 1 ? FOCUSED_CLS : ''}`}
              >
                <Keyboard className="w-4 h-4 mr-2" /> Enter email here
              </Button>
              <Button
                variant="white"
                id="claim-prompt-btn-2"
                data-focused={focusIdx === 2 ? 'true' : 'false'}
                onClick={() => onCloseRef.current('notnow')}
                className={`text-base font-semibold py-3 ring-4 ring-brand-ice/40 transition ${focusIdx === 2 ? FOCUSED_CLS : ''}`}
              >
                Not now
              </Button>
            </div>
          </>
        )}

        {view === 'qr' && (
          <div className="px-6 py-6 flex flex-col items-center gap-4">
            {qrState === 'ready' && qrUrl ? (
              <>
                <div className="bg-white p-3 rounded-xl shadow-lg">
                  <img
                    src={qrUrl}
                    alt="QR code to claim your account on your phone"
                    className="w-[min(42vh,15rem)] h-[min(42vh,15rem)]"
                  />
                </div>
                <p className="text-sm text-white/80 text-center leading-relaxed">
                  Scan with your phone to claim <span className="font-semibold text-white break-all">{account.username}</span> — this screen updates itself when you finish.
                </p>
              </>
            ) : qrState === 'loading' ? (
              <div className="py-10 flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
                <p className="text-white/70 text-sm">Preparing your QR code…</p>
              </div>
            ) : (
              <p className="py-6 text-sm text-white/80 text-center leading-relaxed">
                {qrState === 'expired' ? 'That QR code expired.' : "Couldn't reach the server."} Make a new one to keep going.
              </p>
            )}
            <div className="flex justify-center gap-3">
              {(qrState === 'expired' || qrState === 'error') && (
                <Button
                  variant="gold"
                  id="claim-qr-btn-0"
                  data-focused={focusIdx === 0 ? 'true' : 'false'}
                  onClick={() => void startQrSession()}
                  className={`min-w-[140px] text-base font-semibold py-3 ring-4 ring-brand-ice/40 transition tv-focusable home-focus-surface ${focusIdx === 0 ? FOCUSED_CLS : ''}`}
                >
                  <RefreshCw className="w-4 h-4 mr-2" /> Make new QR
                </Button>
              )}
              <Button
                variant="white"
                id={(qrState === 'expired' || qrState === 'error') ? 'claim-qr-btn-1' : 'claim-qr-btn-0'}
                data-focused={focusIdx === ((qrState === 'expired' || qrState === 'error') ? 1 : 0) ? 'true' : 'false'}
                onClick={backToPrompt}
                className={`min-w-[140px] text-base font-semibold py-3 ring-4 ring-brand-ice/40 transition tv-focusable home-focus-surface ${focusIdx === ((qrState === 'expired' || qrState === 'error') ? 1 : 0) ? FOCUSED_CLS : ''}`}
              >
                Back
              </Button>
            </div>
          </div>
        )}

        {view === 'manual' && (
          <div className="px-6 py-6 flex flex-col gap-4">
            <p className="text-sm text-white/80 leading-relaxed">
              Type the email we should send renewal reminders to for <span className="font-semibold text-white break-all">{account.username}</span>.
            </p>
            <Input
              ref={emailRef}
              id="claim-manual-btn-0"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="off"
              data-tv-allow-enter="true"
              disabled={manualBusy}
              className={`tv-focusable bg-black/30 text-white border-white/20 ${focusIdx === 0 ? 'ring-4 ring-brand-ice/60' : ''}`}
            />
            {manualError && <p className="text-red-300 text-sm leading-relaxed">{manualError}</p>}
            <div className="flex justify-center gap-3">
              <Button
                variant="gold"
                id="claim-manual-btn-1"
                data-focused={focusIdx === 1 ? 'true' : 'false'}
                onClick={() => void submitManual()}
                disabled={manualBusy}
                className={`min-w-[140px] text-base font-semibold py-3 ring-4 ring-brand-ice/40 transition tv-focusable home-focus-surface ${focusIdx === 1 ? FOCUSED_CLS : ''}`}
              >
                {manualBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {manualBusy ? 'Saving…' : 'Save'}
              </Button>
              <Button
                variant="white"
                id="claim-manual-btn-2"
                data-focused={focusIdx === 2 ? 'true' : 'false'}
                onClick={backToPrompt}
                disabled={manualBusy}
                className={`min-w-[140px] text-base font-semibold py-3 ring-4 ring-brand-ice/40 transition tv-focusable home-focus-surface ${focusIdx === 2 ? FOCUSED_CLS : ''}`}
              >
                Back
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});

ClaimAccountCard.displayName = 'ClaimAccountCard';
export default ClaimAccountCard;
