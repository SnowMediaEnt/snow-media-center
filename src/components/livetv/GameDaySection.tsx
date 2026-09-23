// Game Day: today's (and tomorrow's) big games — live ones first — with the
// channel each is on in this viewer's line-up, the kickoff time, the live
// score, and two buttons: Watch (plays it in Live TV) and Remind me (a popup
// on the TV at kickoff, see GameReminderHost). A channel other boxes see as
// down gets ⚠️ and a working one is picked over it when there is one.
//
// The games are one shared list (lib/gameDay, the game-day function); the
// channels are this box's sports and network categories, read once and kept
// ten minutes. Nothing here runs while another section is on screen.
//
// Remote: Up/Down move through the games (Up from the first reaches the
// league filters), Left/Right move between Watch and Remind me (Left from
// Watch goes back to the side menu), OK presses, Back goes to the side menu.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bell, BellRing, Loader2, Play, Trophy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { handLiveDeeplink } from '@/lib/appActions';
import { isChannelDown, useDownChannels } from '@/lib/channelStatus';
import { channelsForGame, fetchGames, kickoffLabel, loadSportsChannels, type Game, type GameChannel } from '@/lib/gameDay';
import { GAME_REMINDERS_EVENT, hasReminder, toggleReminder } from '@/lib/gameReminders';
import { buildLines } from '@/lib/liveLines';
import { loadSavedAccounts, type XtreamCreds, type XtreamLiveStream } from '@/lib/xtream';

interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp?: () => void;
  /** Show Live TV (a channel to play has been handed over). */
  onWatch: () => void;
}

