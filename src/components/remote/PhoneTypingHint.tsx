// "Type on your phone": while a text box has focus on the TV, a small card in
// the top corner (clear of the TV keyboard, inside the overscan margin)
// offers the phone remote — the pairing QR and code, or, with a phone
// already connected, a note that its keyboard is ready. It shows a few times
// (TYPING_HINT_SHOWINGS) and then turns itself off, or at once with "Don't
// show again"; Settings → Phone Remote turns it back on. Also hosts "Allow this phone?", which a phone
// that entered a code (here or in Settings) raises.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import PhoneRequestPrompt from '@/components/remote/PhoneRequestPrompt';
import { toast } from '@/hooks/use-toast';
import {
  PHONE_REMOTE_EVENT, TYPING_HINT_SHOWINGS, connectedPhones, countTypingHint, setTypingHintEnabled, typingHintEnabled,
} from '@/lib/phoneRemote';

// The QR code (and the qrcode library) loads only when this card first shows.
const PairingQR = lazy(() => import('@/components/remote/PairingQR'));

const isTextField = (el: Element | null): boolean => {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (!(el instanceof HTMLInputElement)) return false;
  return ['text', 'search', 'email', 'password', 'url', 'tel', 'number'].includes((el.type || 'text').toLowerCase()) && !el.readOnly;
};

/** Big enough to scan from the couch on a 1080p layout, still a corner card at 540p. */
const qrSize = (): number => {
  try { return Math.round(Math.min(200, Math.max(96, window.innerHeight * 0.18))); } catch { return 96; }
};

const PhoneTypingHint = () => {
  const [typing, setTyping] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    let t: number | null = null;
    const check = () => {
      if (t) window.clearTimeout(t);
      // Let focus settle (moving between two boxes is not "stopped typing").
      t = window.setTimeout(() => setTyping(isTextField(document.activeElement)), 150);
    };
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    const onChange = () => setTick((n) => n + 1);
    window.addEventListener(PHONE_REMOTE_EVENT, onChange);
    return () => {
      if (t) window.clearTimeout(t);
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
      window.removeEventListener(PHONE_REMOTE_EVENT, onChange);
    };
  }, []);

  // One showing per text box the remote lands on (moving between two boxes
  // keeps it up). With a phone connected it is a "ready" note, not counted.
  const [card, setCard] = useState<null | { shown: number }>(null);
  useEffect(() => {
    if (!typing) { setCard(null); return; }
    if (!typingHintEnabled()) return;
    if (connectedPhones() > 0) { setCard({ shown: 0 }); return; }
    const shown = countTypingHint();
    // The last showing: off from now on (Settings shows the switch off).
    if (shown >= TYPING_HINT_SHOWINGS) setTypingHintEnabled(false);
    setCard({ shown });
  }, [typing]);

  const hideForGood = () => {
    setTypingHintEnabled(false);
    setCard(null);
    toast({ title: 'Phone keyboard card off', description: 'Turn it back on any time in Settings → Phone Remote.' });
  };

  const connected = connectedPhones() > 0;
  const last = !!card && card.shown >= TYPING_HINT_SHOWINGS;
  const left = card ? TYPING_HINT_SHOWINGS - card.shown : 0;
  return (
    <>
      <PhoneRequestPrompt />
      {typing && card && (
        <div
          className="fixed z-[180] pointer-events-none rounded-2xl border border-white/20 px-4 py-3 text-white shadow-2xl"
          style={{ top: 'var(--tv-safe-block)', right: 'var(--tv-safe-inline)', backgroundColor: 'rgba(7, 27, 58, 0.95)' }}
        >
          <div className="flex items-center mb-2">
            <Smartphone className="w-5 h-5 text-brand-gold mr-2" />
            <span className="font-semibold">{connected ? 'Your phone keyboard is ready' : 'Type on your phone'}</span>
          </div>
          {connected
            ? <p className="text-sm text-white/70 max-w-[16rem]">Type on the phone remote and it appears here.</p>
            : <Suspense fallback={null}><PairingQR size={qrSize()} compact /></Suspense>}
          <p className="mt-2 text-xs text-white/60 max-w-[16rem]">
            {last
              ? 'This was the last time. Turn it back on in Settings → Phone Remote.'
              : card.shown > 0
                ? `Shows ${left} more time${left === 1 ? '' : 's'}. On or off in Settings → Phone Remote.`
                : 'On or off in Settings → Phone Remote.'}
          </p>
          {!last && (
            <button
              type="button"
              // Keep the text box focused (and its keyboard up) when tapped.
              onMouseDown={(e) => e.preventDefault()}
              onClick={hideForGood}
              className="pointer-events-auto mt-2 rounded-lg border border-white/25 px-3 py-1 text-xs font-semibold text-white/85 hover:bg-white/10"
            >
              Don&apos;t show again
            </button>
          )}
        </div>
      )}
    </>
  );
};

export default PhoneTypingHint;
