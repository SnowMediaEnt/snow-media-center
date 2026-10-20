// Live TV › Settings › Add another service: one service the viewer buys
// elsewhere, whose Live TV channels then show in Live TV under its own name
// (lib/outsideSource). Only with an active DreamStreams or Vibez line; without
// one the page says so and shows no form (a saved service stays, and its
// channels come back when the line is renewed).
//
// Two kinds: an Xtream login (server, username, password) or an M3U link. Test
// signs in / reads the playlist and counts the channels, in plain words when
// it fails; Save keeps exactly what the test tried, and only after it worked.
// A saved service shows with Edit and Remove (Remove asks once). Its password
// never comes back on screen (dots), nor does a saved playlist link (it often
// carries the login): with Edit, leaving them empty keeps the saved ones.
// Nothing here is ever logged.
//
// The remote, as on Recordings on a computer (NetworkFolderScreen): Up / Down
// walk the rows; OK on a field asks for the keyboard, whose Enter moves to the
// next field and, after the last, lands on Test with the keyboard put away.
// OK on the kind row switches Xtream login / M3U link. Back puts the keyboard
// away first; then Back (or Left) leaves. Chrome 66: margins and space-y, no
// flex gap.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Link2, Loader2, Pencil, PlusCircle, Trash2, X, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BackButton } from '@/components/ui/BackButton';
import { trackEvent } from '@/lib/analytics';
import { formatNumber } from '@/i18n/format';
import { hostNameOf } from '@/lib/servers';
import { loadCreds, loadPlayerAccount, loadSavedAccounts, type XtreamCreds } from '@/lib/xtream';
import {
  accountStale,
  lineOwnerKey,
  loadOutsideSources,
  outsideAllowed,
  ownerOnBox,
  parseOutsideInput,
  saveOutsideSource,
  type OutsideInput,
  type OutsideInputError,
  type OutsideKind,
  type OutsideSource,
} from '@/lib/outsideSource';
import { testOutsideSource, type OutsideTestError } from '@/lib/outsideProbe';
import { forgetOutsideSource, recheckLine } from '@/lib/outsideActions';
import { focusTextInputForDpad, hideKeyboardForDpad } from '@/utils/dpadKeyboard';
import { keepInView } from '@/utils/keepInView';

interface Props {
  onBack: () => void;
  /** Drawn beside the Settings menu: no header of its own, Back / Left return to the menu. */
  embedded?: boolean;
  /** Embedded only: whether the remote is on this page (false while it is on the menu). */
  active?: boolean;
}

type Field = 'server' | 'user' | 'pass' | 'url' | 'name';
const FIELDS: Record<OutsideKind, Field[]> = {
  xtream: ['server', 'user', 'pass', 'name'],
  m3u: ['url', 'name'],
};

/** After the keyboard is put away, its parting Enter is not a press (Amazon's keyboard). */
const DISMISS_GRACE_MS = 700;
/** After the keyboard is asked for, an Enter this soon is the echo of that OK, not "next". */
const OPEN_ECHO_MS = 800;

