// "Allow this phone?": a phone entered this TV's pairing code, and it gets
// the TV only if the TV's own remote says so. Allow is focused (the person
// who just scanned presses OK); Back or "Don't allow" turns it away. A
// request the TV doesn't answer runs out after two minutes. OK counts only
// once the question has been up a moment, so a press meant for the TV
// keyboard (the question can pop up mid-typing) never allows a phone.
//
// Mounted once, when the app starts (with the typing card), so its key
// listener runs before every screen's own and keeps the keys while it is up.
import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Smartphone } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PHONE_REMOTE_EVENT, answerPhoneRequest, pendingPhoneRequest, type PhoneRequest } from '@/lib/phoneRemote';

const isBack = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.keyCode === 4 || e.keyCode === 27;
const isOk = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;
const isTextField = (el: Element | null): el is HTMLElement => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
/** OK before the question has been up this long is not an answer. */
const ARM_MS = 800;
/** A second Back this soon after one that answered is the same press. */
const BACK_ONCE_MS = 350;

const PhoneRequestPrompt = () => {
  const [request, setRequest] = useState<PhoneRequest | null>(() => pendingPhoneRequest());
  const [focus, setFocus] = useState<0 | 1>(0);
  const [note, setNote] = useState<string | null>(null);
  const requestRef = useRef(request); requestRef.current = request;
  const focusRef = useRef(focus); focusRef.current = focus;
  /** The text box that had focus when the question came up. */
  const typingIn = useRef<HTMLElement | null>(null);
  /** When the question on screen came up (set as it renders, so no key can come first). */
  const shown = useRef<{ rid: string; at: number } | null>(null);
  if (request && shown.current?.rid !== request.rid) shown.current = { rid: request.rid, at: Date.now() };

  useEffect(() => {
    const check = () => setRequest((cur) => {
      const next = pendingPhoneRequest();
      return cur?.rid === next?.rid ? cur : next;
    });
    window.addEventListener(PHONE_REMOTE_EVENT, check);
    // Unanswered requests run out.
    const id = window.setInterval(check, 5_000);
    return () => { window.removeEventListener(PHONE_REMOTE_EVENT, check); window.clearInterval(id); };
  }, []);

  // A new question: Allow first. If the TV's keyboard is up for a text box,
  // close it (by leaving the box) so the remote's keys reach the question.
  // No question any more (answered, or it ran out): back to that text box.
  useEffect(() => {
    if (request) {
      setFocus(0);
      setNote(null);
      const el = document.activeElement;
      if (isTextField(el)) { typingIn.current = el; el.blur(); }
      return;
    }
    const back = typingIn.current;
    typingIn.current = null;
    if (back && back.isConnected) window.setTimeout(() => { try { back.focus({ preventScroll: true }); } catch { /* gone */ } }, 0);
  }, [request]);

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 4_000);
    return () => window.clearTimeout(t);
  }, [note]);

  const answer = useCallback((allow: boolean) => {
    const r = requestRef.current;
    if (!r) return;
    // Answered now, not at the next render: a key arriving in between is
    // not for this question.
    requestRef.current = null;
    setRequest(null);
    void answerPhoneRequest(r.rid, allow).then((ok) => {
      if (!ok) setNote("Couldn't reach Snow Media Center's server. Try pairing again from the phone.");
      else if (allow) setNote('Phone allowed. It can control this TV now.');
    });
  }, []);

  const lastBack = useRef(0);
  useEffect(() => {
    const back = () => {
      if (!requestRef.current) return;
      const now = Date.now();
      if (now - lastBack.current < BACK_ONCE_MS) return;
      lastBack.current = now;
      (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = now;
      answer(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!requestRef.current) {
        // The same Back, passed on as an Escape keydown by a screen that
        // owns the hardware Back (Live TV): it already closed the question.
        if (isBack(e) && Date.now() - lastBack.current < BACK_ONCE_MS) { e.stopImmediatePropagation(); e.preventDefault(); }
        return;
      }
      e.stopImmediatePropagation();
      if (isBack(e)) { e.preventDefault(); back(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault(); setFocus((f) => (f === 0 ? 1 : 0)); return;
      }
      // A held OK, or one pressed as the question came up (meant for the TV
      // keyboard), is not an answer.
      if (isOk(e)) { e.preventDefault(); if (!e.repeat && Date.now() - (shown.current?.at ?? 0) >= ARM_MS) answer(focusRef.current === 0); }
    };
    window.addEventListener('keydown', onKey, true);
    let handle: { remove: () => void } | null = null;
    let cancelled = false;
    void CapApp.addListener('backButton', back).then((h) => { if (cancelled) h.remove(); else handle = h; }).catch(() => { /* web */ });
    return () => { window.removeEventListener('keydown', onKey, true); cancelled = true; handle?.remove(); };
  }, [answer]);

  if (!request) {
    if (!note) return null;
    return (
      <div className="fixed z-[190] left-0 right-0 flex justify-center pointer-events-none" style={{ top: 'var(--tv-safe-block, 2rem)' }} role="status">
        <div className="rounded-2xl border border-white/20 px-5 py-3 text-white shadow-2xl" style={{ backgroundColor: 'rgba(7, 27, 58, 0.95)' }}>{note}</div>
      </div>
    );
  }
  const btn = (i: 0 | 1) => `tv-ring rounded-xl px-6 py-3 text-lg font-semibold ${focus === i ? 'bg-white text-black' : 'bg-white/10 text-white'}`;
  return (
    <div className="fixed top-0 left-0 right-0 bottom-0 z-[190] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" data-state="open" aria-label="Allow this phone?">
      <Card className="w-full max-w-xl bg-gradient-to-br from-blue-900 to-slate-900 border-brand-gold/50 p-7 shadow-2xl text-white">
        <div className="flex items-center mb-3">
          <Smartphone className="w-7 h-7 text-brand-gold mr-3" />
          <h2 className="text-3xl font-bold">Allow this phone?</h2>
        </div>
        <p className="text-lg text-white/80 mb-2">{request.device} entered this TV's code and wants to be a remote for Snow Media Center.</p>
        <p className="text-base text-white/60 mb-6">Allow it only if it's your phone, or the phone of someone in the room.</p>
        <div className="flex">
          <button type="button" data-focused={focus === 0 ? 'true' : 'false'} className={`${btn(0)} mr-3`} onClick={() => answer(true)}>Allow</button>
          <button type="button" data-focused={focus === 1 ? 'true' : 'false'} className={btn(1)} onClick={() => answer(false)}>Don't allow</button>
        </div>
      </Card>
    </div>
  );
};

export default PhoneRequestPrompt;
