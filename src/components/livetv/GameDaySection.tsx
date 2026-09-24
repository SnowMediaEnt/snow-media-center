// Game Day: today's (and tomorrow's) big games — live ones first — with the
// channels each is on in this viewer's line-up, the kickoff time, the live
// score, and two buttons: Watch and Remind me (a popup on the TV at kickoff,
// see GameReminderHost). A channel other boxes see as down gets ⚠️.
//
// Watch opens the game's channels: the event channel, the national and local
// networks, the teams' and the league's channels (lib/gameDay), with the
// league's own channels checked against their guide as the list opens, and
// the league's categories to browse in Live TV. Nothing is ever guessed by
// name: a game on a streaming service only (MLB.tv, ESPN+ …) says so.
//
// Remote: Up/Down move through the games (Up from the first reaches the
// league filters), Left/Right move between Watch and Remind me (Left from
// Watch goes back to the side menu), OK presses, Back goes to the side menu.
// In the channel list: Up/Down, OK plays, Back or Left closes it.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bell, BellRing, FolderOpen, Loader2, Play, Trophy, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handLiveCategory, handLiveDeeplink } from '@/lib/appActions';
import { isChannelDown, useDownChannels } from '@/lib/channelStatus';
import {
  LINK_LABELS, channelsForGame, fetchGames, isStreamingOnly, kickoffLabel, kickoffParts, leagueCategories, loadSportsChannels, scanEventChannels,
  type Game, type GameChannel, type SportsChannel,
} from '@/lib/gameDay';
import { GAME_REMINDERS_EVENT, hasReminder, toggleReminder } from '@/lib/gameReminders';
import { buildLines } from '@/lib/liveLines';
import { loadSavedAccounts, type XtreamCreds } from '@/lib/xtream';

interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp?: () => void;
  /** Show Live TV (a channel or a category has been handed over). */
  onWatch: () => void;
}

/** Set by a kickoff reminder's Watch when it had no channel: open this game's list. */
export const GAMEDAY_OPEN_KEY = 'smc-gameday-open';

const REFRESH_MS = 3 * 60_000;
const lowMemory = () => { try { return document.documentElement.classList.contains('native-low-memory'); } catch { return false; } };
const modalOpen = () => { try { return !!document.querySelector('[aria-modal="true"][data-state="open"]'); } catch { return false; } };
const canRemind = (g: Game) => g.state !== 'in' && Date.parse(g.start) > Date.now();

type PickItem =
  | { kind: 'link'; link: GameChannel; down: boolean }
  | { kind: 'browse'; line: XtreamCreds; categoryId: string; name: string };

interface Picker { gameId: string; focus: number; scanning: boolean; extra: GameChannel[] }

const TeamCell = ({ name, logo, score, live }: { name: string; logo: string | null; score: string | null; live: boolean }) => (
  <div className="flex items-center min-w-0">
    {logo
      ? <img src={logo} alt="" className="w-8 h-8 object-contain mr-2 shrink-0" loading="lazy" decoding="async" />
      : <span className="w-8 h-8 mr-2 shrink-0" />}
    <span className="truncate font-quicksand font-semibold">{name}</span>
    {live && score != null && <span className="ml-2 font-bold tabular-nums text-brand-gold">{score}</span>}
  </div>
);

