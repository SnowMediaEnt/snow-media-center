// Live TV › Settings › Rewind & recording › Recordings on a computer: the
// shared folder on a computer or NAS on the home network that recordings go
// to (volume id 'net' on the native side). The box records as usual and
// copies each recording over; when the computer is off, the file waits on the
// box and is copied later, so the viewer never loses a recording to a sleeping
// PC.
//
// Find computers asks the native side to look around the network (it takes a
// few seconds); OK on one fills Computer. The fields are typed with the
// on-screen keyboard. Test and save tries the folder (reach, sign in, write)
// and saves it only when that worked; the answer is said in plain words. The
// password never comes back from the native side: with a folder saved, an
// empty Password keeps the saved one.
//
// The remote: Up / Down walk the rows; OK on a field asks for the keyboard,
// whose Enter moves to the next field and, after Password, lands on Test and
// save with the keyboard put away. Back puts the keyboard away first; then
// Back (or Left) returns to Rewind & recording.
// Chrome 66: margins and space-y, no flex gap.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, FolderX, Info, Loader2, Monitor, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/ui/BackButton';
import {
  SnowRecorder, notifyRecordingsChanged, type NetworkFolder, type NetworkFolderArgs, type NetworkFolderReason,
} from '@/capacitor/SnowRecorder';
import { formatBytes } from '@/lib/liveRewind';
import { splitAddress } from '@/lib/recording';
import { focusTextInputForDpad, hideKeyboardForDpad } from '@/utils/dpadKeyboard';
import { keepInView } from '@/utils/keepInView';

interface Props {
  onBack: () => void;
  /** Drawn beside the Settings menu: no header of its own, Back / Left return to Rewind & recording. */
  embedded?: boolean;
  /** Embedded only: whether the remote is on this page (false while it is on the menu). */
  active?: boolean;
}

/** The folder made inside the share when the viewer doesn't change it. A folder name, so never translated. */
export const DEFAULT_FOLDER = 'Snow Media Recordings';

const FIELDS = ['host', 'share', 'folder', 'user', 'pass'] as const;
type Field = (typeof FIELDS)[number];

/** After the keyboard is put away, its parting Enter is not a press (Amazon's keyboard). */
const DISMISS_GRACE_MS = 700;
/** After the keyboard is asked for, an Enter this soon is the echo of that OK, not "next". */
const OPEN_ECHO_MS = 800;

