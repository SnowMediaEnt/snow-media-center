import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, MonitorSmartphone, PencilLine, RefreshCw, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/ui/BackButton';
import { focusTextInputForDpad, hideKeyboardForDpad } from '@/utils/dpadKeyboard';
import { keepInView } from '@/utils/keepInView';
import { formatRelative } from '@/i18n/format';
import {
  askSupportToSend, lineOwnerStatus, listLineDevices, sendLineMessage, MAX_BODY, type LineDevice, type SendOutcome,
} from '@/lib/deviceInbox';

interface Props {
  /** The line: its server host and username, as Live TV stores them. */
  host: string;
  username: string;
  onBack: () => void;
  /** Drawn beside a menu (Live TV Settings): no header of its own, Back / Left return to the menu. */
  embedded?: boolean;
  /** Embedded only: whether the remote is on this page (false while it is on the menu). */
  active?: boolean;
  /**
   * A TV signed into this line (Live TV Settings): when the owner can't be
   * told apart because the line has no email on file, the message goes to
   * support, who send it on. Not on the admin screen.
   */
  viaSupport?: boolean;
}

/** The three ready-made messages, as keys: translated when drawn and when sent. */
const QUICK = ['lineDevices.panel.quickBusy', 'lineDevices.panel.quickSwitch', 'lineDevices.panel.quickSignOut'] as const;
/** `choice` for "Write your own". */
const CUSTOM = QUICK.length;

/** After the keyboard is put away, its parting Enter is not a press (Amazon's keyboard). */
const DISMISS_GRACE_MS = 700;
/** After the keyboard is asked for, an Enter this soon is the echo of that OK, not "done". */
const OPEN_ECHO_MS = 800;