const GameDaySection = memo(({ creds, isActive, onExitLeft, onExitUp, onWatch }: Props) => {
  const { toast } = useToast();
  const [lines, setLines] = useState<XtreamCreds[]>([creds]);
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState(false);
  const [channels, setChannels] = useState<SportsChannel[] | null>(null);
  const [league, setLeague] = useState('all');
  const [zone, setZone] = useState<'chips' | 'rows'>('rows');
  const [chipIdx, setChipIdx] = useState(0);
  const [rowIdx, setRowIdx] = useState(0);
  const [action, setAction] = useState<0 | 1>(0);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [, setReminderTick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);

  // Every signed-in line, like Live TV.
  useEffect(() => {
    let alive = true;
    void loadSavedAccounts().then((saved) => { if (alive) setLines(buildLines(creds, saved)); }).catch(() => undefined);
    return () => { alive = false; };
  }, [creds]);

  // The games, fresh every few minutes while this is on screen.
  useEffect(() => {
    if (!isActive) return;
    let alive = true;
    const load = (force: boolean) => fetchGames(force)
      .then((g) => { if (alive) { setGames(g); setError(false); } })
      .catch(() => { if (alive) setError(true); });
    void load(false);
    const id = window.setInterval(() => { void load(true); }, REFRESH_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [isActive]);

  // This box's sports and network channels.
  const linesKey = lines.map((l) => `${l.host}|${l.username}`).join(',');
  useEffect(() => {
    let alive = true;
    void loadSportsChannels(lines).then((c) => { if (alive) setChannels(c); }).catch(() => { if (alive) setChannels([]); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the lines themselves
  }, [linesKey]);

  useEffect(() => {
    const on = () => setReminderTick((t) => t + 1);
    window.addEventListener(GAME_REMINDERS_EVENT, on);
    return () => window.removeEventListener(GAME_REMINDERS_EVENT, on);
  }, []);

  const down = useDownChannels(lines, isActive);
  const isDown = useCallback((c: GameChannel) => isChannelDown(down, c.line.host, c.stream.stream_id), [down]);

  const leagues = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of games ?? []) if (!seen.has(g.league)) seen.set(g.league, g.leagueLabel);
    return [{ id: 'all', label: 'All' }, ...[...seen].map(([id, label]) => ({ id, label }))];
  }, [games]);

  const rows = useMemo(() => {
    const list = (games ?? []).filter((g) => league === 'all' || g.league === league).slice(0, lowMemory() ? 40 : 80);
    return list.map((g) => {
      const found = channels ? channelsForGame(g, channels) : [];
      const pick = found.find((c) => !isDown(c)) ?? found[0] ?? null;
      return { game: g, found, channel: pick, channelDown: !!pick && isDown(pick), more: Math.max(0, found.length - 1) };
    });
  }, [games, league, channels, isDown]);

  // A focus that fell off the list (games arrived, a league filter) comes back.
  useEffect(() => {
    if (rowIdx < 0 || (rows.length > 0 && rowIdx >= rows.length)) setRowIdx(Math.max(0, Math.min(rowIdx, rows.length - 1)));
  }, [rows.length, rowIdx]);

  // ── the game's channel list ───────────────────────────────────────────────
  const pickerRow = picker ? rows.find((r) => r.game.id === picker.gameId) ?? null : null;
  const pickItems = useMemo<PickItem[]>(() => {
    if (!picker || !pickerRow) return [];
    const seen = new Set<string>();
    const links: GameChannel[] = [];
    for (const l of [...picker.extra, ...pickerRow.found]) {
      const k = `${l.line.host}|${l.line.username}|${l.stream.stream_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      links.push(l);
    }
    // Best first, a channel reported down after the working ones of its kind.
    links.sort((a, b) => b.score - a.score || Number(isDown(a)) - Number(isDown(b)));
    const items: PickItem[] = links.map((link) => ({ kind: 'link', link, down: isDown(link) }));
    for (const c of channels ? leagueCategories(pickerRow.game, channels, 2) : []) items.push({ kind: 'browse', ...c });
    return items;
  }, [picker, pickerRow, channels, isDown]);

  const openPicker = useCallback((i: number) => {
    const r = rows[i];
    if (!r) return;
    const gameId = r.game.id;
    const first = r.found.findIndex((c) => !isDown(c));
    setPicker({ gameId, focus: Math.max(0, first), scanning: !!channels, extra: [] });
    if (!channels) return;
    // The league's numbered channels ("MLB 05"), by what their guide says is on.
    void scanEventChannels(r.game, channels)
      .then((extra) => setPicker((p) => (p && p.gameId === gameId ? { ...p, extra, scanning: false, focus: extra.length ? 0 : p.focus } : p)))
      .catch(() => setPicker((p) => (p && p.gameId === gameId ? { ...p, scanning: false } : p)));
  }, [rows, channels, isDown]);

  const closePicker = useCallback(() => setPicker(null), []);

  const activate = useCallback((item: PickItem | undefined) => {
    if (!item) return;
    setPicker(null);
    if (item.kind === 'link') {
      const { line, stream } = item.link;
      handLiveDeeplink({
        host: line.host, username: line.username, streamId: stream.stream_id,
        name: stream.name, icon: stream.stream_icon || undefined,
        categoryId: stream.category_id != null ? String(stream.category_id) : undefined, num: stream.num ?? undefined,
      });
    } else {
      handLiveCategory({ host: item.line.host, username: item.line.username, categoryId: item.categoryId });
    }
    onWatch();
  }, [onWatch]);

  // A kickoff reminder with no channel asked for this game's list.
  useEffect(() => {
    if (!isActive || !rows.length || !channels) return;
    let want: string | null = null;
    try { want = sessionStorage.getItem(GAMEDAY_OPEN_KEY); } catch { want = null; }
    if (!want) return;
    try { sessionStorage.removeItem(GAMEDAY_OPEN_KEY); } catch { /* ignore */ }
    const i = rows.findIndex((r) => r.game.id === want);
    if (i < 0) return;
    setZone('rows'); setRowIdx(i); setAction(0);
    openPicker(i);
  }, [isActive, rows, channels, openPicker]);

  const remind = useCallback((i: number) => {
    const r = rows[i];
    if (!r || !canRemind(r.game)) return;
    const on = toggleReminder({
      id: r.game.id,
      title: r.game.name,
      leagueLabel: r.game.leagueLabel,
      start: r.game.start,
      networks: r.game.networks.filter((n) => !isStreamingOnly(n)),
      channel: r.channel ? {
        host: r.channel.line.host, username: r.channel.line.username, streamId: r.channel.stream.stream_id, name: r.channel.stream.name,
        categoryId: r.channel.stream.category_id != null ? String(r.channel.stream.category_id) : undefined,
      } : undefined,
    });
    toast({ title: on ? 'Reminder set' : 'Reminder removed', description: on ? `We'll pop up on the TV when ${r.game.name} starts.` : r.game.name });
  }, [rows, toast]);

  // Keep the focused game (and the focused channel in the list) on screen.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-gd-row="${rowIdx}"]`);
    try { el?.scrollIntoView({ block: 'nearest' }); } catch { /* old WebView */ }
  }, [rowIdx]);
  useEffect(() => {
    if (!picker) return;
    const el = pickRef.current?.querySelector<HTMLElement>(`[data-gd-pick="${picker.focus}"]`);
    try { el?.scrollIntoView({ block: 'nearest' }); } catch { /* old WebView */ }
  }, [picker]);

  const lastBack = useRef(0);
  const stateRef = useRef({ zone, chipIdx, rowIdx, action, rows, leagues, picker, pickItems });
  stateRef.current = { zone, chipIdx, rowIdx, action, rows, leagues, picker, pickItems };
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      // A popup over the Player (kickoff reminder, voice) has the remote.
      if (modalOpen()) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const st = stateRef.current;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
      if (isBack) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        const now = Date.now();
        if (now - lastBack.current < 350) return;
        lastBack.current = now;
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = now;
        if (st.picker) closePicker(); else onExitLeft();
        return;
      }
      const ok = e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !ok) return;
      e.preventDefault(); e.stopPropagation();
      // A held OK repeats: one press is one press.
      if (ok && e.repeat) return;
      if (st.picker) {
        const n = st.pickItems.length;
        if (e.key === 'ArrowUp') setPicker((p) => (p ? { ...p, focus: Math.max(0, p.focus - 1) } : p));
        else if (e.key === 'ArrowDown') setPicker((p) => (p ? { ...p, focus: Math.min(Math.max(0, n - 1), p.focus + 1) } : p));
        else if (e.key === 'ArrowLeft') closePicker();
        else if (ok) { if (n) activate(st.pickItems[Math.min(st.picker.focus, n - 1)]); else closePicker(); }
        return;
      }
      if (st.zone === 'chips') {
        if (e.key === 'ArrowLeft') { if (st.chipIdx === 0) onExitLeft(); else setChipIdx(st.chipIdx - 1); }
        else if (e.key === 'ArrowRight') setChipIdx(Math.min(st.leagues.length - 1, st.chipIdx + 1));
        else if (e.key === 'ArrowUp') onExitUp?.();
        else if (e.key === 'ArrowDown') { if (st.rows.length) { setZone('rows'); setRowIdx(0); } }
        else if (ok) { setLeague(st.leagues[st.chipIdx]?.id ?? 'all'); setRowIdx(0); }
        return;
      }
      if (!st.rows.length) {
        // Nothing listed yet (or no games): Up still reaches the filters.
        if (e.key === 'ArrowUp') setZone('chips');
        else if (e.key === 'ArrowLeft') onExitLeft();
        return;
      }
      const row = st.rows[st.rowIdx];
      if (e.key === 'ArrowUp') { if (st.rowIdx <= 0) setZone('chips'); else { setRowIdx(st.rowIdx - 1); setAction(0); } }
      else if (e.key === 'ArrowDown') { setRowIdx(Math.max(0, Math.min(st.rows.length - 1, st.rowIdx + 1))); setAction(0); }
      else if (e.key === 'ArrowLeft') { if (st.action === 0) onExitLeft(); else setAction(0); }
      else if (e.key === 'ArrowRight') { if (row && canRemind(row.game)) setAction(1); }
      else if (ok) { if (st.action === 0) openPicker(st.rowIdx); else remind(st.rowIdx); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, onExitLeft, onExitUp, openPicker, closePicker, activate, remind]);

  const focusedRow = isActive && zone === 'rows' && !picker ? rowIdx : -1;

  return (
    <div className="relative flex-1 min-w-0 flex flex-col text-white px-4 py-3 overflow-hidden">
      <div className="flex items-center mb-3">
        <Trophy className="w-6 h-6 text-brand-gold mr-2" />
        <h2 className="font-quicksand font-bold text-2xl mr-4">Game Day</h2>
        <div className="flex flex-wrap items-center">
          {leagues.map((l, i) => {
            const focused = isActive && zone === 'chips' && chipIdx === i && !picker;
            const on = league === l.id;
            return (
              <button
                key={l.id}
                type="button"
                data-focused={focused ? 'true' : 'false'}
                onClick={() => { setLeague(l.id); setRowIdx(0); }}
                className={`tv-ring mr-2 mb-1 rounded-full px-3 py-1 text-sm font-semibold ${on ? 'bg-brand-gold text-black' : focused ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </div>

      {games === null && !error && (
        <div className="flex-1 flex items-center justify-center text-white/70"><Loader2 className="w-6 h-6 animate-spin mr-2" /> Getting today's games…</div>
      )}
      {error && games === null && (
        <div className="flex-1 flex items-center justify-center text-white/70">Couldn't load the games. Check the internet connection and try again in a minute.</div>
      )}
      {games && rows.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-white/70">No big games on right now — check back later.</div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto pr-1">
        {rows.map((r, i) => {
          const g = r.game;
          const focused = focusedRow === i;
          const live = g.state === 'in';
          const reminded = hasReminder(g.id);
          const remindable = canRemind(g);
          const tv = g.networks.filter((n) => !isStreamingOnly(n));
          return (
            <div
              key={g.id}
              data-gd-row={i}
              data-focused={focused ? 'true' : 'false'}
              className={`tv-ring flex items-center rounded-xl px-3 py-2 mb-2 ${focused ? 'bg-brand-gold/20' : 'bg-white/5'}`}
            >
              <div className="w-28 shrink-0 mr-3">
                <div className="text-xs font-bold uppercase tracking-wide text-brand-ice/70 truncate">
                  {g.leagueLabel}{!live && kickoffParts(g.start).day ? ` · ${kickoffParts(g.start).day}` : ''}
                </div>
                {live
                  ? <div className="text-sm font-bold text-red-400 truncate">● LIVE {g.detail}</div>
                  : <div className="text-sm text-white/80 truncate">{kickoffParts(g.start).time}</div>}
              </div>
              <div className="flex-1 min-w-0 mr-3">
                {g.away && g.home ? (
                  <>
                    <TeamCell name={g.away.short || g.away.name} logo={g.away.logo} score={g.away.score} live={live} />
                    <TeamCell name={`@ ${g.home.short || g.home.name}`} logo={g.home.logo} score={g.home.score} live={live} />
                  </>
                ) : (
                  <div className="font-quicksand font-semibold truncate">{g.name}</div>
                )}
              </div>
              <div className="w-56 shrink-0 mr-3 min-w-0">
                {channels === null ? (
                  <span className="text-xs text-white/50">Finding your channels…</span>
                ) : r.channel ? (
                  <div className="flex items-center min-w-0">
                    {r.channelDown && <AlertTriangle className="w-4 h-4 text-amber-400 mr-1 shrink-0" aria-label="Reported down right now" />}
                    <span className={`truncate text-sm ${r.channelDown ? 'text-amber-300' : 'text-white/90'}`}>{r.channel.stream.name}</span>
                    {r.more > 0 && <span className="ml-1 text-xs text-white/50 shrink-0">+{r.more}</span>}
                  </div>
                ) : (
                  <span className="text-xs text-white/50 truncate block">
                    {tv.length ? `${tv.join(', ')} — not in your channels` : g.networks.length ? `${g.networks.join(', ')} (streaming only)` : 'Not in your channels'}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setRowIdx(i); setAction(0); openPicker(i); }}
                className={`rounded-lg px-3 py-2 mr-2 text-sm font-semibold flex items-center ${focused && action === 0 ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
              >
                <Play className="w-4 h-4 mr-1" /> Watch
              </button>
              {remindable ? (
                <button
                  type="button"
                  onClick={() => { setRowIdx(i); remind(i); }}
                  aria-pressed={reminded}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold flex items-center ${focused && action === 1 ? 'bg-white text-black' : reminded ? 'bg-brand-gold/30 text-brand-gold' : 'bg-white/10 text-white'}`}
                >
                  {reminded ? <BellRing className="w-4 h-4 mr-1" /> : <Bell className="w-4 h-4 mr-1" />}
                  {reminded ? 'Reminder on' : 'Remind me'}
                </button>
              ) : (
                <span className="w-[7.5rem] shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      {picker && pickerRow && (
        <div className="absolute z-20 bg-slate-950/95 flex flex-col px-6 py-4" style={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <div className="flex items-center mb-1">
            <Trophy className="w-6 h-6 text-brand-gold mr-2 shrink-0" />
            <h3 className="font-quicksand font-bold text-2xl truncate">{pickerRow.game.name}</h3>
            <button type="button" onClick={closePicker} aria-label="Close" className="ml-auto rounded-lg bg-white/10 p-2 shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <p className="text-sm text-white/60 mb-3">
            {pickerRow.game.leagueLabel} · {pickerRow.game.state === 'in' ? `LIVE ${pickerRow.game.detail}` : kickoffLabel(pickerRow.game.start)}
            {pickerRow.game.networks.length > 0 && ` · TV: ${pickerRow.game.networks.join(', ')}`}
          </p>
          <div ref={pickRef} className="flex-1 overflow-y-auto pr-1">
            {pickItems.map((item, i) => {
              const focused = picker.focus === i;
              const base = `tv-ring flex items-center rounded-xl px-4 py-3 mb-2 w-full text-left ${focused ? 'bg-white text-black' : 'bg-white/5 text-white'}`;
              if (item.kind === 'browse') {
                return (
                  <button key={`b-${item.line.host}-${item.categoryId}`} type="button" data-gd-pick={i} data-focused={focused ? 'true' : 'false'} className={base} onClick={() => activate(item)}>
                    <FolderOpen className="w-5 h-5 mr-3 shrink-0" />
                    <span className="flex-1 min-w-0 truncate font-semibold">Browse {item.name} in Live TV</span>
                  </button>
                );
              }
              const { link } = item;
              return (
                <button key={`l-${link.line.host}-${link.line.username}-${link.stream.stream_id}`} type="button" data-gd-pick={i} data-focused={focused ? 'true' : 'false'} className={base} onClick={() => activate(item)}>
                  {item.down
                    ? <AlertTriangle className="w-5 h-5 mr-3 shrink-0 text-amber-500" aria-label="Reported down right now" />
                    : <Play className="w-5 h-5 mr-3 shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-semibold">{link.stream.name}</span>
                    {link.note && <span className={`block truncate text-xs ${focused ? 'text-black/60' : 'text-white/50'}`}>{link.note}</span>}
                  </span>
                  <span className={`ml-3 shrink-0 text-xs font-bold uppercase tracking-wide ${focused ? 'text-black/60' : 'text-brand-ice/70'}`}>
                    {LINK_LABELS[link.via]}{lines.length > 1 && link.line.serverLabel ? ` · ${link.line.serverLabel}` : ''}
                  </span>
                </button>
              );
            })}
            {picker.scanning && (
              <div className="flex items-center text-white/60 text-sm px-2 py-2"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Checking the {pickerRow.game.leagueLabel} channels' guide…</div>
            )}
            {!picker.scanning && pickItems.length === 0 && (
              <div className="text-white/70 px-2 py-4">
                Not in your channels right now{pickerRow.game.networks.length ? ` — it's on ${pickerRow.game.networks.join(', ')}` : ''}. Press Back to return to the games.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});
GameDaySection.displayName = 'GameDaySection';

export default GameDaySection;
