// Live TV › Settings › Add service (owner, 2026-10-20: Switch Account and Add
// another service blended into one page). Every service on this box:
//
//   Your services: each DreamStreams / Vibez line saved here, the one in use
//   marked "Watching now"; OK on another switches Live TV to it (it signs in
//   again with its saved details). Then the outside service, when one is
//   saved (lib/outsideSource), with its state: on (its channels are in Live
//   TV beside ours) or hidden, and why. It is never switched to: OK opens its
//   Edit / Remove (OutsideSourceScreen, drawn in this page).
//
//   Add another service: OK asks which kind. A DreamStreams or Vibez line
//   (the sign-in form, onAddAccount) or another provider (OutsideSourceScreen's
//   form), the latter only while the line in use allows one and there is room
//   (MAX_OUTSIDE_SOURCES); otherwise the page says why.
//
// With nothing else signed in (one line, no outside service) the page leads
// with Add another service.
//
// The remote: Up / Down walk the rows top to bottom; Back (or Left) leaves one
// layer at a time: the provider's page → the kind question (or the list, once
// it was saved, or when it was opened from its row) → the list → the Settings
// menu. The outside service's page keeps its own keys (its keyboard handling
// included). Chrome 66: margins and space-y, no flex gap.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Loader2, PlusCircle, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { trackEvent } from '@/lib/analytics';
import { readOutsideHere, type OutsideHere } from '@/lib/outsideActions';
import { MAX_OUTSIDE_SOURCES, OUTSIDE_SOURCES_EVENT } from '@/lib/outsideSource';
import { fingerIsDriving } from '@/lib/phoneMode';
import { capturePlayerSignin } from '@/lib/playerSigninCapture';
import { hostNameOf } from '@/lib/servers';
import {
  authenticateRouted,
  buildPlayerAccount,
  daysUntilExp,
  loadCreds,
  saveCreds,
  savePlayerAccount,
  savedAccountId,
  upsertSavedAccount,
  SAVED_ACCOUNTS_REFRESH_EVENT,
  type SavedAccount,
  type XtreamCreds,
} from '@/lib/xtream';
import { keepInView } from '@/utils/keepInView';
import OutsideSourceScreen from './OutsideSourceScreen';

interface Props {
  /** Back from the list: the remote returns to the Settings menu. */
  onBack: () => void;
  /** A saved line was switched to (or the one in use picked again): Live TV takes it. */
  onPicked: (c: XtreamCreds) => void;
  /** Add another service → DreamStreams or Vibez line: the sign-in form. */
  onAddAccount: () => void;
  /** Whether the remote is on this page (false while it is on the Settings menu). */
  active?: boolean;
}

/** The list, the kind question after Add, or the outside service's own page. */
type Mode = 'list' | 'kind' | 'outside';

/** Read again on these: a renewal or expiry, an outside service saved or removed, a line saved. */
const REFRESH_EVENTS = ['playerAccountRefresh', OUTSIDE_SOURCES_EVENT, SAVED_ACCOUNTS_REFRESH_EVENT];

const isBackKey = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
const isOkKey = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 23;
const swallow = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

const lineRow = (a: SavedAccount) => `line:${a.id}`;

/** The outside service in the list: its channels are in Live TV, or hidden and why. */
type OutsideState = 'on' | 'line' | 'owner';
const OUTSIDE_STATE_KEYS: Record<OutsideState, string> = {
  on: 'liveAccount.services.outsideOn',
  line: 'liveAccount.services.outsideOffLine',
  owner: 'liveAccount.services.outsideOffOwner',
};