const isBackKey = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
const isOkKey = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 23;
const swallow = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
const markBack = () => { (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now(); };

type Problem = OutsideInputError | OutsideTestError | 'testFirst' | 'full';
type Outcome =
  | { kind: 'works'; channels: number; converted: boolean }
  | { kind: 'problem'; problem: Problem }
  | { kind: 'saved'; name: string }
  | { kind: 'removed' };

const PROBLEM_KEYS: Record<Problem, string> = {
  needServer: 'liveAccount.outside.errors.needServer',
  needLogin: 'liveAccount.outside.errors.needLogin',
  needUrl: 'liveAccount.outside.errors.needUrl',
  badUrl: 'liveAccount.outside.errors.badUrl',
  ours: 'liveAccount.outside.errors.ours',
  nameTaken: 'liveAccount.outside.errors.nameTaken',
  wrongLogin: 'liveAccount.outside.errors.wrongLogin',
  unreachable: 'liveAccount.outside.errors.unreachable',
  notPlaylist: 'liveAccount.outside.errors.notPlaylist',
  empty: 'liveAccount.outside.errors.empty',
  inactive: 'liveAccount.outside.errors.inactive',
  tooBig: 'liveAccount.outside.errors.tooBig',
  testFirst: 'liveAccount.outside.errors.testFirst',
  full: 'liveAccount.outside.errors.full',
};
/** The field a problem with what was typed is about: the highlight goes there. */
const PROBLEM_FIELD: Partial<Record<Problem, Field>> = { needServer: 'server', needLogin: 'user', needUrl: 'url', badUrl: 'server', ours: 'server', nameTaken: 'name' };

const EMPTY: Record<Field, string> = { server: '', user: '', pass: '', url: '', name: '' };

/** What a test was of: the kind and every field. Save keeps a test only while this is unchanged. */
const signature = (kind: OutsideKind, values: Record<Field, string>): string => JSON.stringify([kind, values]);

const OutsideSourceScreen = memo(({ onBack, embedded = false, active = true }: Props) => {
  const { t } = useTranslation();
  /** null while it is read: does the line in use pass the rule (outsideAllowed)? */
  const [gate, setGate] = useState<boolean | null>(null);
  /** The line in use: it becomes the owner of what is saved here. */
  const [activeLine, setActiveLine] = useState<XtreamCreds | null>(null);
  const [saved, setSaved] = useState<OutsideSource | null>(null);
  /** The saved service's line is on this box (the one in use or a saved account). */
  const [ownerHere, setOwnerHere] = useState(false);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<OutsideKind>('xtream');
  const [values, setValues] = useState<Record<Field, string>>(EMPTY);
  const [busy, setBusy] = useState<null | 'test' | 'save' | 'remove'>(null);
  /** What the last successful Test tried (exactly what Save keeps), and of which form. */
  const [tested, setTested] = useState<{ source: OutsideSource; sig: string } | null>(null);
  /** Bumped by every Test and every change to the form: an answer for an older one is dropped. */
  const testSeq = useRef(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [focusId, setFocusId] = useState<string>('kind');

  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const typingRef = useRef(false);
  const openedAtRef = useRef(0);
  const dismissedAtRef = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Who may: the line in use and its account record, and whether the saved
  // service's line is on the box. Read again when the record changes (a
  // renewal, an expiry found by the background check).
  useEffect(() => {
    const read = async () => {
      try {
        const [creds, account, list, accounts] = await Promise.all([loadCreds(), loadPlayerAccount(), loadOutsideSources(), loadSavedAccounts().catch(() => [])]);
        if (!alive.current) return;
        const first = list[0] ?? null;
        setActiveLine(creds);
        setGate(outsideAllowed(creds, account));
        setSaved(first);
        setOwnerHere(!!first && ownerOnBox(first, creds, accounts));
        // Not checked with its panel lately: check it now (the answer reads this again).
        if (accountStale(account)) void recheckLine(creds, { evenWithoutOne: true });
      } catch {
        if (alive.current) setGate(false);
      }
    };
    void read();
    window.addEventListener('playerAccountRefresh', read);
    return () => window.removeEventListener('playerAccountRefresh', read);
  }, []);

  // Allowed: the rule passes, and a saved service's line is on this box (one
  // added on a line since signed out or removed shows the reason, and only Remove).
  const allowed: boolean | null = gate === null ? null : gate && (!saved || ownerHere);
  /** Added on the line in use: its details may come back for Edit (never another line's). */
  const mine = !!saved && !!activeLine && saved.owner === lineOwnerKey(activeLine);
  const showForm = allowed === true && (!saved || editing);
  const fields = FIELDS[kind];

  /** The rows the remote lands on, top to bottom. */
  const rows = useMemo<string[]>(() => {
    const out: string[] = embedded ? [] : ['back'];
    if (allowed !== true) { if (saved) out.push('remove'); return out; }
    if (!showForm) return [...out, 'edit', 'remove'];
    return [...out, 'kind', ...fields, 'test', 'save', ...(saved ? ['cancel'] : [])];
  }, [embedded, allowed, saved, showForm, fields]);

  // A row that went away (the form closed, the kind changed) hands the highlight to the first row.
  useEffect(() => {
    if (rows.includes(focusId)) return;
    setFocusId(rows.find((r) => r !== 'back') ?? rows[0] ?? '');
  }, [rows, focusId]);

  const stateRef = useRef({ rows, focusId, values, busy, kind, saved, editing, tested, confirmRemove, fields, activeLine, mine });
  stateRef.current = { rows, focusId, values, busy, kind, saved, editing, tested, confirmRemove, fields, activeLine, mine };

  const putAway = useCallback(() => {
    typingRef.current = false;
    dismissedAtRef.current = Date.now();
    const id = stateRef.current.focusId as Field;
    void hideKeyboardForDpad(inputs.current[id] ?? null);
  }, []);

  // The platform can close the keyboard by itself (its own Back key): the
  // field lets go of the focus too, or the next OK is taken as the keyboard's
  // "done" (as on Recordings on a computer).
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    void (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { Keyboard } = await import('@capacitor/keyboard');
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
    return () => { cancelled = true; stop?.(); if (typingRef.current) void hideKeyboardForDpad(null); };
  }, []);

  /** Anything typed or switched after a test (or during one): that test no longer stands. */
  const setValue = useCallback((f: Field, v: string) => {
    testSeq.current += 1;
    setValues((cur) => ({ ...cur, [f]: v }));
    setTested(null);
    setOutcome(null);
  }, []);

  const toggleKind = useCallback(() => {
    testSeq.current += 1;
    setKind((k) => (k === 'xtream' ? 'm3u' : 'xtream'));
    setTested(null);
    setOutcome(null);
  }, []);

  const test = useCallback(async () => {
    const s = stateRef.current;
    if (s.busy) return;
    const input: OutsideInput = {
      kind: s.kind,
      server: s.values.server,
      username: s.values.user,
      password: s.values.pass,
      url: s.values.url,
      name: s.values.name,
    };
    // Edit: an empty password keeps the saved one, but only for the same
    // server and username (a saved password never goes to another server);
    // an empty playlist link keeps the saved link. Only the line in use's own
    // (another line's details never fill this form).
    const was = s.editing && s.mine ? s.saved : null;
    if (was?.kind === 'xtream' && s.kind === 'xtream' && !s.values.pass) {
      const sameServer = s.values.server.trim().replace(/\/+$/, '') === (was.host ?? '');
      if (sameServer && s.values.user.trim().toLowerCase() === (was.username ?? '').toLowerCase()) input.password = was.password ?? '';
    }
    if (was?.kind === 'm3u' && s.kind === 'm3u' && !s.values.url.trim()) input.url = was.url ?? '';
    const parsed = parseOutsideInput(input);
    if (parsed.ok === false) {
      setOutcome({ kind: 'problem', problem: parsed.error });
      const f = PROBLEM_FIELD[parsed.error];
      const target = f === 'server' && s.kind === 'm3u' ? 'url' : f;
      if (target && s.fields.includes(target)) setFocusId(target);
      return;
    }
    const seq = ++testSeq.current;
    const sig = signature(s.kind, s.values);
    setBusy('test');
    setOutcome(null);
    setTested(null);
    const res = await testOutsideSource(parsed.source, input);
    if (!alive.current) return;
    setBusy(null);
    // The form changed while the test ran: its answer is about something else.
    if (seq !== testSeq.current) return;
    if (res.ok === false) { setOutcome({ kind: 'problem', problem: res.error }); return; }
    setTested({ source: res.source, sig });
    // An Xtream M3U link pasted as an M3U link: said, since it changes what the viewer gets.
    setOutcome({ kind: 'works', channels: res.channels, converted: s.kind === 'm3u' && res.source.kind === 'xtream' });
    setFocusId('save');
  }, []);

  const save = useCallback(async () => {
    const s = stateRef.current;
    if (s.busy) return;
    // Only a test of what is in the form now.
    if (!s.tested || s.tested.sig !== signature(s.kind, s.values) || !s.activeLine) {
      setOutcome({ kind: 'problem', problem: 'testFirst' });
      setFocusId('test');
      return;
    }
    const src = s.tested.source;
    setBusy('save');
    const ok = await saveOutsideSource(src, s.activeLine, s.saved?.id).catch(() => false);
    if (!alive.current) return;
    setBusy(null);
    if (!ok) { setOutcome({ kind: 'problem', problem: 'full' }); return; }
    try { trackEvent('outside_source_saved', 'player', { kind: src.kind, edit: !!s.saved }); } catch { /* ignore */ }
    setSaved({ ...src, owner: lineOwnerKey(s.activeLine) });
    setOwnerHere(true);
    setEditing(false);
    setTested(null);
    // The secrets go with the form: nothing typed stays in memory on this page.
    setValues(EMPTY);
    setOutcome({ kind: 'saved', name: src.name });
    setFocusId('edit');
  }, []);

  const startEdit = useCallback(() => {
    const { saved: was, mine: own } = stateRef.current;
    if (!was) return;
    testSeq.current += 1;
    // The server and username come back to be changed; the password and a
    // playlist link (it often carries the login) do not: empty keeps them.
    // Added on another line on this box: nothing comes back, the form starts empty.
    setKind(own ? was.kind : 'xtream');
    setValues(own ? { ...EMPTY, server: was.kind === 'xtream' ? was.host ?? '' : '', user: was.username ?? '', name: was.name } : EMPTY);
    setTested(null);
    setOutcome(null);
    setConfirmRemove(false);
    setEditing(true);
    setFocusId('kind');
  }, []);

  const cancelEdit = useCallback(() => {
    testSeq.current += 1;
    setEditing(false);
    setValues(EMPTY);
    setTested(null);
    setOutcome(null);
    setFocusId('edit');
  }, []);

  const remove = useCallback(async () => {
    const s = stateRef.current;
    if (s.busy || !s.saved) return;
    // Asks once: the first OK says what it will do, the second does it.
    if (!s.confirmRemove) { setConfirmRemove(true); setOutcome(null); return; }
    setConfirmRemove(false);
    setBusy('remove');
    testSeq.current += 1;
    const was = s.saved;
    // With it go its favourites, hidden categories, Recently watched channels and playlist copy.
    await forgetOutsideSource(was).catch(() => undefined);
    if (!alive.current) return;
    try { trackEvent('outside_source_removed', 'player', { kind: was.kind }); } catch { /* ignore */ }
    setBusy(null);
    setSaved(null);
    setEditing(false);
    setValues(EMPTY);
    setTested(null);
    setKind('xtream');
    setOutcome({ kind: 'removed' });
    setFocusId('kind');
  }, []);

  const startTyping = useCallback((f: Field) => {
    setOutcome(null);
    setFocusId(f);
    typingRef.current = true;
    openedAtRef.current = Date.now();
    void focusTextInputForDpad(inputs.current[f] ?? null);
  }, []);

  /** The keyboard's Enter: on to the next field with the keyboard up, or after the last one to Test. */
  const nextField = useCallback(() => {
    const list = stateRef.current.fields;
    const at = list.indexOf(stateRef.current.focusId as Field);
    if (at >= 0 && at < list.length - 1) { startTyping(list[at + 1]); return; }
    putAway();
    setFocusId('test');
  }, [startTyping, putAway]);

  const activate = useCallback((id: string) => {
    if (id === 'back') { onBack(); return; }
    if (id === 'kind') { toggleKind(); return; }
    if (id === 'test') { void test(); return; }
    if (id === 'save') { void save(); return; }
    if (id === 'edit') { startEdit(); return; }
    if (id === 'cancel') { cancelEdit(); return; }
    if (id === 'remove') { void remove(); return; }
    if (stateRef.current.fields.includes(id as Field)) startTyping(id as Field);
  }, [onBack, toggleKind, test, save, startEdit, cancelEdit, remove, startTyping]);

  const move = useCallback((step: 1 | -1) => {
    const { rows: list, focusId: cur } = stateRef.current;
    if (!list.length) return;
    const i = Math.max(0, list.indexOf(cur));
    const next = list[Math.max(0, Math.min(list.length - 1, i + step))];
    // Leaving Remove takes back its question.
    if (next !== 'remove') setConfirmRemove(false);
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

  // Keep the highlighted row on screen; on the last row show what is under it too.
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
    server: t('liveAccount.outside.server'),
    user: t('liveAccount.outside.username'),
    pass: t('liveAccount.outside.password'),
    url: t('liveAccount.outside.url'),
    name: t('liveAccount.outside.name'),
  };
  const editingXtream = editing && saved?.kind === 'xtream' && kind === 'xtream';
  const editingM3u = editing && saved?.kind === 'm3u' && kind === 'm3u';
  const PLACEHOLDERS: Partial<Record<Field, string>> = {
    server: t('liveAccount.outside.serverPlaceholder'),
    url: editingM3u ? t('liveAccount.outside.keepLink') : t('liveAccount.outside.urlPlaceholder'),
    name: t('liveAccount.outside.namePlaceholder'),
    ...(editingXtream ? { pass: t('liveAccount.outside.keepPassword') } : {}),
  };

  const outcomeText = (o: Outcome): string => {
    if (o.kind === 'removed') return t('liveAccount.outside.removed');
    if (o.kind === 'saved') return t('liveAccount.outside.saved', { name: o.name });
    if (o.kind === 'works') {
      const found = t('liveAccount.outside.works', { channels: formatNumber(o.channels) });
      return o.converted ? `${found} ${t('liveAccount.outside.converted')}` : found;
    }
    return t(PROBLEM_KEYS[o.problem] ?? PROBLEM_KEYS.unreachable);
  };
  const outcomeId = (o: Outcome) => (o.kind === 'problem' ? o.problem : o.kind);

  /** Save is open only for a test of exactly what the form holds now. */
  const testedNow = !!tested && tested.sig === signature(kind, values);

  /** The saved service, without its secrets: name, kind, where, who, dots for the password (where and who only for the line in use's own). */
  const savedCard = saved && (
    <div data-outside-saved className="rounded-xl px-4 py-2 mb-3 bg-brand-gold/10 border border-brand-gold/40 flex items-start">
      <Link2 className="w-5 h-5 mr-3 mt-0.5 text-brand-gold shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-nunito font-semibold truncate">
          {saved.name}
          <span className="ml-2 text-xs font-nunito font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-white/10 text-brand-ice/80">
            {saved.kind === 'xtream' ? t('liveAccount.outside.xtreamChip') : t('liveAccount.outside.m3uChip')}
          </span>
        </p>
        {!mine ? null : saved.kind === 'xtream' ? (
          <p className="text-sm font-nunito text-white/70 truncate">
            {t('liveAccount.outside.savedXtream', { server: hostNameOf(saved.host), user: saved.username ?? '' })}
            <span className="ml-2 tracking-widest" data-outside-password="">••••••</span>
          </p>
        ) : (
          <p className="text-sm font-nunito text-white/70 truncate">{t('liveAccount.outside.savedM3u', { server: hostNameOf(saved.url) })}</p>
        )}
      </div>
    </div>
  );

  return (
    <div className={embedded ? 'h-full min-h-0 overflow-hidden flex flex-col text-white' : 'h-screen overflow-hidden flex flex-col text-white bg-black/70'} data-outside-screen>
      {!embedded && (
        <div className="flex items-center px-6 py-4 border-b border-white/10 bg-black/30">
          <BackButton onClick={onBack} label={t('common.back')} data-player-header-btn="" focused={focusId === 'back'} />
          <PlusCircle className="w-7 h-7 ml-3 mr-2 text-brand-gold" />
          <h1 className="text-2xl font-quicksand font-bold">{t('liveAccount.outside.title')}</h1>
        </div>
      )}
      <div ref={listRef} className={embedded ? 'flex-1 overflow-auto p-1' : 'flex-1 overflow-auto p-6 flex items-start justify-center'}>
        <div className="w-full max-w-2xl">
          {embedded && <h3 className="text-xl font-quicksand font-semibold mb-1">{t('liveAccount.outside.title')}</h3>}
          <p className="text-brand-ice/85 font-nunito mb-3">{t('liveAccount.outside.intro')}</p>

          {allowed === null && <Loader2 className="w-5 h-5 animate-spin text-brand-gold" />}

          {allowed === false && (
            <>
              {savedCard}
              <div data-outside-not-allowed className="rounded-xl px-4 py-3 mb-3 bg-black/30 border border-white/15">
                <p className="font-nunito font-semibold">{t('liveAccount.outside.needsLine')}</p>
                {saved && <p className="text-sm font-nunito text-white/70">{t(ownerHere ? 'liveAccount.outside.comesBack' : 'liveAccount.outside.ownerGone')}</p>}
              </div>
            </>
          )}

          {allowed === true && !showForm && savedCard}

          <div className="space-y-2">
            {showForm && (
              <>
                <div {...rowProps('kind')} className={rowCls('kind')}>
                  <span className="w-40 lg:w-48 mr-3 shrink-0 font-nunito text-sm text-brand-ice/85">{t('liveAccount.outside.kind')}</span>
                  <div className="flex-1 min-w-0 flex items-center">
                    {(['xtream', 'm3u'] as const).map((k) => (
                      <span
                        key={k}
                        data-kind={k}
                        data-selected={kind === k ? 'true' : 'false'}
                        className={`mr-2 px-3 py-1 rounded-lg font-nunito font-semibold text-sm border ${kind === k ? 'bg-brand-gold/25 border-brand-gold/60 text-white' : 'border-white/15 text-white/60'}`}
                      >
                        {k === 'xtream' ? t('liveAccount.outside.xtreamChip') : t('liveAccount.outside.m3uChip')}
                      </span>
                    ))}
                    {focused('kind') && <span className="ml-1 text-xs font-nunito text-brand-ice/60 truncate">{t('liveAccount.outside.kindHint')}</span>}
                  </div>
                </div>

                {fields.map((f) => {
                  const isPass = f === 'pass';
                  return (
                    <div key={f} {...rowProps(f)} className={rowCls(f)}>
                      <span className="w-40 lg:w-48 mr-3 shrink-0 font-nunito text-sm text-brand-ice/85">{LABELS[f]}</span>
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
                      </div>
                    </div>
                  );
                })}

                <div {...rowProps('test')} className={rowCls('test', `justify-center ${focused('test') ? 'bg-brand-gold/25 border-brand-gold/60' : ''}`)}>
                  {busy === 'test' ? <Loader2 className="w-5 h-5 mr-2 animate-spin text-brand-gold" /> : <Zap className="w-5 h-5 mr-2 text-brand-gold" />}
                  <span className="font-quicksand font-bold">{busy === 'test' ? t('liveAccount.outside.testing') : t('liveAccount.outside.testBtn')}</span>
                </div>
                <div {...rowProps('save')} data-ready={testedNow ? 'true' : 'false'} className={rowCls('save', `justify-center ${testedNow ? '' : 'opacity-60'} ${focused('save') ? 'bg-brand-gold/25 border-brand-gold/60' : ''}`)}>
                  {busy === 'save' ? <Loader2 className="w-5 h-5 mr-2 animate-spin text-brand-gold" /> : <Check className="w-5 h-5 mr-2 text-brand-gold" />}
                  <span className="font-quicksand font-bold">{t('common.save')}</span>
                </div>
                {saved && (
                  <div {...rowProps('cancel')} className={rowCls('cancel', 'justify-center')}>
                    <X className="w-5 h-5 mr-2 text-brand-ice" />
                    <span className="font-quicksand font-semibold">{t('common.cancel')}</span>
                  </div>
                )}
              </>
            )}

            {allowed === true && !showForm && (
              <div {...rowProps('edit')} className={rowCls('edit')}>
                <Pencil className="w-5 h-5 mr-3 text-brand-gold shrink-0" />
                <span className="font-quicksand font-semibold">{t('liveAccount.outside.editBtn')}</span>
              </div>
            )}
            {saved && !showForm && (
              <div {...rowProps('remove')} className={rowCls('remove', 'items-start')}>
                {busy === 'remove'
                  ? <Loader2 className="w-5 h-5 mr-3 mt-0.5 animate-spin text-red-300 shrink-0" />
                  : <Trash2 className="w-5 h-5 mr-3 mt-0.5 text-red-300 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="font-quicksand font-semibold">{t('liveAccount.outside.removeBtn')}</p>
                  {confirmRemove && (
                    <p data-outside-confirm className="text-sm font-nunito text-amber-300">{t('liveAccount.outside.removeConfirm', { name: saved.name })}</p>
                  )}
                </div>
              </div>
            )}

            {outcome && (
              <p role="status" data-outside-result={outcomeId(outcome)} className={`px-1 font-nunito ${outcome.kind === 'problem' ? 'text-amber-300' : 'text-emerald-300'}`}>
                {outcomeText(outcome)}
              </p>
            )}
          </div>

          <p className="mt-4 text-sm font-nunito text-white/60">{t('liveAccount.outside.footer')}</p>
        </div>
      </div>
    </div>
  );
});

OutsideSourceScreen.displayName = 'OutsideSourceScreen';
export default OutsideSourceScreen;