const isBackKey = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
const isOkKey = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 23;
const swallow = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
const markBack = () => { (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now(); };
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

type Load =
  | { state: 'loading' } | { state: 'ready'; devices: LineDevice[] } | { state: 'error'; reason: string }
  /** No email on file: pick a message, support sends it to the line's TVs. */
  | { state: 'support' };
const REFUSED = new Set(['not_signed_in', 'not_owner']);

/**
 * "Devices on this line": the Snow Media Center installs signed into a Live
 * TV line (lib/deviceInbox), and a short message to some or all of them —
 * a ready-made one or the owner's own, up to 200 characters. The TVs it goes
 * to show it over anything they are doing (DeviceMessageHost).
 *
 * Only the line's owner (the Snow Media account it belongs to) or an admin
 * can see the list; the server decides, and says 'not_signed_in' or
 * 'not_owner', each with its own line here. Ownership rests on the email on
 * file for the line, so on a TV (viaSupport) a line with none gets the
 * messages without the list instead, and Send files them with support.
 *
 * The remote: Up / Down walk All devices -> each device -> the three messages
 * -> Write your own -> Send; OK ticks a device, picks a message, opens the
 * keyboard on Write your own, or sends. Embedded (Live TV Settings, the admin
 * screen) Left or Back return to the menu; on its own a Back button sits top-left.
 */
const LineDevicesPanel = memo(({ host, username, onBack, embedded = false, active = true, viaSupport = false }: Props) => {
  const { t } = useTranslation();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [choice, setChoice] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendOutcome | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // Whether we asked for the keyboard and think it is up (Back, Up / Down and Enter clear it).
  const typingRef = useRef(false);
  const openedAtRef = useRef(0);
  const dismissedAtRef = useRef(0);
  const loadSeq = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const reload = useCallback(async () => {
    const seq = ++loadSeq.current;
    movedRef.current = false;
    setLoad({ state: 'loading' });
    const res = await listLineDevices(host, username);
    if (!alive.current || seq !== loadSeq.current) return;
    if (!res.ok && viaSupport && REFUSED.has(res.reason ?? '')) {
      // No email on file: nobody can be told apart as the owner, so support sends it.
      const owner = await lineOwnerStatus(host, username);
      if (!alive.current || seq !== loadSeq.current) return;
      if (owner.ok && owner.email_on_file === false) { setLoad({ state: 'support' }); return; }
      // Couldn't tell (no network, this TV not registered on the line yet):
      // Try again, not "sign in", which a line with no email can never do.
      if (!owner.ok) { setLoad({ state: 'error', reason: 'failed' }); return; }
    }
    setLoad(res.ok ? { state: 'ready', devices: res.devices ?? [] } : { state: 'error', reason: res.reason ?? 'failed' });
  }, [host, username, viaSupport]);

  // A different line is a fresh start.
  useEffect(() => {
    setAll(false); setPicked(new Set()); setChoice(null); setCustom(''); setResult(null);
    void reload();
  }, [reload]);

  const devices = load.state === 'ready' ? load.devices : [];
  /** The rows the remote lands on, top to bottom. */
  const rows = useMemo<string[]>(() => {
    const out: string[] = embedded ? [] : ['back'];
    if (load.state === 'ready' && load.devices.length > 0) {
      out.push('all', ...load.devices.map((d) => `dev:${d.ref}`), ...QUICK.map((_, i) => `quick:${i}`), 'custom', 'send');
    } else if (load.state === 'support') {
      out.push(...QUICK.map((_, i) => `quick:${i}`), 'custom', 'send');
    } else if ((load.state === 'ready') || (load.state === 'error' && !REFUSED.has(load.reason))) {
      out.push('retry');
    }
    return out;
  }, [load, embedded]);

  // The highlight starts on (and falls back to) the first row under Back —
  // also once the list arrives, unless the viewer went to Back on purpose.
  const movedRef = useRef(false);
  useEffect(() => {
    if (focusId && rows.includes(focusId) && (focusId !== 'back' || movedRef.current)) return;
    const next = rows.find((r) => r !== 'back') ?? rows[0] ?? null;
    if (next !== focusId) setFocusId(next);
  }, [rows, focusId]);

  const support = load.state === 'support';
  const stateRef = useRef({ rows, focusId, all, picked, choice, custom, devices, sending, support });
  stateRef.current = { rows, focusId, all, picked, choice, custom, devices, sending, support };

  const putAway = useCallback(() => {
    typingRef.current = false;
    dismissedAtRef.current = Date.now();
    void hideKeyboardForDpad(inputRef.current);
  }, []);

  // The platform can close the keyboard by itself (its own Back key).
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { Keyboard } = await import('@capacitor/keyboard');
        const handle = await Keyboard.addListener('keyboardDidHide', () => { typingRef.current = false; });
        if (cancelled) { void handle.remove(); return; }
        stop = () => { void handle.remove(); };
      } catch { /* no keyboard plugin here (web, tests) */ }
    })();
    // Leaving with the keyboard up: put it away (the field is gone with the page).
    return () => { cancelled = true; stop?.(); if (typingRef.current) void hideKeyboardForDpad(null); };
  }, []);

  const toggleAll = useCallback(() => {
    setResult(null);
    setAll((v) => !v);
    setPicked(new Set());
  }, []);

  const toggleDevice = useCallback((ref: string) => {
    setResult(null);
    const { all: isAll, picked: cur, devices: list } = stateRef.current;
    // Unticking one while All is ticked leaves every other one ticked.
    const next = isAll ? new Set(list.map((d) => d.ref)) : new Set(cur);
    if (next.has(ref)) next.delete(ref); else next.add(ref);
    if (list.length > 0 && next.size === list.length) { setAll(true); setPicked(new Set()); return; }
    setAll(false);
    setPicked(next);
  }, []);

  const send = useCallback(async () => {
    const s = stateRef.current;
    if (s.sending) return;
    if (!s.support && !s.all && s.picked.size === 0) { setResult({ ok: false, reason: 'no_devices' }); return; }
    const body = s.choice === CUSTOM ? s.custom.trim() : s.choice !== null ? t(QUICK[s.choice]) : '';
    if (!body) { setResult({ ok: false, reason: 'no_message' }); return; }
    setSending(true);
    setResult(null);
    const res = s.support
      ? await askSupportToSend(host, username, body)
      : await sendLineMessage(host, username, s.all ? 'all' : [...s.picked], body);
    if (!alive.current) return;
    setSending(false);
    setResult(res);
    // Each one is a ticket: a second OK on Send must not file it again.
    if (res.ok && s.support) { setChoice(null); setCustom(''); }
  }, [host, username, t]);

  const startTyping = useCallback(() => {
    setChoice(CUSTOM);
    setResult(null);
    typingRef.current = true;
    openedAtRef.current = Date.now();
    void focusTextInputForDpad(inputRef.current);
  }, []);

  const activate = useCallback((id: string) => {
    if (id === 'back') { onBack(); return; }
    if (id === 'all') { toggleAll(); return; }
    if (id === 'retry') { void reload(); return; }
    if (id === 'send') { void send(); return; }
    if (id === 'custom') { startTyping(); return; }
    if (id.startsWith('quick:')) { setResult(null); setChoice(Number(id.slice(6))); return; }
    if (id.startsWith('dev:')) toggleDevice(id.slice(4));
  }, [onBack, toggleAll, reload, send, startTyping, toggleDevice]);

  const move = useCallback((step: 1 | -1) => {
    const { rows: list, focusId: cur } = stateRef.current;
    if (!list.length) return;
    const i = Math.max(0, list.indexOf(cur ?? ''));
    movedRef.current = true;
    setFocusId(list[Math.max(0, Math.min(list.length - 1, i + step))]);
  }, []);

  useEffect(() => {
    if (embedded && !active) return; // the remote is on the menu
    const onKey = (e: KeyboardEvent) => {
      const now = Date.now();
      const target = e.target as HTMLElement | null;
      const inField = typingRef.current || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (inField) {
        // The keyboard is up (or the box was tapped): letters go to the field; a few keys are ours.
        if (e.key === 'Backspace') { e.stopPropagation(); return; } // deletes a letter
        if (isBackKey(e)) { swallow(e); markBack(); putAway(); return; }
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
          swallow(e);
          if (now - openedAtRef.current < OPEN_ECHO_MS) return;
          putAway();
          setFocusId('send');
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          swallow(e);
          putAway();
          move(e.key === 'ArrowDown' ? 1 : -1);
          return;
        }
        e.stopPropagation();
        return;
      }
      if (isBackKey(e)) { swallow(e); markBack(); onBack(); return; }
      if (e.key === 'ArrowLeft') {
        swallow(e);
        if (embedded) onBack(); else { movedRef.current = true; setFocusId('back'); }
        return;
      }
      if (e.key === 'ArrowRight') { swallow(e); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { swallow(e); move(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (isOkKey(e)) {
        swallow(e);
        if (e.repeat || now - dismissedAtRef.current < DISMISS_GRACE_MS) return;
        const id = stateRef.current.focusId;
        if (id) activate(id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [embedded, active, onBack, activate, move, putAway]);

  // Keep the highlighted row on screen.
  useEffect(() => {
    const node = listRef.current;
    if (!node || !focusId || focusId === 'back') return;
    const el = Array.from(node.querySelectorAll<HTMLElement>('[data-row]')).find((n) => n.getAttribute('data-row') === focusId);
    if (el) keepInView(node, el, 12);
  }, [focusId]);

  const showFocus = !embedded || active;
  const focused = (id: string) => showFocus && focusId === id;
  const rowCls = (id: string, extra = '') =>
    `tv-ring flex items-center rounded-xl px-4 py-3 border cursor-pointer bg-slate-900/70 border-white/10 ${focused(id) ? 'scale-[1.02] z-10' : ''} ${extra}`;
  const box = (on: boolean) => (
    <span className={`w-6 h-6 mr-3 shrink-0 rounded-md border-2 flex items-center justify-center ${on ? 'bg-brand-gold border-brand-gold' : 'border-white/50'}`}>
      {on && <Check className="w-4 h-4 text-black" />}
    </span>
  );
  const radio = (on: boolean) => (
    <span className={`w-6 h-6 mr-3 shrink-0 rounded-full border-2 flex items-center justify-center ${on ? 'border-brand-gold' : 'border-white/50'}`}>
      {on && <span className="w-3 h-3 rounded-full bg-brand-gold" />}
    </span>
  );
  const rowProps = (id: string) => ({
    'data-row': id,
    'data-focused': focused(id) ? 'true' : 'false',
    onClick: () => { setFocusId(id); activate(id); },
  });

  const resultText = (r: SendOutcome): string => {
    if (r.ok) return support ? t('lineDevices.panel.supportSent') : t('lineDevices.panel.sent', { count: r.sent ?? 0 });
    switch (r.reason) {
      case 'no_devices': return t('lineDevices.panel.pickDevices');
      case 'no_message': return t('lineDevices.panel.pickMessage');
      case 'bad_body': return t('lineDevices.panel.badBody');
      case 'rate_limited': return t('lineDevices.panel.rateLimited');
      case 'not_owner': return t('lineDevices.panel.notOwner');
      case 'not_signed_in':
      case 'email_on_file': return t('lineDevices.panel.notSignedIn');
      default: return t('lineDevices.panel.sendFailed');
    }
  };

  // The messages and Send: under the devices, or on their own when support sends it.
  const compose = (
    <>
      <h3 className="pt-3 pb-1 text-sm uppercase tracking-wide text-white/70 font-nunito">{t('lineDevices.panel.messageHeading')}</h3>
      {QUICK.map((key, i) => {
        const id = `quick:${i}`;
        return (
          <div key={id} {...rowProps(id)} className={rowCls(id)}>
            {radio(choice === i)}
            <span className="flex-1 min-w-0 font-nunito">{t(key)}</span>
          </div>
        );
      })}
      <div {...rowProps('custom')} className={rowCls('custom', 'items-start')}>
        {radio(choice === CUSTOM)}
        <div className="flex-1 min-w-0">
          <div className="flex items-center">
            <PencilLine className="w-4 h-4 mr-2 text-brand-gold shrink-0" />
            <span className="font-nunito font-semibold">{t('lineDevices.panel.writeOwn')}</span>
            <span className="ml-auto pl-3 text-xs font-nunito text-white/60 tabular-nums">{t('lineDevices.panel.counter', { used: custom.length, max: MAX_BODY })}</span>
          </div>
          {/* No autofocus: OK on this row asks for the keyboard. */}
          <input
            ref={inputRef}
            type="text"
            value={custom}
            maxLength={MAX_BODY}
            placeholder={t('lineDevices.panel.placeholder')}
            onChange={(e) => { setCustom(e.target.value.slice(0, MAX_BODY)); setChoice(CUSTOM); setResult(null); }}
            // Opening the keyboard clicks the field: that click is not a press on the row.
            onClick={(e) => e.stopPropagation()}
            onFocus={() => setChoice(CUSTOM)}
            className="mt-2 w-full rounded-lg bg-black/30 border border-white/15 text-white px-3 py-2 font-nunito focus:outline-none"
          />
          {focused('custom') && <p className="mt-1 text-xs font-nunito text-brand-ice/60">{t('lineDevices.panel.writeOwnHint')}</p>}
        </div>
      </div>

      <div {...rowProps('send')} className={rowCls('send', `justify-center ${focused('send') ? 'bg-brand-gold/25 border-brand-gold/60' : ''}`)}>
        {sending ? <Loader2 className="w-5 h-5 mr-2 animate-spin text-brand-gold" /> : <Send className="w-5 h-5 mr-2 text-brand-gold" />}
        <span className="font-quicksand font-bold">{sending ? t('lineDevices.panel.sending') : t(support ? 'lineDevices.panel.supportSendBtn' : 'lineDevices.panel.sendBtn')}</span>
      </div>
      {result && (
        <p role="status" data-send-result={result.ok ? 'ok' : result.reason} className={`pt-1 font-nunito ${result.ok ? 'text-emerald-300' : 'text-amber-300'}`}>
          {resultText(result)}
        </p>
      )}
    </>
  );

  const body = (() => {
    if (load.state === 'loading') {
      return (
        <div className="flex items-center text-brand-ice/80 font-nunito py-4" data-line-devices="loading">
          <Loader2 className="w-5 h-5 animate-spin text-brand-gold mr-2" />{t('lineDevices.panel.loading')}
        </div>
      );
    }
    if (load.state === 'support') return <div className="space-y-2" data-line-devices="support">{compose}</div>;
    if (load.state === 'error' && REFUSED.has(load.reason)) {
      return (
        <p className="rounded-2xl bg-slate-900/70 border border-white/10 p-5 text-brand-ice/85 font-nunito text-lg" data-line-devices={load.reason}>
          {load.reason === 'not_owner' ? t('lineDevices.panel.notOwner') : t('lineDevices.panel.notSignedIn')}
        </p>
      );
    }
    if (load.state === 'error' || load.devices.length === 0) {
      return (
        <div className="space-y-3" data-line-devices={load.state === 'error' ? 'error' : 'empty'}>
          <p className="text-brand-ice/85 font-nunito text-lg">
            {load.state === 'error' ? t('lineDevices.panel.loadFailed') : t('lineDevices.panel.noDevices')}
          </p>
          <div {...rowProps('retry')} className={rowCls('retry')}>
            <RefreshCw className="w-5 h-5 mr-3 text-brand-gold shrink-0" />
            <span className="font-quicksand font-semibold">{t('lineDevices.panel.retryBtn')}</span>
          </div>
        </div>
      );
    }
    const ticked = (ref: string) => all || picked.has(ref);
    return (
      <div className="space-y-2" data-line-devices="ready">
        <div {...rowProps('all')} className={rowCls('all', 'border-dashed')}>
          {box(all)}
          <span className="flex-1 min-w-0 font-quicksand font-semibold truncate">{t('lineDevices.panel.allDevices')}</span>
        </div>
        {load.devices.map((d) => {
          const id = `dev:${d.ref}`;
          const seen = d.last_seen_at ?? d.registered_at;
          return (
            <div key={id} {...rowProps(id)} className={rowCls(id)}>
              {box(ticked(d.ref))}
              <div className="flex-1 min-w-0">
                <div className="font-nunito font-semibold truncate">{d.label || t('lineDevices.panel.unnamed')}</div>
                {d.app_version && <div className="text-xs font-nunito text-white/60 truncate">{t('lineDevices.panel.version', { version: d.app_version })}</div>}
              </div>
              {d.watching_now
                ? <span className="ml-3 shrink-0 text-xs font-nunito px-2 py-1 rounded-lg bg-emerald-500/25 text-emerald-100 border border-emerald-400/40">{t('lineDevices.panel.watchingNow')}</span>
                : seen && <span className="ml-3 shrink-0 text-xs font-nunito text-brand-ice/70">{t('lineDevices.panel.lastOpened', { when: lowerFirst(formatRelative(seen)) })}</span>}
            </div>
          );
        })}

        {compose}
      </div>
    );
  })();

  return (
    <div className={embedded ? 'h-full min-h-0 overflow-hidden flex flex-col text-white' : 'h-screen overflow-hidden flex flex-col text-white bg-black/70'} data-line-devices-panel>
      {!embedded && (
        <div className="flex items-center px-6 py-4 border-b border-white/10 bg-black/30">
          <BackButton onClick={onBack} label={t('common.back')} data-player-header-btn="" focused={focusId === 'back'} />
          <div className="flex items-center ml-3 min-w-0">
            <MonitorSmartphone className="w-7 h-7 text-brand-gold mr-2 shrink-0" />
            <h1 className="text-2xl font-quicksand font-bold text-white truncate">{t('lineDevices.panel.title')}</h1>
            <span className="ml-3 text-white/60 font-nunito truncate">{username}</span>
          </div>
        </div>
      )}
      <div ref={listRef} className={embedded ? 'flex-1 overflow-auto p-1' : 'flex-1 overflow-auto p-6 flex items-start justify-center'}>
        <div className="w-full max-w-2xl">
          <p className="text-brand-ice/80 font-nunito mb-4">{t(support ? 'lineDevices.panel.noEmailIntro' : 'lineDevices.panel.intro')}</p>
          {body}
        </div>
      </div>
    </div>
  );
});

LineDevicesPanel.displayName = 'LineDevicesPanel';
export default LineDevicesPanel;