const REFRESH_MS = 3 * 60_000;
const lowMemory = () => { try { return document.documentElement.classList.contains('native-low-memory'); } catch { return false; } };

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
  const [channels, setChannels] = useState<Array<{ line: XtreamCreds; stream: XtreamLiveStream }> | null>(null);
  const [league, setLeague] = useState('all');
  const [zone, setZone] = useState<'chips' | 'rows'>('rows');
  const [chipIdx, setChipIdx] = useState(0);
  const [rowIdx, setRowIdx] = useState(0);
  const [action, setAction] = useState<0 | 1>(0);
  const [, setReminderTick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

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

  const leagues = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of games ?? []) if (!seen.has(g.league)) seen.set(g.league, g.leagueLabel);
    return [{ id: 'all', label: 'All' }, ...[...seen].map(([id, label]) => ({ id, label }))];
  }, [games]);

  const rows = useMemo(() => {
    const list = (games ?? []).filter((g) => league === 'all' || g.league === league).slice(0, lowMemory() ? 40 : 80);
    return list.map((g) => {
      const found: GameChannel[] = channels ? channelsForGame(g, channels) : [];
      const isDown = (c: GameChannel) => isChannelDown(down, c.line.host, c.stream.stream_id);
      const pick = found.find((c) => !isDown(c)) ?? found[0] ?? null;
      return { game: g, channel: pick, channelDown: !!pick && isDown(pick), more: Math.max(0, found.length - 1) };
    });
  }, [games, league, channels, down]);

  useEffect(() => { if (rowIdx >= rows.length) setRowIdx(Math.max(0, rows.length - 1)); }, [rows.length, rowIdx]);

  const watch = useCallback((i: number) => {
    const r = rows[i];
    if (!r) return;
    if (r.channel) {
      handLiveDeeplink({
        host: r.channel.line.host, username: r.channel.line.username, streamId: r.channel.stream.stream_id,
        name: r.channel.stream.name, icon: r.channel.stream.stream_icon || undefined,
        categoryId: r.channel.stream.category_id != null ? String(r.channel.stream.category_id) : undefined, num: r.channel.stream.num ?? undefined,
      });
      onWatch();
      return;
    }
    // Nothing matched: look for the network by name in Live TV.
    const net = r.game.networks[0];
    if (net) {
      try { sessionStorage.setItem('smc-live-play', JSON.stringify(net)); } catch { /* ignore */ }
      try { window.dispatchEvent(new CustomEvent('smc:live-play', { detail: net })); } catch { /* ignore */ }
      onWatch();
    } else {
      toast({ title: 'Not found on your channels', description: 'Try the sports categories in Live TV.' });
    }
  }, [rows, onWatch, toast]);

  const remind = useCallback((i: number) => {
    const r = rows[i];
    if (!r) return;
    const on = toggleReminder({
      id: r.game.id,
      title: r.game.name,
      leagueLabel: r.game.leagueLabel,
      start: r.game.start,
      networks: r.game.networks,
      channel: r.channel ? {
        host: r.channel.line.host, username: r.channel.line.username, streamId: r.channel.stream.stream_id, name: r.channel.stream.name,
        categoryId: r.channel.stream.category_id != null ? String(r.channel.stream.category_id) : undefined,
      } : undefined,
    });
    toast({ title: on ? 'Reminder set' : 'Reminder removed', description: on ? `We'll pop up on the TV when ${r.game.name} starts.` : r.game.name });
  }, [rows, toast]);

  // Keep the focused game on screen.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-gd-row="${rowIdx}"]`);
    try { el?.scrollIntoView({ block: 'nearest' }); } catch { /* old WebView */ }
  }, [rowIdx]);

  const lastBack = useRef(0);
  const stateRef = useRef({ zone, chipIdx, rowIdx, action, rows, leagues });
  stateRef.current = { zone, chipIdx, rowIdx, action, rows, leagues };
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
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
        onExitLeft();
        return;
      }
      const ok = e.key === 'Enter' || e.key === ' ';
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !ok) return;
      e.preventDefault(); e.stopPropagation();
      if (st.zone === 'chips') {
        if (e.key === 'ArrowLeft') { if (st.chipIdx === 0) onExitLeft(); else setChipIdx(st.chipIdx - 1); }
        else if (e.key === 'ArrowRight') setChipIdx(Math.min(st.leagues.length - 1, st.chipIdx + 1));
        else if (e.key === 'ArrowUp') onExitUp?.();
        else if (e.key === 'ArrowDown') { if (st.rows.length) { setZone('rows'); setRowIdx(0); } }
        else if (ok) { setLeague(st.leagues[st.chipIdx]?.id ?? 'all'); setRowIdx(0); }
        return;
      }
      if (e.key === 'ArrowUp') { if (st.rowIdx === 0) setZone('chips'); else setRowIdx(st.rowIdx - 1); }
      else if (e.key === 'ArrowDown') setRowIdx(Math.min(st.rows.length - 1, st.rowIdx + 1));
      else if (e.key === 'ArrowLeft') { if (st.action === 0) onExitLeft(); else setAction(0); }
      else if (e.key === 'ArrowRight') setAction(1);
      else if (ok) { if (st.action === 0) watch(st.rowIdx); else remind(st.rowIdx); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive, onExitLeft, onExitUp, watch, remind]);

  const focusedRow = isActive && zone === 'rows' ? rowIdx : -1;

  return (
    <div className="flex-1 min-w-0 flex flex-col text-white px-4 py-3 overflow-hidden">
      <div className="flex items-center mb-3">
        <Trophy className="w-6 h-6 text-brand-gold mr-2" />
        <h2 className="font-quicksand font-bold text-2xl mr-4">Game Day</h2>
        <div className="flex flex-wrap items-center">
          {leagues.map((l, i) => {
            const focused = isActive && zone === 'chips' && chipIdx === i;
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
          return (
            <div
              key={g.id}
              data-gd-row={i}
              data-focused={focused ? 'true' : 'false'}
              className={`tv-ring flex items-center rounded-xl px-3 py-2 mb-2 ${focused ? 'bg-brand-gold/20' : 'bg-white/5'}`}
            >
              <div className="w-28 shrink-0 mr-3">
                <div className="text-xs font-bold uppercase tracking-wide text-brand-ice/70 truncate">{g.leagueLabel}</div>
                {live
                  ? <div className="text-sm font-bold text-red-400 truncate">● LIVE {g.detail}</div>
                  : <div className="text-sm text-white/80 truncate">{kickoffLabel(g.start)}</div>}
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
                  <span className="text-xs text-white/50">Finding your channel…</span>
                ) : r.channel ? (
                  <div className="flex items-center min-w-0">
                    {r.channelDown && <AlertTriangle className="w-4 h-4 text-amber-400 mr-1 shrink-0" aria-label="Reported down right now" />}
                    <span className={`truncate text-sm ${r.channelDown ? 'text-amber-300' : 'text-white/90'}`}>{r.channel.stream.name}</span>
                    {r.more > 0 && <span className="ml-1 text-xs text-white/50 shrink-0">+{r.more}</span>}
                  </div>
                ) : (
                  <span className="text-xs text-white/50 truncate block">{g.networks.length ? `On ${g.networks.join(', ')}` : 'Not on your channels'}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setRowIdx(i); watch(i); }}
                className={`rounded-lg px-3 py-2 mr-2 text-sm font-semibold flex items-center ${focused && action === 0 ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
              >
                <Play className="w-4 h-4 mr-1" /> Watch
              </button>
              <button
                type="button"
                onClick={() => { setRowIdx(i); remind(i); }}
                aria-pressed={reminded}
                className={`rounded-lg px-3 py-2 text-sm font-semibold flex items-center ${focused && action === 1 ? 'bg-white text-black' : reminded ? 'bg-brand-gold/30 text-brand-gold' : 'bg-white/10 text-white'}`}
              >
                {reminded ? <BellRing className="w-4 h-4 mr-1" /> : <Bell className="w-4 h-4 mr-1" />}
                {reminded ? 'Reminder on' : 'Remind me'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
});
GameDaySection.displayName = 'GameDaySection';

export default GameDaySection;
