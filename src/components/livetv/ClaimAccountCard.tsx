import { memo, useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { BellRing, Keyboard, Loader2, QrCode, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { trackEvent } from '@/lib/analytics';
import { focusTextInputForDpad, hideKeyboardForDpad } from '@/utils/dpadKeyboard';
import { EDITOR_ACTION_EVENT } from '@/utils/keyboardVisibility';
import { signInWithPlayerCredentials } from '@/lib/playerLogin';
import {
  buildClaimUrl,
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
const FOCUSED_CLS = 'scale-105 z-10';

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

  // Manual view state: name, email, phone typed on the TV. Vertical chain
  // name(0) → email(1) → phone(2) → Save(3) → Back(4).
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const fieldRefs = [nameRef, emailRef, phoneRef];
  const FIELD_COUNT = 3;
  const SAVE_IDX = 3;
  const BACK_IDX = 4;

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
    setName('');
    setEmail('');
    setPhone('');
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

  // --- Manual submit -------------------------------------------------------------
  // One call does it all (player-login with a profile): the line is verified
  // against the panel, the member is recorded in the hub with what they typed,
  // the website account is created for the email, and this box is signed in.
  const submitManual = useCallback(async () => {
    const nm = name.trim();
    const em = email.trim().toLowerCase();
    const ph = phone.trim();
    if (em && !EMAIL_RE.test(em)) {
      setManualError("That email doesn't look right — check it and try again.");
      return;
    }
    if (!em && !ph) {
      setManualError('Add an email or a phone number so we can reach you.');
      return;
    }
    setManualBusy(true);
    setManualError(null);
    try {
      const res = await signInWithPlayerCredentials(account.username, account.password, {
        name: nm || undefined, email: em || undefined, phone: ph || undefined,
      });
      if (res.ok) {
        finishDone('manual', em);
        return;
      }
      if (res.reason === 'no_email' && res.saved) {
        // Phone only: recorded with Snow Media, no website account without an email.
        finishDone('manual', '');
        return;
      }
      if (res.reason === 'email_in_use') {
        setManualError('That email already has a Snow Media account. Sign into it once from My Account, or use a different email here.');
      } else if (res.reason === 'bad_email') {
        setManualError("That email doesn't look right — check it and try again.");
      } else if (res.reason === 'auth_failed' || res.reason === 'panel_unreachable') {
        setManualError("We couldn't verify this box's Live TV sign-in right now — please try again in a minute.");
      } else if (res.reason === 'rate_limited') {
        setManualError('Too many attempts — please wait a few minutes and try again.');
      } else {
        setManualError('Something went wrong — please try the QR option.');
      }
    } catch {
      setManualError('Connection problem — check your network and try again.');
    } finally {
      setManualBusy(false);
    }
  }, [name, email, phone, account, finishDone]);

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
      const typingIdx = fieldRefs.findIndex((r) => r.current && document.activeElement === r.current);
      const typing = typingIdx >= 0;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      const isOk = e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;

      // While a field owns DOM focus, text-editing keys pass through; only
      // ArrowUp/Down leave the field (and hide the on-screen keyboard).
      if (v === 'manual' && typing) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          void hideKeyboardForDpad(fieldRefs[typingIdx].current);
          setFocusIdx(e.key === 'ArrowDown' ? Math.min(typingIdx + 1, SAVE_IDX) : Math.max(typingIdx - 1, 0));
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
          if (i === 0) openManual();
          else if (i === 1) { setView('qr'); setFocusIdx(0); }
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
        // manual — vertical chain: name(0) → email(1) → phone(2) → Save(3) → Back(4)
        if (e.key === 'ArrowUp') setFocusIdx((i) => Math.max(0, i - 1));
        else if (e.key === 'ArrowDown') setFocusIdx((i) => Math.min(BACK_IDX, i + 1));
        else if (isOk) {
          const i = focusIdxRef.current;
          if (i < FIELD_COUNT) void focusTextInputForDpad(fieldRefs[i].current);
          else if (i === SAVE_IDX) void submitManual();
          else backToPrompt();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // fieldRefs is a fresh array each render but its refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openManual, backToPrompt, startQrSession, submitManual]);

  // The keyboard's Next key (reported natively) walks name → email → phone
  // and lands on Save after the last one, keyboard away.
  useEffect(() => {
    if (!open) return;
    const onAction = (event: Event) => {
      if ((event as CustomEvent<{ action?: string }>).detail?.action !== 'next') return;
      if (viewRef.current !== 'manual') return;
      const idx = fieldRefs.findIndex((r) => r.current && document.activeElement === r.current);
      if (idx < 0) return;
      if (idx + 1 < FIELD_COUNT) {
        setFocusIdx(idx + 1);
        void focusTextInputForDpad(fieldRefs[idx + 1].current);
      } else {
        void hideKeyboardForDpad(fieldRefs[idx].current);
        setFocusIdx(SAVE_IDX);
      }
    };
    window.addEventListener(EDITOR_ACTION_EVENT, onAction);
    return () => window.removeEventListener(EDITOR_ACTION_EVENT, onAction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep DOM focus in sync with the D-pad cursor.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      if (view === 'manual' && focusIdx < FIELD_COUNT) {
        fieldRefs[focusIdx].current?.focus({ preventScroll: true });
        return;
      }
      document.getElementById(`claim-${view}-btn-${focusIdx}`)?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, focusIdx, qrState]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCloseRef.current('back'); }}>
      <DialogContent
        className="max-w-lg w-full rounded-3xl sm:rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 border-2 border-brand-gold/60 text-white p-0 gap-0 overflow-hidden flex flex-col"
      >
        <div className="px-6 py-4 border-b border-brand-gold/40 flex items-center gap-3 bg-gradient-to-r from-brand-gold/30 via-yellow-500/20 to-brand-gold/30">
          <BellRing className="w-6 h-6 text-brand-gold" />
          <h2 className="text-2xl font-quicksand font-bold text-white leading-tight tracking-tight">
            Finish your Snow Media account
          </h2>
        </div>

        {view === 'prompt' && (
          <>
            <p className="px-6 py-6 text-base font-medium text-slate-100 leading-relaxed">
              Your Live TV login <span className="font-semibold text-white break-all">{account.username}</span> is your Snow Media login. Add your name and an email or phone, and your account is set up for you: renewal reminders, My Account, support and the store, with no second password.
            </p>
            <div className="px-6 py-4 border-t border-brand-gold/30 bg-slate-950/60 flex justify-center gap-3 flex-wrap">
              <Button
                variant="gold"
                id="claim-prompt-btn-0"
                data-focused={focusIdx === 0 ? 'true' : 'false'}
                onClick={openManual}
                className={`h-12 rounded-xl text-base font-semibold tv-ring tv-ring-contrast relative transition-transform duration-150 ease-out ${focusIdx === 0 ? FOCUSED_CLS : ''}`}
              >
                <Keyboard className="w-4 h-4 mr-2" /> Enter it here
              </Button>
              <Button
                variant="white"
                id="claim-prompt-btn-1"
                data-focused={focusIdx === 1 ? 'true' : 'false'}
                onClick={() => { setView('qr'); setFocusIdx(0); }}
                className={`h-12 rounded-xl text-base font-semibold tv-ring relative transition-transform duration-150 ease-out ${focusIdx === 1 ? FOCUSED_CLS : ''}`}
              >
                <QrCode className="w-4 h-4 mr-2" /> Scan QR with your phone
              </Button>
              <Button
                variant="white"
                id="claim-prompt-btn-2"
                data-focused={focusIdx === 2 ? 'true' : 'false'}
                onClick={() => onCloseRef.current('notnow')}
                className={`h-12 rounded-xl text-base font-semibold tv-ring relative transition-transform duration-150 ease-out ${focusIdx === 2 ? FOCUSED_CLS : ''}`}
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
              <div className="py-12 flex flex-col items-center gap-3">
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
                  className={`min-w-[140px] h-12 rounded-xl text-base font-semibold tv-ring tv-ring-contrast relative transition-transform duration-150 ease-out ${focusIdx === 0 ? FOCUSED_CLS : ''}`}
                >
                  <RefreshCw className="w-4 h-4 mr-2" /> Make new QR
                </Button>
              )}
              <Button
                variant="white"
                id={(qrState === 'expired' || qrState === 'error') ? 'claim-qr-btn-1' : 'claim-qr-btn-0'}
                data-focused={focusIdx === ((qrState === 'expired' || qrState === 'error') ? 1 : 0) ? 'true' : 'false'}
                onClick={backToPrompt}
                className={`min-w-[140px] h-12 rounded-xl text-base font-semibold tv-ring relative transition-transform duration-150 ease-out ${focusIdx === ((qrState === 'expired' || qrState === 'error') ? 1 : 0) ? FOCUSED_CLS : ''}`}
              >
                Back
              </Button>
            </div>
          </div>
        )}

        {view === 'manual' && (
          <div className="px-6 py-5 flex flex-col gap-3">
            <p className="text-sm text-white/80 leading-relaxed">
              For <span className="font-semibold text-white break-all">{account.username}</span>. Email or phone, at least one. Press Next on the keyboard to move down.
            </p>
            <Input
              ref={nameRef}
              id="claim-manual-btn-0"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoComplete="off"
              enterKeyHint="next"
              disabled={manualBusy}
              data-focused={focusIdx === 0 ? 'true' : 'false'}
              className="tv-ring h-12 rounded-xl bg-black/30 text-white border-white/20"
            />
            <Input
              ref={emailRef}
              id="claim-manual-btn-1"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email (for your Snow Media account)"
              autoComplete="off"
              enterKeyHint="next"
              disabled={manualBusy}
              data-focused={focusIdx === 1 ? 'true' : 'false'}
              className="tv-ring h-12 rounded-xl bg-black/30 text-white border-white/20"
            />
            <Input
              ref={phoneRef}
              id="claim-manual-btn-2"
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone (optional)"
              autoComplete="off"
              enterKeyHint="done"
              disabled={manualBusy}
              data-focused={focusIdx === 2 ? 'true' : 'false'}
              className="tv-ring h-12 rounded-xl bg-black/30 text-white border-white/20"
            />
            {manualError && <p className="text-red-300 text-sm leading-relaxed">{manualError}</p>}
            <div className="flex justify-center gap-3 pt-1">
              <Button
                variant="gold"
                id="claim-manual-btn-3"
                data-focused={focusIdx === SAVE_IDX ? 'true' : 'false'}
                onClick={() => void submitManual()}
                disabled={manualBusy}
                className={`min-w-[140px] h-12 rounded-xl text-base font-semibold tv-ring tv-ring-contrast relative transition-transform duration-150 ease-out ${focusIdx === SAVE_IDX ? FOCUSED_CLS : ''}`}
              >
                {manualBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                {manualBusy ? 'Saving…' : 'Save'}
              </Button>
              <Button
                variant="white"
                id="claim-manual-btn-4"
                data-focused={focusIdx === BACK_IDX ? 'true' : 'false'}
                onClick={backToPrompt}
                disabled={manualBusy}
                className={`min-w-[140px] h-12 rounded-xl text-base font-semibold tv-ring relative transition-transform duration-150 ease-out ${focusIdx === BACK_IDX ? FOCUSED_CLS : ''}`}
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
