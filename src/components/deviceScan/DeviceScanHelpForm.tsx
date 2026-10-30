// Support › Device check › Get help (ported from Tronix DeviceCheckHelpForm).
// The scan goes as text with an optional note: signed in, as a ticket of the
// account's own (the Buffering Guide's ticket path); not signed in, as
// report-channel's guest report with a name and an email or phone, both
// required (lib/deviceScanSend).
//
// TV: the form on the left, what is sent on the right (the TV's width, no
// tall narrow card); ▲▼ through the boxes, ◀▶ between Send and Cancel, OK on
// a box opens the keyboard, Back closes the keyboard, then the form (one step:
// back to the check). A phone: one column.
import { memo, useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BackButton } from '@/components/ui/BackButton';
import { gridNavigation, useTVFocus } from '@/hooks/useTVFocus';
import { usePlatformBack } from '@/hooks/usePlatformBack';
import { useOwnHardwareBack } from '@/hooks/useOwnHardwareBack';
import { useAuth } from '@/hooks/useAuth';
import { useSupportTickets } from '@/hooks/useSupportTickets';
import { usePhoneLayout } from '@/lib/phoneMode';
import { keepTypingFocus } from '@/utils/keepTypingFocus';
import {
  CONTACT_MAX, NAME_MAX, NOTE_MAX, contactOk, sendDeviceScanGuest, sendDeviceScanTicket, ticketMessage, type SendResult,
} from '@/lib/deviceScanSend';

interface Props {
  /** Signed in (an account): a ticket. Not: the guest form. */
  signedIn: boolean;
  subject: string;
  summary: string;
  /** Back / Cancel / Done: the check again. */
  onBack: () => void;
  /** "Open my tickets" after a ticket was sent. */
  onOpenTickets?: () => void;
}

