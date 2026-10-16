// Messages to this TV from the line's owner or from Snow Media (lib/deviceInbox).
// Starts the inbox's check-ins when the app starts and shows what they bring,
// one at a time, over anything — playback included: the native picture sits
// under the transparent WebView, and the card is drawn above it. OK or Back
// reads it (the server is told) and the next one, if any, takes its place.
// Never on a Kids profile and never over "Who's watching?": the messages
// wait in the queue for a grown-up.
//
// Like GameReminderHost, its remote listener is added once, when the app
// starts, so it runs before every screen's own and keeps the keys to itself
// while a message is up — and does nothing at all otherwise.
import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { MessageSquareText } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useTranslation } from 'react-i18next';
import { useActiveProfile } from '@/hooks/useActiveProfile';
import { dismissMessage, pendingMessages, startDeviceInbox, subscribe, type DeviceMessage } from '@/lib/deviceInbox';
import { formatRelative } from '@/i18n/format';

const isBack = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.keyCode === 4 || e.keyCode === 27;
const isOk = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;
/** A press this soon after a message pops up was meant for the screen under it: the message stays. */
export const ARM_MS = 700;

const DeviceMessageHost = ({ blocked = false }: { /** "Who's watching?" is up. */ blocked?: boolean }) => {
  const { t } = useTranslation();
  const { profile } = useActiveProfile();
  const [queue, setQueue] = useState<DeviceMessage[]>(() => pendingMessages());

  useEffect(() => subscribe(setQueue), []);
  useEffect(() => startDeviceInbox(), []);

  // Held, not shown, on a Kids profile or behind the profile picker.
  const current = blocked || profile.kidsLevel ? null : queue[0] ?? null;
  const currentRef = useRef(current); currentRef.current = current;
  const shownAtRef = useRef(0);
  const shownId = current?.id ?? null;
  useEffect(() => { if (shownId) shownAtRef.current = Date.now(); }, [shownId]);

  const close = useCallback(() => {
    const m = currentRef.current;
    if (!m || Date.now() - shownAtRef.current < ARM_MS) return;
    void dismissMessage(m.id);
  }, []);

  const lastBack = useRef(0);
  useEffect(() => {
    const back = () => {
      if (!currentRef.current) return;
      const now = Date.now();
      if (now - lastBack.current < 350) return;
      lastBack.current = now;
      (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = now;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!currentRef.current) return;
      // Every key is ours while a message is up: nothing moves behind it.
      e.stopImmediatePropagation();
      e.preventDefault();
      if (isBack(e)) { back(); return; }
      if (isOk(e) && !e.repeat) close();
    };
    window.addEventListener('keydown', onKey, true);
    let handle: { remove: () => void } | null = null;
    let cancelled = false;
    void CapApp.addListener('backButton', back).then((h) => { if (cancelled) h.remove(); else handle = h; }).catch(() => { /* web */ });
    return () => { window.removeEventListener('keydown', onKey, true); cancelled = true; handle?.remove(); };
  }, [close]);

  if (!current) return null;
  const title = current.sender === 'admin' ? t('lineDevices.message.fromAdmin') : t('lineDevices.message.fromOwner');
  const when = current.created_at ? formatRelative(current.created_at) : '';
  return (
    <div
      className="fixed left-0 top-0 w-full h-full z-[175] bg-black/70 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      data-state="open"
      data-device-message={current.sender}
      aria-label={title}
    >
      <Card className="w-full max-w-xl bg-gradient-to-br from-blue-900 to-slate-900 border-brand-gold/50 p-7 shadow-2xl text-white">
        <div className="flex items-center mb-4">
          <MessageSquareText className="w-8 h-8 text-brand-gold mr-3 shrink-0" />
          <h2 className="text-2xl font-quicksand font-bold min-w-0">{title}</h2>
        </div>
        {/* Plain text: React escapes it, and its line breaks are kept. */}
        <p className="text-xl font-nunito text-white whitespace-pre-line break-words mb-2" data-device-message-body>{current.body}</p>
        {when && (
          <p className="text-sm font-nunito text-brand-ice/70 mb-6">
            {t('lineDevices.message.sentAt', { when: when.charAt(0).toLowerCase() + when.slice(1) })}
          </p>
        )}
        <div className={`flex ${when ? '' : 'mt-6'}`}>
          <button type="button" data-focused="true" className="tv-ring rounded-xl px-8 py-3 text-lg font-semibold bg-white text-black" onClick={() => { shownAtRef.current = 0; close(); }}>
            {t('common.ok')}
          </button>
        </div>
      </Card>
    </div>
  );
};

export default DeviceMessageHost;
