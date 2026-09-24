// "Type on your phone": while a text box has focus on the TV, a small card in
// the top corner (clear of the TV keyboard) offers the phone remote — the
// pairing QR and code, or, with a phone already connected, a note that its
// keyboard is ready. Turned off under Settings → Phone Remote.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { PHONE_REMOTE_EVENT, connectedPhones, typingHintEnabled } from '@/lib/phoneRemote';

// The QR (and the qrcode library) only when a text box has focus, not with Home.
const PairingQR = lazy(() => import('@/components/remote/PairingQR'));

const isTextField = (el: Element | null): boolean => {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (!(el instanceof HTMLInputElement)) return false;
  return ['text', 'search', 'email', 'password', 'url', 'tel', 'number'].includes((el.type || 'text').toLowerCase()) && !el.readOnly;
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

  if (!typing || !typingHintEnabled()) return null;
  const connected = connectedPhones() > 0;
  return (
    <div className="fixed top-4 right-4 z-[180] pointer-events-none rounded-2xl border border-white/20 px-4 py-3 text-white shadow-2xl" style={{ backgroundColor: 'rgba(7, 27, 58, 0.95)' }}>
      <div className="flex items-center mb-2">
        <Smartphone className="w-5 h-5 text-brand-gold mr-2" />
        <span className="font-semibold">{connected ? 'Your phone keyboard is ready' : 'Type on your phone'}</span>
      </div>
      {connected
        ? <p className="text-sm text-white/70 max-w-[16rem]">Type on the phone remote and it appears here.</p>
        : <Suspense fallback={null}><PairingQR size={96} compact /></Suspense>}
    </div>
  );
};

export default PhoneTypingHint;