const DeviceScanHelpForm = memo(({ signedIn, subject, summary, onBack, onOpenTickets }: Props) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { createTicket } = useSupportTickets(user);
  // A viewer whose session ran out while the form was open: the guest way.
  const [guest, setGuest] = useState(!signedIn);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SendResult | null>(null);
  // A phone stacks the name and the contact; a TV has them side by side.
  const phone = usePhoneLayout() !== null;
  const sentTicket = !!sent?.ok && (sent as { ticket?: boolean }).ticket === true;

  const nav = useMemo(() => {
    if (sent?.ok) return gridNavigation([sentTicket && onOpenTickets ? ['dss-tickets', 'dss-done'] : ['dss-done']]);
    return gridNavigation([
      ['dss-back'],
      ...(guest ? (phone ? [['dss-name'], ['dss-contact']] : [['dss-name', 'dss-contact']]) : []),
      ['dss-note'],
      ['dss-send', 'dss-cancel'],
    ]);
  }, [guest, sent, sentTicket, onOpenTickets, phone]);

  const { containerRef, focusProps, focusById, currentFocusId } = useTVFocus({
    navigation: nav,
    initialFocusId: guest ? 'dss-name' : 'dss-note',
    onBack,
    scrollBlock: 'nearest',
  });
  // The remote's Back on a box, the system Back on a phone: the same one step.
  useOwnHardwareBack(true, onBack);
  usePlatformBack(true, onBack);
  const focusSoon = useCallback((id: string) => {
    window.requestAnimationFrame(() => { focusById(id); });
  }, [focusById]);

  const sendingRef = useRef(false);
  const send = useCallback(async (e?: FormEvent) => {
    e?.preventDefault();
    if (sendingRef.current) return;
    if (guest && !name.trim()) { setError(t('deviceScan.send.needName')); focusSoon('dss-name'); return; }
    if (guest && !contactOk(contact)) { setError(t('deviceScan.send.needContact')); focusSoon('dss-contact'); return; }
    sendingRef.current = true;
    setBusy(true);
    setError(null);
    const message = ticketMessage(note, summary);
    const res = guest
      ? await sendDeviceScanGuest(name, contact, subject, message)
      : await sendDeviceScanTicket(createTicket, subject, message);
    sendingRef.current = false;
    setBusy(false);
    const reason = res.ok ? null : (res as { reason?: string }).reason ?? 'failed';
    if (reason === 'sign_in_required' && !guest) {
      // The session ran out: ask for a name and contact instead.
      setGuest(true);
      setError(t('deviceScan.send.needName'));
      focusSoon('dss-name');
      return;
    }
    if (res.ok) {
      setSent(res);
      focusSoon((res as { ticket?: boolean }).ticket && onOpenTickets ? 'dss-tickets' : 'dss-done');
      return;
    }
    setError(reason === 'rate_limited' ? t('deviceScan.send.tooMany')
      : reason === 'name_required' ? t('deviceScan.send.needName')
        : reason === 'contact_required' ? t('deviceScan.send.needContact')
          : t('deviceScan.send.failed'));
    focusSoon('dss-send');
  }, [guest, name, contact, note, summary, subject, createTicket, focusSoon, onOpenTickets, t]);

  const fieldCls = 'rounded-lg h-10 bg-black/30 text-white border-white/20 focus-visible:ring-0 focus-visible:ring-offset-0';
  const labelCls = 'block text-brand-ice text-sm mb-1';

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      data-device-scan-send=""
      className="fixed top-0 left-0 right-0 bottom-0 z-[111] flex flex-col text-white bg-[#060d18]"
    >
      <div className="flex items-center px-6 py-3 border-b border-white/10 bg-[#0a1628]">
        <BackButton onClick={onBack} label={t('common.back')} {...focusProps('dss-back')} focusId="dss-back"
          focused={currentFocusId === 'dss-back'} className="h-10 px-4 text-base" />
        <Send className="w-6 h-6 ml-3 mr-2 text-brand-gold flex-shrink-0" aria-hidden="true" />
        <h1 className="text-2xl font-bold truncate">{t('deviceScan.send.title')}</h1>
      </div>
      <div className="tv-scroll-container flex-1 min-h-0 overflow-auto px-6 py-4">
        <div className="w-full md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-x-6">
          <form onSubmit={send} onMouseDown={keepTypingFocus} autoComplete="off" className="min-w-0">
            {sent?.ok ? (
              <div data-device-scan-sent="">
                <p className="flex items-center text-lg" role="status">
                  <CheckCircle2 className="w-6 h-6 mr-2 text-emerald-300 flex-shrink-0" aria-hidden="true" />
                  {sentTicket ? t('deviceScan.send.sentTicket') : t('deviceScan.send.sent')}
                </p>
                <div className="mt-4 flex items-stretch">
                  {sentTicket && onOpenTickets && (
                    <Button type="button" variant="gold" {...focusProps('dss-tickets')} data-focused={currentFocusId === 'dss-tickets' ? 'true' : 'false'}
                      onClick={onOpenTickets} className="tv-ring tv-ring-contrast h-10 px-5 rounded-lg text-base mr-3">{t('deviceScan.send.openTickets')}</Button>
                  )}
                  <Button type="button" variant="outline" {...focusProps('dss-done')} data-focused={currentFocusId === 'dss-done' ? 'true' : 'false'}
                    onClick={onBack} className="tv-ring h-10 px-5 rounded-lg text-base bg-transparent text-white border-white/30">{t('deviceScan.send.doneBtn')}</Button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-brand-ice/80 mb-3">
                  {guest ? t('deviceScan.send.introGuest') : t('deviceScan.send.intro')}
                </p>
                {guest && (
                  <div className="md:grid md:grid-cols-2 md:gap-x-3">
                    <div className="mb-2 min-w-0">
                      <label htmlFor="dss-name" className={labelCls}>{t('deviceScan.send.name')}</label>
                      <Input id="dss-name" {...focusProps('dss-name')} data-focused={currentFocusId === 'dss-name' ? 'true' : 'false'} value={name}
                        onChange={(e) => { setName(e.target.value); setError(null); }}
                        className={`tv-ring ${fieldCls}`} maxLength={NAME_MAX} autoComplete="off" disabled={busy} enterKeyHint="next" />
                    </div>
                    <div className="mb-2 min-w-0">
                      <label htmlFor="dss-contact" className={labelCls}>{t('deviceScan.send.contact')}</label>
                      <Input id="dss-contact" dir="ltr" {...focusProps('dss-contact')} data-focused={currentFocusId === 'dss-contact' ? 'true' : 'false'} value={contact}
                        onChange={(e) => { setContact(e.target.value); setError(null); }}
                        placeholder={t('deviceScan.send.contactPlaceholder')} className={`tv-ring ${fieldCls}`} maxLength={CONTACT_MAX}
                        autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy} enterKeyHint="next" />
                    </div>
                  </div>
                )}
                <div className="mb-2">
                  <label htmlFor="dss-note" className={labelCls}>{t('deviceScan.send.note')}</label>
                  <Textarea id="dss-note" {...focusProps('dss-note')} data-focused={currentFocusId === 'dss-note' ? 'true' : 'false'} value={note}
                    onChange={(e) => { setNote(e.target.value); setError(null); }}
                    placeholder={t('deviceScan.send.notePlaceholder')} maxLength={NOTE_MAX} rows={3}
                    className="tv-ring rounded-lg min-h-0 text-base bg-black/30 text-white border-white/20 focus-visible:ring-0 focus-visible:ring-offset-0 resize-none"
                    disabled={busy} />
                </div>
                {error && <p role="alert" className="mt-1 text-sm text-red-300" data-device-scan-send-error="">{error}</p>}
                <div className="mt-3 flex items-stretch">
                  <Button type="submit" variant="gold" {...focusProps('dss-send')} data-focused={currentFocusId === 'dss-send' ? 'true' : 'false'} disabled={busy}
                    className="tv-ring tv-ring-contrast flex-1 h-10 rounded-lg text-base">
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : null}
                    {busy ? t('deviceScan.send.sending') : t('deviceScan.send.send')}
                  </Button>
                  <Button type="button" variant="outline" {...focusProps('dss-cancel')} data-focused={currentFocusId === 'dss-cancel' ? 'true' : 'false'} onClick={onBack} disabled={busy}
                    className="tv-ring ml-3 flex-shrink-0 min-w-[120px] h-10 rounded-lg text-base bg-transparent text-white border-white/30">
                    {t('common.cancel')}
                  </Button>
                </div>
              </>
            )}
          </form>
          <div className="min-w-0 mt-4 md:mt-0">
            <p className="text-xs text-white/70 mb-1">{t('deviceScan.send.includes')}</p>
            <pre dir="ltr" data-device-scan-summary=""
              className="text-xs leading-snug font-mono whitespace-pre-wrap break-words rounded-lg bg-black/30 border border-white/10 px-3 py-2 text-white/80 max-h-[60vh] overflow-auto">
              {summary}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
});

DeviceScanHelpForm.displayName = 'DeviceScanHelpForm';
export default DeviceScanHelpForm;