const ServicesScreen = memo(({ onBack, onPicked, onAddAccount, active = true }: Props) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  /** null while it is read. */
  const [here, setHere] = useState<OutsideHere | null>(null);
  const [mode, setMode] = useState<Mode>('list');
  const [focusId, setFocusId] = useState('');
  /** The line being switched to (it signs in again first). */
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef(false);
  /** Where the outside service's page was opened from: its row in the list, or the kind question. */
  const outsideFromRef = useRef<'list' | 'kind'>('list');
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    const read = async () => {
      const next = await readOutsideHere();
      if (alive) setHere(next);
    };
    void read();
    for (const ev of REFRESH_EVENTS) window.addEventListener(ev, read);
    return () => {
      alive = false;
      for (const ev of REFRESH_EVENTS) window.removeEventListener(ev, read);
    };
  }, []);

  const currentId = here?.active ? savedAccountId(here.active.host, here.active.username) : null;
  /** The DreamStreams / Vibez lines on this box, in the order they were saved. */
  const lines = useMemo<SavedAccount[]>(() => {
    if (!here) return [];
    const cur = here.active;
    if (!cur || !currentId || here.accounts.some((a) => a.id === currentId)) return here.accounts;
    // The line in use was never saved as an account (an older box): listed all the same.
    const self: SavedAccount = {
      id: currentId, serverLabel: cur.serverLabel || hostNameOf(cur.host), host: cur.host,
      username: cur.username, password: cur.password, output: cur.output, addedAt: 0,
    };
    return [self, ...here.accounts];
  }, [here, currentId]);

  const outside = here?.sources[0] ?? null;
  /** Its channels are in Live TV now: the same rule as lib/outsideSource's outsideLinesFor. */
  const outsideOn = !!outside && !!here?.allowed && !!here?.ownerHere;
  /** Room for another provider, and the line in use allows one. */
  const canAddOutside = !!here && here.allowed && here.sources.length < MAX_OUTSIDE_SOURCES;
  /** Nothing else signed in: the page leads with Add another service. */
  const lead = !!here && lines.length <= 1 && !outside;

  /** The rows the remote lands on, top to bottom. */
  const rows = useMemo<string[]>(() => {
    if (!here || mode === 'outside') return [];
    if (mode === 'kind') return canAddOutside ? ['kind:line', 'kind:outside'] : ['kind:line'];
    const mine = lines.map(lineRow);
    return lead ? ['add', ...mine] : [...mine, ...(outside ? ['outside'] : []), 'add'];
  }, [here, mode, canAddOutside, lines, lead, outside]);

  // First read, or a row that went away (the outside service removed): the highlight goes to the top row.
  useEffect(() => {
    if (!rows.length || rows.includes(focusId)) return;
    setFocusId(rows[0]);
  }, [rows, focusId]);

  // The remote went back to the menu by a tap there: the page is the list again.
  useEffect(() => { if (!active) setMode('list'); }, [active]);

  const stateRef = useRef({ rows, focusId, lines, currentId, mode, canAddOutside, outside });
  stateRef.current = { rows, focusId, lines, currentId, mode, canAddOutside, outside };

  /** Switch Live TV to a saved line: it signs in again with the saved details first. */
  const pick = useCallback(async (acc: SavedAccount) => {
    if (busyRef.current) return;
    // The line already in use: nothing to switch, Settings just closes (a
    // fresh sign-in handed back identical details looked like a dead press).
    if (acc.id === stateRef.current.currentId) {
      const cur = await loadCreds();
      if (cur) { onPicked(cur); return; }
    }
    busyRef.current = true;
    setBusyId(acc.id);
    try {
      const res = await authenticateRouted(acc.username, acc.password);
      if (!res.ok || !res.creds || !res.server) {
        toast({
          title: t('liveAccount.switch.failedTitle'),
          description: res.error || t('liveAccount.switch.failedDesc'),
          variant: 'destructive',
        });
        return;
      }
      await saveCreds(res.creds);
      const built = buildPlayerAccount(res.server, res.creds, res.userInfo);
      await savePlayerAccount(built);
      // Capture EVERY sign-in (anonymous leads too).
      void capturePlayerSignin(built, res.server.label, 'signin');
      try {
        trackEvent('livetv_signin', 'player', {
          server: res.server.label,
          username: built.username,
          is_trial: built.isTrial,
          days_left: daysUntilExp(built),
        });
      } catch { /* ignore */ }
      void upsertSavedAccount({
        id: savedAccountId(res.creds.host, res.creds.username),
        serverLabel: res.server.label,
        host: res.creds.host,
        username: res.creds.username,
        password: res.creds.password,
        output: res.creds.output,
        addedAt: Date.now(),
      });
      toast({ title: t('liveAccount.switch.switchedTitle'), description: t('liveAccount.switch.switchedDesc', { username: res.creds.username }) });
      onPicked(res.creds);
    } catch (err) {
      toast({
        title: t('liveAccount.switch.failedTitle'),
        description: (err as Error).message || t('liveAccount.switch.networkError'),
        variant: 'destructive',
      });
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  }, [onPicked, toast, t]);

  const activate = useCallback((id: string) => {
    const s = stateRef.current;
    if (id === 'add') { setMode('kind'); setFocusId('kind:line'); return; }
    if (id === 'outside') { if (s.outside) { outsideFromRef.current = 'list'; setMode('outside'); } return; }
    if (id === 'kind:line') { onAddAccount(); return; }
    if (id === 'kind:outside') { if (s.canAddOutside) { outsideFromRef.current = 'kind'; setMode('outside'); } return; }
    const acc = s.lines.find((a) => lineRow(a) === id);
    if (acc) void pick(acc);
  }, [onAddAccount, pick]);

  /** Back from the kind question: the list, on Add. */
  const closeKind = useCallback(() => { setMode('list'); setFocusId('add'); }, []);
  /**
   * Back from the outside service's page: to the kind question it was opened
   * from, while nothing was saved; else the list, on that service (on Add
   * when it was removed).
   */
  const closeOutside = useCallback(() => {
    const saved = !!stateRef.current.outside;
    if (outsideFromRef.current === 'kind' && !saved) { setMode('kind'); setFocusId('kind:outside'); return; }
    setMode('list');
    setFocusId(saved ? 'outside' : 'add');
  }, []);

  const move = useCallback((step: 1 | -1) => {
    const { rows: list, focusId: cur } = stateRef.current;
    if (!list.length) return;
    const i = Math.max(0, list.indexOf(cur));
    setFocusId(list[Math.max(0, Math.min(list.length - 1, i + step))]);
  }, []);

  useEffect(() => {
    // The remote is on the Settings menu, or in the outside service's page (it has its own keys).
    if (!active || mode === 'outside') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (isBackKey(e) || e.key === 'ArrowLeft') {
        swallow(e);
        if (stateRef.current.mode === 'kind') closeKind(); else onBack();
        return;
      }
      const ok = isOkKey(e);
      if (!ok && e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowRight') return;
      swallow(e);
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { move(e.key === 'ArrowDown' ? 1 : -1); return; }
      // A held OK repeats: it would answer the kind question it just opened.
      if (ok && !e.repeat) activate(stateRef.current.focusId);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, mode, onBack, activate, move, closeKind]);

  // Keep the highlighted row on screen; the top row shows the heading above it too.
  useEffect(() => {
    const node = listRef.current;
    if (!node || !focusId || fingerIsDriving()) return;
    if (focusId === stateRef.current.rows[0]) { node.scrollTop = 0; return; }
    const el = Array.from(node.querySelectorAll<HTMLElement>('[data-row]')).find((n) => n.getAttribute('data-row') === focusId);
    if (el) keepInView(node, el, 12);
  }, [focusId, mode]);

  if (mode === 'outside') {
    return <OutsideSourceScreen embedded active={active} onBack={closeOutside} />;
  }

  const focused = (id: string) => active && focusId === id;
  const rowCls = (id: string, extra = '') =>
    `tv-ring flex rounded-xl px-4 py-2.5 border cursor-pointer ${focused(id) ? 'scale-[1.02] z-10' : ''} ${extra}`;
  const rowProps = (id: string) => ({
    'data-row': id,
    'data-focused': focused(id) ? 'true' : 'false',
    onClick: () => { setFocusId(id); activate(id); },
  });

  const addRow = (
    <div {...rowProps('add')} className={rowCls('add', 'items-start bg-slate-900/40 border-dashed border-white/25')}>
      <PlusCircle className="w-5 h-5 mr-3 mt-0.5 text-brand-gold shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-quicksand font-semibold">{t('liveAccount.services.addBtn')}</p>
        <p className="text-sm font-nunito text-white/70">{t('liveAccount.services.addHint')}</p>
      </div>
    </div>
  );

  // Hidden because the line in use isn't active, or because the line that added it isn't on this TV.
  const outsideState: OutsideState | null = !outside ? null : outsideOn ? 'on' : here?.ownerHere ? 'line' : 'owner';

  const list = (
    <>
      {lead && <div className="mb-4">{addRow}</div>}
      <h3 className="text-sm font-quicksand font-semibold uppercase tracking-wide text-brand-ice/70 mb-2">{t('liveAccount.services.yours')}</h3>
      <div className="space-y-2">
        {lines.map((a) => {
          const id = lineRow(a);
          const isCurrent = a.id === currentId;
          return (
            <div key={a.id} {...rowProps(id)} className={rowCls(id, 'items-center bg-slate-900/70 border-white/10')}>
              <Badge className="mr-3 shrink-0 bg-brand-gold/25 text-brand-gold border border-brand-gold/40">{a.serverLabel}</Badge>
              <span className="flex-1 min-w-0 font-nunito truncate">{a.username}</span>
              {busyId === a.id && <Loader2 className="w-5 h-5 ml-3 animate-spin text-brand-gold shrink-0" />}
              {isCurrent ? (
                <Badge data-watching-now="" className="ml-3 shrink-0 bg-emerald-600/30 text-emerald-100 border border-emerald-400/40">
                  {t('liveAccount.services.watchingNow')}
                </Badge>
              ) : focused(id) && (
                <span className="ml-3 shrink-0 text-xs font-nunito text-brand-ice/70">{t('liveAccount.services.switchHint')}</span>
              )}
            </div>
          );
        })}
        {outside && outsideState && (
          <div {...rowProps('outside')} data-outside-state={outsideState} className={rowCls('outside', 'items-start bg-slate-900/70 border-white/10')}>
            <Link2 className="w-5 h-5 mr-3 mt-0.5 text-brand-gold shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-nunito font-semibold truncate">
                {outside.name}
                <span className="ml-2 text-xs font-nunito font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-white/10 text-brand-ice/80">
                  {t('liveAccount.outside.tag')}
                </span>
              </p>
              <p className={`text-sm font-nunito ${outsideOn ? 'text-emerald-300' : 'text-amber-300'}`}>{t(OUTSIDE_STATE_KEYS[outsideState])}</p>
              <p className="text-xs font-nunito text-white/60">{t('liveAccount.services.outsideNote')}</p>
            </div>
          </div>
        )}
      </div>
      {!lead && <div className="mt-4">{addRow}</div>}
    </>
  );

  const kindQuestion = (
    <>
      <h3 className="text-xl font-quicksand font-semibold mb-1">{t('liveAccount.services.addBtn')}</h3>
      <p className="text-brand-ice/85 font-nunito mb-3">{t('liveAccount.services.kindQuestion')}</p>
      <div className="space-y-2">
        <div {...rowProps('kind:line')} className={rowCls('kind:line', 'items-start bg-slate-900/70 border-white/10')}>
          <Users className="w-5 h-5 mr-3 mt-0.5 text-brand-gold shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-quicksand font-semibold">{t('liveAccount.services.kindLine')}</p>
            <p className="text-sm font-nunito text-white/70">{t('liveAccount.services.kindLineHint')}</p>
          </div>
        </div>
        {canAddOutside ? (
          <div {...rowProps('kind:outside')} className={rowCls('kind:outside', 'items-start bg-slate-900/70 border-white/10')}>
            <Link2 className="w-5 h-5 mr-3 mt-0.5 text-brand-gold shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-quicksand font-semibold">{t('liveAccount.outside.title')}</p>
              <p className="text-sm font-nunito text-white/70">{t('liveAccount.services.kindOutsideHint')}</p>
            </div>
          </div>
        ) : (
          // Not a row the remote lands on: why another provider can't be added now.
          <div data-kind-outside-blocked={here?.allowed ? 'full' : 'needsLine'} className="flex items-start rounded-xl px-4 py-2.5 border border-white/10 bg-black/30">
            <Link2 className="w-5 h-5 mr-3 mt-0.5 text-white/40 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-quicksand font-semibold text-white/60">{t('liveAccount.outside.title')}</p>
              <p className="text-sm font-nunito text-amber-300">
                {t(here?.allowed ? 'liveAccount.services.outsideFull' : 'liveAccount.outside.needsLine')}
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col text-white" data-services-screen={mode}>
      <div ref={listRef} className="flex-1 overflow-auto p-1">
        <div className="w-full max-w-2xl">
          {!here ? <Loader2 className="w-5 h-5 animate-spin text-brand-gold" /> : mode === 'kind' ? kindQuestion : list}
        </div>
      </div>
    </div>
  );
});

ServicesScreen.displayName = 'ServicesScreen';
export default ServicesScreen;