const isBackKey = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
const isOkKey = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 23;
const swallow = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
const markBack = () => { (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now(); };

/** A folder name without the slashes around it. */
const trimSlashes = (s: string) => s.trim().replace(/^[\\/]+|[\\/]+$/g, '');

type Outcome =
  | { kind: 'saved'; name: string; freeBytes?: number }
  | { kind: 'failed'; reason: NetworkFolderReason | 'needHost' | 'needShare' }
  | { kind: 'cleared' };

type Find = { state: 'idle' } | { state: 'searching' } | { state: 'done'; computers: Array<{ host: string; name?: string }> };

const REASON_KEYS: Record<string, string> = {
  unreachable: 'recordings.network.failUnreachable',
  auth: 'recordings.network.failAuth',
  no_share: 'recordings.network.failNoShare',
  no_folder: 'recordings.network.failReadOnly',
  read_only: 'recordings.network.failReadOnly',
  error: 'recordings.network.failError',
  needHost: 'recordings.network.needHost',
  needShare: 'recordings.network.needShare',
};

const NetworkFolderScreen = memo(({ onBack, embedded = false, active = true }: Props) => {
  const { t } = useTranslation();
  /** What the box has saved (null while it is asked). */
  const [saved, setSaved] = useState<NetworkFolder | null>(null);
  const [values, setValues] = useState<Record<Field, string>>({ host: '', share: '', folder: DEFAULT_FOLDER, user: '', pass: '' });
  const [find, setFind] = useState<Find>({ state: 'idle' });
  /** What is being done with the folder right now. */
  const [busy, setBusy] = useState<null | 'save' | 'clear'>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [focusId, setFocusId] = useState<string>('find');

  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  // Whether we asked for the keyboard and think it is up (Back, Up / Down and the last Enter clear it).
  const typingRef = useRef(false);
  const openedAtRef = useRef(0);
  const dismissedAtRef = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // The saved folder fills the fields; its password never comes back, so that field stays empty.
  useEffect(() => {
    SnowRecorder.getNetworkFolder()
      .then((nf) => {
        if (!alive.current) return;
        setSaved(nf);
        if (nf.configured) {
          setValues({ host: nf.host ?? '', share: nf.share ?? '', folder: nf.folder ?? DEFAULT_FOLDER, user: nf.user ?? '', pass: '' });
        }
      })
      .catch(() => { if (alive.current) setSaved({ configured: false }); });
  }, []);

  const configured = !!saved?.configured;
  const savedName = saved?.label || saved?.host || '';
  const computers = useMemo(() => (find.state === 'done' ? find.computers : []), [find]);

  /** The rows the remote lands on, top to bottom. */
  const rows = useMemo<string[]>(() => [
    ...(embedded ? [] : ['back']),
    'find',
    ...computers.map((_, i) => `pc:${i}`),
    ...FIELDS,
    'save',
    ...(configured ? ['clear'] : []),
  ], [embedded, computers, configured]);

  // A row that went away (Stop using this computer, a new search) hands the highlight to Test and save / Find.
  useEffect(() => {
    if (rows.includes(focusId)) return;
    setFocusId(focusId.startsWith('pc:') ? 'find' : 'save');
  }, [rows, focusId]);

  const stateRef = useRef({ rows, focusId, values, busy, confirmClear, configured, saved, computers, find });
  stateRef.current = { rows, focusId, values, busy, confirmClear, configured, saved, computers, find };

  const putAway = useCallback(() => {
    typingRef.current = false;
    dismissedAtRef.current = Date.now();
    const id = stateRef.current.focusId as Field;
    void hideKeyboardForDpad(inputs.current[id] ?? null);
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
        // The platform's own Back closed the keyboard: the field must let go of
        // the focus too, or the next OK is taken as the keyboard's "done" and
        // jumps to the next field instead of opening the keyboard here again.
        // Its parting Enter is ignored for a moment, as after putAway().
        const handle = await Keyboard.addListener('keyboardDidHide', () => {
          typingRef.current = false;
          dismissedAtRef.current = Date.now();
          const el = document.activeElement as HTMLElement | null;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) el.blur();
        });
        if (cancelled) { void handle.remove(); return; }
        stop = () => { void handle.remove(); };
      } catch { /* no keyboard plugin here (web, tests) */ }
    })();
    // Leaving with the keyboard up: put it away (the fields go with the page).
    return () => { cancelled = true; stop?.(); if (typingRef.current) void hideKeyboardForDpad(null); };
  }, []);

  const setValue = useCallback((f: Field, v: string) => {
    setValues((cur) => ({ ...cur, [f]: v }));
    setOutcome(null);
  }, []);

  const findComputers = useCallback(async () => {
    if (stateRef.current.find.state === 'searching') return;
    setFind({ state: 'searching' });
    setOutcome(null);
    const list: Array<{ host: string; name?: string }> = [];
    try {
      const r = await SnowRecorder.findComputers();
      // One row per computer, however many ways it answered.
      const seen = new Set<string>();
      for (const c of r?.computers ?? []) {
        if (!c?.host || seen.has(c.host)) continue;
        seen.add(c.host);
        list.push(c);
      }
    } catch { /* nothing found is what the viewer sees */ }
    if (alive.current) setFind({ state: 'done', computers: list });
  }, []);

  const save = useCallback(async () => {
    const s = stateRef.current;
    if (s.busy) return;
    const addr = splitAddress(s.values.host);
    const share = trimSlashes(s.values.share) || addr.share || '';
    if (addr.host !== s.values.host || share !== s.values.share) {
      setValues((cur) => ({ ...cur, host: addr.host, share }));
    }
    if (!addr.host) { setOutcome({ kind: 'failed', reason: 'needHost' }); setFocusId('host'); return; }
    if (!share) { setOutcome({ kind: 'failed', reason: 'needShare' }); setFocusId('share'); return; }
    // No password typed = keep the saved one (the native side matches host and user).
    const args: NetworkFolderArgs = {
      host: addr.host, share, folder: trimSlashes(s.values.folder), user: s.values.user.trim(),
      ...(s.values.pass ? { password: s.values.pass } : {}),
    };
    setBusy('save');
    setOutcome(null);
    let res: { ok: boolean; reason?: NetworkFolderReason; freeBytes?: number };
    try { res = await SnowRecorder.saveNetworkFolder(args); } catch { res = { ok: false, reason: 'error' }; }
    if (!alive.current) return;
    if (!res.ok) {
      setBusy(null);
      setOutcome({ kind: 'failed', reason: res.reason && REASON_KEYS[res.reason] ? res.reason : 'error' });
      return;
    }
    // Saved: ask again for what the box calls it now, and forget the typed password.
    let nf: NetworkFolder = { configured: true, host: addr.host, share, folder: args.folder, user: args.user };
    try { nf = await SnowRecorder.getNetworkFolder(); } catch { /* keep what was typed */ }
    if (!alive.current) return;
    setBusy(null);
    setSaved(nf);
    setValues((cur) => ({ ...cur, pass: '' }));
    setOutcome({ kind: 'saved', name: nf.label || nf.host || addr.host, freeBytes: res.freeBytes });
    // The Record dialog and Recordings list the computer as a drive now.
    notifyRecordingsChanged();
  }, []);

  const clear = useCallback(async () => {
    const s = stateRef.current;
    if (s.busy) return;
    // Asks once: the first OK says what it will do, the second does it.
    if (!s.confirmClear) { setConfirmClear(true); setOutcome(null); return; }
    setConfirmClear(false);
    setBusy('clear');
    try { await SnowRecorder.clearNetworkFolder(); } catch { /* the folder is forgotten on the next ask either way */ }
    if (!alive.current) return;
    setBusy(null);
    setSaved({ configured: false });
    setValues((cur) => ({ ...cur, pass: '' }));
    setOutcome({ kind: 'cleared' });
    notifyRecordingsChanged();
  }, []);

  const startTyping = useCallback((f: Field) => {
    setOutcome(null);
    setFocusId(f);
    typingRef.current = true;
    openedAtRef.current = Date.now();
    void focusTextInputForDpad(inputs.current[f] ?? null);
  }, []);

  /** The keyboard's Enter: on to the next field with the keyboard up, or after the last one to Test and save. */
  const nextField = useCallback(() => {
    const at = FIELDS.indexOf(stateRef.current.focusId as Field);
    if (at >= 0 && at < FIELDS.length - 1) { startTyping(FIELDS[at + 1]); return; }
    putAway();
    setFocusId('save');
  }, [startTyping, putAway]);

  const activate = useCallback((id: string) => {
    if (id === 'back') { onBack(); return; }
    if (id === 'find') { void findComputers(); return; }
    if (id === 'save') { void save(); return; }
    if (id === 'clear') { void clear(); return; }
    if (id.startsWith('pc:')) {
      const c = stateRef.current.computers[Number(id.slice(3))];
      if (!c) return;
      setValue('host', c.host);
      // The shared folder is what is left to fill.
      setFocusId('share');
      return;
    }
    if ((FIELDS as readonly string[]).includes(id)) startTyping(id as Field);
  }, [onBack, findComputers, save, clear, setValue, startTyping]);

  const move = useCallback((step: 1 | -1) => {
    const { rows: list, focusId: cur } = stateRef.current;
    const i = Math.max(0, list.indexOf(cur));
    const next = list[Math.max(0, Math.min(list.length - 1, i + step))];
    // Leaving Stop using this computer takes back its question.
    if (next !== 'clear') setConfirmClear(false);
    setFocusId(next);
  }, []);

  useEffect(() => {
    if (embedded && !active) return; // the remote is on the menu
    const onKey = (e: KeyboardEvent) => {
      const now = Date.now();
      const target = e.target as HTMLElement | null;
      const inField = typingRef.current || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (inField) {
        // The keyboard is up (or the field was tapped): letters go to the field; a few keys are ours.
        if (e.key === 'Backspace') { e.stopPropagation(); return; } // deletes a letter
        if (isBackKey(e)) { swallow(e); markBack(); putAway(); return; }
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
          swallow(e);
          if (now - openedAtRef.current < OPEN_ECHO_MS) return;
          nextField();
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
        if (embedded) onBack(); else setFocusId('back');
        return;
      }
      if (e.key === 'ArrowRight') { swallow(e); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { swallow(e); move(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (isOkKey(e)) {
        swallow(e);
        if (e.repeat || now - dismissedAtRef.current < DISMISS_GRACE_MS) return;
        activate(stateRef.current.focusId);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [embedded, active, onBack, activate, move, putAway, nextField]);

  // Keep the highlighted row on screen; on the last row show the how-to under it too.
  useEffect(() => {
    const node = listRef.current;
    if (!node || focusId === 'back') return;
    const { rows: list } = stateRef.current;
    if (focusId === list[list.length - 1]) { node.scrollTop = node.scrollHeight; return; }
    const el = Array.from(node.querySelectorAll<HTMLElement>('[data-row]')).find((n) => n.getAttribute('data-row') === focusId);
    if (el) keepInView(node, el, 12);
  }, [focusId]);

  const showFocus = !embedded || active;
  const focused = (id: string) => showFocus && focusId === id;
  const rowCls = (id: string, extra = '') =>
    `tv-ring flex items-center rounded-xl px-4 py-2.5 border cursor-pointer bg-slate-900/70 border-white/10 ${focused(id) ? 'scale-[1.02] z-10' : ''} ${extra}`;
  const rowProps = (id: string) => ({
    'data-row': id,
    'data-focused': focused(id) ? 'true' : 'false',
    onClick: () => { setFocusId(id); activate(id); },
  });

  const LABELS: Record<Field, string> = {
    host: t('recordings.network.computer'),
    share: t('recordings.network.share'),
    folder: t('recordings.network.folder'),
    user: t('recordings.network.user'),
    pass: t('recordings.network.password'),
  };
  const PLACEHOLDERS: Partial<Record<Field, string>> = {
    host: t('recordings.network.computerPlaceholder'),
    share: t('recordings.network.sharePlaceholder'),
    user: t('recordings.network.userPlaceholder'),
    ...(configured ? { pass: t('recordings.network.keepPassword') } : {}),
  };

  const outcomeText = (o: Outcome): string => {
    if (o.kind === 'cleared') return t('recordings.network.cleared');
    if (o.kind === 'saved') {
      return o.freeBytes != null && o.freeBytes > 0
        ? t('recordings.network.saved', { free: formatBytes(o.freeBytes), name: o.name })
        : t('recordings.network.savedNoFree', { name: o.name });
    }
    return t(REASON_KEYS[o.reason] ?? REASON_KEYS.error);
  };
  const outcomeId = (o: Outcome) => (o.kind === 'failed' ? o.reason : o.kind === 'saved' ? 'ok' : 'cleared');

  const path = configured
    ? `\\\\${saved?.host ?? ''}\\${saved?.share ?? ''}${saved?.folder ? `\\${saved.folder}` : ''}`
    : '';

  return (
    <div className={embedded ? 'h-full min-h-0 overflow-hidden flex flex-col text-white' : 'h-screen overflow-hidden flex flex-col text-white bg-black/70'} data-network-folder>
      {!embedded && (
        <div className="flex items-center px-6 py-4 border-b border-white/10 bg-black/30">
          <BackButton onClick={onBack} label={t('common.back')} data-player-header-btn="" focused={focusId === 'back'} />
          <Monitor className="w-7 h-7 ml-3 mr-2 text-brand-gold" />
          <h1 className="text-2xl font-quicksand font-bold">{t('recordings.network.title')}</h1>
        </div>
      )}
      <div ref={listRef} className={embedded ? 'flex-1 overflow-auto p-1' : 'flex-1 overflow-auto p-6 flex items-start justify-center'}>
        <div className="w-full max-w-2xl">
          {embedded && <h3 className="text-xl font-quicksand font-semibold mb-1">{t('recordings.network.title')}</h3>}
          <p className="text-brand-ice/85 font-nunito">{t('recordings.network.intro')}</p>
          <p className="text-sm text-white/60 font-nunito mb-3">{t('recordings.network.introLater')}</p>

          {configured && (
            <div data-network-saved className="rounded-xl px-4 py-2 mb-3 bg-brand-gold/10 border border-brand-gold/40 flex items-center">
              <Check className="w-5 h-5 mr-3 text-brand-gold shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-nunito font-semibold truncate">{t('recordings.network.savedTo', { name: savedName })}</p>
                <p className="text-xs font-mono text-white/60 truncate">{path}</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div {...rowProps('find')} className={rowCls('find', 'items-start')}>
              {find.state === 'searching'
                ? <Loader2 className="w-5 h-5 mr-3 mt-0.5 animate-spin text-brand-gold shrink-0" />
                : <Search className="w-5 h-5 mr-3 mt-0.5 text-brand-gold shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="font-quicksand font-semibold">{t('recordings.network.find')}</p>
                <p data-network-find={find.state === 'done' && computers.length === 0 ? 'none' : find.state} className="text-sm font-nunito text-white/70">
                  {find.state === 'searching'
                    ? t('recordings.network.finding')
                    : find.state === 'done' && computers.length === 0
                      ? t('recordings.network.foundNone')
                      : t('recordings.network.findDesc')}
                </p>
              </div>
            </div>
            {computers.map((c, i) => (
              <div key={c.host} {...rowProps(`pc:${i}`)} className={rowCls(`pc:${i}`, `ml-6 ${values.host === c.host ? 'border-brand-gold/50' : ''}`)}>
                <Monitor className="w-5 h-5 mr-3 text-brand-ice shrink-0" />
                <span className="flex-1 min-w-0 font-nunito font-semibold truncate">{c.name || c.host}</span>
                {c.name && c.name !== c.host && <span className="ml-3 shrink-0 text-sm font-nunito text-white/60">{c.host}</span>}
              </div>
            ))}

            {FIELDS.map((f) => {
              const isPass = f === 'pass';
              return (
                <div key={f} {...rowProps(f)} className={rowCls(f)}>
                  <span className="w-44 lg:w-56 mr-3 shrink-0 font-nunito text-sm text-brand-ice/85">{LABELS[f]}</span>
                  <div className="flex-1 min-w-0">
                    {/* No autofocus: OK on the row asks for the keyboard. */}
                    <input
                      ref={(el) => { inputs.current[f] = el; }}
                      type={isPass ? 'password' : 'text'}
                      value={values[f]}
                      placeholder={PLACEHOLDERS[f]}
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      onChange={(e) => setValue(f, e.target.value)}
                      // Opening the keyboard clicks the field: that click is not a press on the row.
                      onClick={(e) => e.stopPropagation()}
                      onFocus={() => setFocusId(f)}
                      className="w-full rounded-lg bg-black/30 border border-white/15 text-white px-3 py-1.5 font-nunito focus:outline-none"
                    />
                    {isPass && configured && focused(f) && (
                      <p className="mt-1 text-xs font-nunito text-brand-ice/60">{t('recordings.network.keepPassword')}</p>
                    )}
                  </div>
                </div>
              );
            })}

            <div {...rowProps('save')} className={rowCls('save', `justify-center ${focused('save') ? 'bg-brand-gold/25 border-brand-gold/60' : ''}`)}>
              {busy === 'save' ? <Loader2 className="w-5 h-5 mr-2 animate-spin text-brand-gold" /> : <Check className="w-5 h-5 mr-2 text-brand-gold" />}
              <span className="font-quicksand font-bold">{busy === 'save' ? t('recordings.network.testing') : t('recordings.network.saveBtn')}</span>
            </div>
            {outcome && (
              <p role="status" data-network-result={outcomeId(outcome)} className={`px-1 font-nunito ${outcome.kind === 'failed' ? 'text-amber-300' : 'text-emerald-300'}`}>
                {outcomeText(outcome)}
              </p>
            )}

            {configured && (
              <div {...rowProps('clear')} className={rowCls('clear', 'items-start')}>
                <FolderX className="w-5 h-5 mr-3 mt-0.5 text-red-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-quicksand font-semibold">{t('recordings.network.clearBtn')}</p>
                  {confirmClear && (
                    <p data-network-confirm className="text-sm font-nunito text-amber-300">{t('recordings.network.clearConfirm', { name: savedName })}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 rounded-xl px-4 py-3 bg-black/30 border border-white/10" data-network-howto>
            <p className="flex items-center font-quicksand font-semibold mb-1">
              <Info className="w-4 h-4 mr-2 text-brand-gold shrink-0" />{t('recordings.network.howTitle')}
            </p>
            <ul className="space-y-1 text-sm font-nunito text-white/75">
              <li>{t('recordings.network.howWindows')}</li>
              <li>{t('recordings.network.howWindowsLogin')}</li>
              <li>{t('recordings.network.howMac')}</li>
              <li>{t('recordings.network.howMacOptions')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
});

NetworkFolderScreen.displayName = 'NetworkFolderScreen';
export default NetworkFolderScreen;
