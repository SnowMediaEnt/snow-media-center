// Game Day: today's (and tomorrow's) big games — live ones first — with the
// channels each is on in this viewer's line-up, the kickoff time, the live
// score, and two buttons: Watch and Remind me (a popup on the TV at kickoff,
// see GameReminderHost). A channel other boxes see as down gets ⚠️.
//
// Watch opens the game's channels: the event channels named for it, the
// national and local networks, the teams' and the league's channels
// (lib/gameDay), with their guide checked as the list opens (and the guide
// of the numbered feeds of its streaming services: "PEACOCK 02"), and the
// league's categories to browse in Live TV. The guide has the last word
// (arrangeLinks): a channel it shows with something else is gone, and a
// network only its name matched is listed at the bottom, under "Not
// confirmed by the guide". The row's Watch pick and a reminder's channel are
// only ever a channel named for the game or one its guide confirmed (once
// the list has been opened); with none, a row that may still find one says
// "press Watch to check your guide", and a game on a streaming service this
// box has no feeds of says "(streaming only)". The channel names are read
// again every ten minutes while this is on screen: providers rename their
// event channels for each day's games.
//
// PPV: the fights, festivals and small races on the box's PPV channels, read
// from their names (no scoreboard lists them), under their own PPV filter;
// the fights show with the day's games too.
//
// Remote: Up/Down move through the games (Up from the first reaches the
// league filters), Left/Right move between Watch and Remind me (Left from
// Watch goes back to the side menu), OK presses, Back goes to the side menu.
// In the channel list: Up/Down, OK plays, Back or Left closes it. A held OK
// on a channel opens Live TV's short menu (ReportChannelDialog) to report it:
// the report names the line and stream of that link, and "channel down" puts
// the ⚠️ on it for the other boxes. A short press plays when OK is let go.
//
// Search (lib/gameDayAi, flag gameday_ai_match): once a day per provider the
// box sends its event-like channel names to be read against the day's games,
// in the background, and reads what was found (on open and after a scan).
// A found channel the box still has under that name is listed under its own
// heading, "Found by search — may not be this game", between the game's
// channels and "Not confirmed by the guide"; the guide still drops one it
// shows with something else, and moves one it confirms up with the game's
// channels. Only a high-confidence one can be the row's Watch pick and a
// reminder's channel. A held OK on one offers "Not this game". Never in demo
// or on a Kids profile.
//
// The owner's picks (lib/gameDay, read with the games) are laid over each
// game's channels last of all: an added channel goes first with a "Picked by
// Snow Media" line, a hidden one is gone (from the row's Watch pick and a
// reminder too), one marked down goes last with the ⚠️. A read that fails
// leaves the lists as the matching made them.
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bell, BellRing, FolderOpen, Loader2, Play, Star, Trophy, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { handLiveCategory, handLiveDeeplink } from '@/lib/appActions';
import { isChannelDown, signalChannel, useDownChannels } from '@/lib/channelStatus';
import {
  CHANNELS_TTL_MS, LINK_LABELS, aiLinks, lineupHash, scanCandidates, teamTokens, PICKED_LABEL, applyChannelEdits, arrangeLinks, cardChannels, channelKey, channelsForGame, checkGuides, chipOf, fetchGameEdits,
  fetchGames, gameServices, isPpvFight, isStreamingOnly, kickoffLabel, kickoffParts, leagueCategories, loadSportsChannels, mergeLinks, ppvGames,
  type Game, type GameChannel, type GameEdit, type LearnedCats, type LinkGroups, type SportsChannel,
} from '@/lib/gameDay';
import {
  AI_FLAG, aiAllowed, fetchCachedScan, hostOf, isWrongLink, learnedCats, markWrong, rememberMiss, sendLearn, sendScan, shouldScan, trackAiPlay, wrongLinks,
  type CachedScan, type ScanResult,
} from '@/lib/gameDayAi';
import { GAME_REMINDERS_EVENT, hasReminder, toggleReminder } from '@/lib/gameReminders';
import { buildLines, lineKey } from '@/lib/liveLines';
import { SERVERS, loadSavedAccounts, serverDisplayName, type XtreamCreds } from '@/lib/xtream';
import { setPausableInterval } from '@/utils/pausableInterval';
import { useTranslation } from 'react-i18next';

const ReportChannelDialog = lazy(() => import('./ReportChannelDialog'));

const loadChannels = loadSportsChannels;
const matchGame = channelsForGame;

/** How it was found, for a link found by search. */
const searchOf = (l: GameChannel): 'high' | 'medium' | undefined => l.search;
/** The groups with the links found by search apart (unless the guide
 *  confirmed them: those are the game's channels). arrangeLinks fills
 *  `search`; a found link left in another group is moved there too. */
const splitSearch = (groups: LinkGroups): LinkGroups => {
  const g = groups;
  const found = (l: GameChannel) => !!searchOf(l) && l.guide !== 'yes';
  const keep = (list: GameChannel[]) => (list.some(found) ? list.filter((l) => !found(l)) : list);
  return {
    main: keep(g.main), unconfirmed: keep(g.unconfirmed), zone: keep(g.zone),
    search: [...(g.search ?? []), ...g.main.filter(found), ...g.unconfirmed.filter(found), ...g.zone.filter(found)],
  };
};
/** A provider's answer is read again this long after a scan the box gave up waiting for. */
const SCAN_SOON_MS = 30_000;
const SCAN_LATE_MS = 90_000;

interface Props {
  creds: XtreamCreds;
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp?: () => void;
  /** Show Live TV (a channel or a category has been handed over), for this
   *  game: Back from there comes back to its list. */
  onWatch: (gameId?: string) => void;
  /** Opens another screen (the buffering guide, from the report menu). */
  onNavigate?: (view: string) => void;
}

/** Set by a kickoff reminder's Watch when it had no channel: open this game's list. */
export const GAMEDAY_OPEN_KEY = 'smc-gameday-open';

const REFRESH_MS = 3 * 60_000;
/** OK held this long on a channel opens its menu (the same as Live TV's list). */
const HOLD_MS = 600;
const lowMemory = () => { try { return document.documentElement.classList.contains('native-low-memory'); } catch { return false; } };
const modalOpen = () => { try { return !!document.querySelector('[aria-modal="true"][data-state="open"]'); } catch { return false; } };
const canRemind = (g: Game) => g.state !== 'in' && Date.parse(g.start) > Date.now();

/** Where a link sits in the list: with the game's channels, under "Found by
 *  search", under "Not confirmed by the guide", or under the zone channels'
 *  heading. */
type LinkGroup = 'main' | 'search' | 'unconfirmed' | 'zone';
type PickItem =
  | { kind: 'link'; link: GameChannel; down: boolean; group: LinkGroup }
  | { kind: 'browse'; line: XtreamCreds; categoryId: string; name: string };

/** Best first; the original position settles a tie (an old WebView's sort is not stable). */
const byScore = (list: GameChannel[]): GameChannel[] => (list.length < 2 ? list : list
  .map((l, i) => ({ l, i }))
  .sort((a, b) => b.l.score - a.l.score || a.i - b.i)
  .map((x) => x.l));

/** `moved`: the viewer has moved in the list, so what the guide adds does
 *  not take the focus away. */
interface Picker { gameId: string; focus: number; moved: boolean; scanning: boolean; extra: GameChannel[] }

const pickKey = (it: PickItem): string => (it.kind === 'link'
  ? `l|${it.link.line.host}|${it.link.line.username}|${it.link.stream.stream_id}`
  : `b|${it.line.host}|${it.line.username}|${it.categoryId}`);

/** The service a line belongs to, as the viewer reads it ("DreamStreams",
 *  "Vibez"). The active line may carry no label of its own, so the host
 *  finds it; a line of neither kind shows its host. Only a name: never the
 *  login. */
const serviceName = (line: XtreamCreds): string => {
  const label = line.serverLabel || SERVERS.find((s) => s.host === line.host)?.label;
  return label ? serverDisplayName(label) : line.host.replace(/^https?:\/\//, '');
};

/** Small pill with the service name, shown only when the box has more than one line. */
const ServiceTag = ({ name, label, onLight, howto }: { name: string; label: string; onLight: boolean; howto?: string }) => (
  <span
    aria-label={label}
    data-howto={howto}
    className={`ml-2 shrink-0 max-w-[7rem] truncate rounded-full px-2 py-0.5 text-xs font-bold leading-none ${onLight ? 'bg-brand-navy text-white' : 'bg-brand-ice/20 text-brand-ice'}`}
  >
    {name}
  </span>
);

const TeamCell = ({ name, logo, score, live }: { name: string; logo: string | null; score: string | null; live: boolean }) => (
  <div className="flex items-center min-w-0">
    {logo
      ? <img src={logo} alt="" className="w-8 h-8 object-contain mr-2 shrink-0" loading="lazy" decoding="async" />
      : <span className="w-8 h-8 mr-2 shrink-0" />}
    <span className="truncate font-quicksand font-semibold">{name}</span>
    {live && score != null && <span className="ml-2 font-bold tabular-nums text-brand-gold">{score}</span>}
  </div>
);

const GameDaySection = memo(({ creds, isActive, onExitLeft, onExitUp, onWatch, onNavigate }: Props) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [lines, setLines] = useState<XtreamCreds[]>([creds]);
  const [games, setGames] = useState<Game[] | null>(null);
  // The owner's picks for the games (none until read, and none if the read fails).
  const [edits, setEdits] = useState<GameEdit[]>([]);
  const [error, setError] = useState(false);
  const [channels, setChannels] = useState<SportsChannel[] | null>(null);
  // What the guide said for each game whose list has been opened (by game
  // id): a network it confirmed can then be the row's Watch pick.
  const [guided, setGuided] = useState<Map<string, GameChannel[]>>(() => new Map());
  const [league, setLeague] = useState('all');
  const [zone, setZone] = useState<'chips' | 'rows'>('rows');
  const [chipIdx, setChipIdx] = useState(0);
  const [rowIdx, setRowIdx] = useState(0);
  const [action, setAction] = useState<0 | 1>(0);
  const [picker, setPicker] = useState<Picker | null>(null);
  // The link a held OK is reporting: its own line and stream, whichever line the box is signed into first.
  const [reportFor, setReportFor] = useState<GameChannel | null>(null);
  const [, setReminderTick] = useState(0);
  const [channelsTick, setChannelsTick] = useState(0);
  // Search: on unless the owner turned it off (a missing flag row is on),
  // once the flag has been read this time (a box never calls past the kill
  // switch on a remembered "on"); never in demo or on a Kids profile.
  const { enabled: aiFlag, loading: aiFlagLoading } = useFeatureFlag(AI_FLAG);
  const [aiOk] = useState(aiAllowed);
  const aiOn = aiFlag && !aiFlagLoading && aiOk;
  // What each provider's last scan found (by host), and scans on their way.
  const [aiScans, setAiScans] = useState<Map<string, CachedScan>>(() => new Map());
  const [aiBusy, setAiBusy] = useState(0);
  // A "Not this game" was said: the found links are worked out again.
  const [wrongTick, setWrongTick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);

  // Every signed-in line, like Live TV.
  useEffect(() => {
    let alive = true;
    void loadSavedAccounts().then((saved) => { if (alive) setLines(buildLines(creds, saved)); }).catch(() => undefined);
    return () => { alive = false; };
  }, [creds]);

  // The games, fresh every few minutes while this is on screen. The owner's
  // picks are read alongside, and never waited for: a slow or failed read
  // leaves the lists as the matching made them.
  useEffect(() => {
    if (!isActive) return;
    let alive = true;
    const load = (force: boolean) => {
      void fetchGameEdits(force).then(
        (e) => { if (alive) setEdits((old) => (old === e || (!old.length && !e.length) ? old : e)); },
        () => undefined,
      );
      return fetchGames(force)
        .then((g) => { if (alive) { setGames(g); setError(false); } })
        .catch(() => { if (alive) setError(true); });
    };
    void load(false);
    const id = window.setInterval(() => { void load(true); }, REFRESH_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [isActive]);

  // This box's sports and network channels, read again every ten minutes
  // while on screen (a list that has not aged comes straight back).
  const linesKey = lines.map((l) => `${l.host}|${l.username}`).join(',');
  // The providers (by hostname: never a login), two at most.
  const aiHosts = useMemo(() => [...new Set(lines.map((l) => hostOf(l.host)).filter(Boolean))].slice(0, 2),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the lines themselves
    [linesKey]);
  // The categories viewers showed carry a league's games on these providers:
  // the matching treats them as that league's. Worked out again when a
  // provider's answer is read; the same list keeps the same map.
  const learnedSig = useMemo(() => {
    if (!aiOn) return '';
    return JSON.stringify([...learnedCats(aiHosts)]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- aiScans: a new answer brings new categories
  }, [aiOn, aiHosts, aiScans]);
  const learned = useMemo<LearnedCats | undefined>(() => {
    if (!learnedSig) return undefined;
    try { const m = new Map(JSON.parse(learnedSig) as Array<[string, string[]]>); return m.size ? m : undefined; } catch { return undefined; }
  }, [learnedSig]);
  // Read with the next channel list (not a reason to read it again now).
  const learnedRef = useRef(learned);
  learnedRef.current = learned;
  useEffect(() => {
    if (!isActive) return;
    return setPausableInterval(() => setChannelsTick((t) => t + 1), CHANNELS_TTL_MS);
  }, [isActive]);
  useEffect(() => {
    let alive = true;
    void loadChannels(lines, learnedRef.current)
      .then((c) => { if (alive) setChannels(c); })
      .catch(() => { if (alive) setChannels((old) => old ?? []); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the lines themselves
  }, [linesKey, channelsTick]);
  // The guide's answers were read from one channel list: a new one (the
  // ten-minute refresh) starts over.
  useEffect(() => { setGuided((m) => (m.size ? new Map() : m)); }, [channels]);
  // The streaming services this box has numbered feeds of ("PEACOCK 02"),
  // worked out once per channel list.
  const boxServices = useMemo(() => {
    const out = new Set<string>();
    for (const c of channels ?? []) if (c.service) out.add(c.service);
    return out;
  }, [channels]);

  useEffect(() => {
    const on = () => setReminderTick((t) => t + 1);
    window.addEventListener(GAME_REMINDERS_EVENT, on);
    return () => window.removeEventListener(GAME_REMINDERS_EVENT, on);
  }, []);

  const down = useDownChannels(lines, isActive);
  // Reported down by the boxes (what the report menu clears)…
  const crowdDown = useCallback((c: GameChannel) => isChannelDown(down, c.line.host, c.stream.stream_id), [down]);
  // …or marked down by the owner for this game: the same to the list.
  const isDown = useCallback((c: GameChannel) => !!c.ownerDown || crowdDown(c), [crowdDown]);

  // Today's PPV events, from the box's PPV channels' own names (a UFC card
  // the scoreboard has is shown once, as its game).
  const ppv = useMemo(() => (channels ? ppvGames(channels, cardChannels(games ?? [], channels)) : []), [games, channels]);
  const ppvLinks = useMemo(() => new Map(ppv.map((p) => [p.game.id, p.links])), [ppv]);
  const allGames = useMemo(() => [...(games ?? []), ...ppv.map((p) => p.game)]
    // Live first, then by start.
    .sort((a, b) => (a.state === 'in' ? 0 : 1) - (b.state === 'in' ? 0 : 1) || (Date.parse(a.start) || 0) - (Date.parse(b.start) || 0)), [games, ppv]);

  const leagues = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of allGames) if (g.league !== 'ppv') { const c = chipOf(g); if (!seen.has(c.id)) seen.set(c.id, c.labelKey ? t(c.labelKey) : c.label); }
    return [{ id: 'all', label: t('gameDay.allChip') }, ...(ppv.length ? [{ id: 'ppv', label: 'PPV' }] : []), ...[...seen].map(([id, label]) => ({ id, label }))];
  }, [allGames, ppv.length, t]);

  // "All": every game, and of PPV the fights; the rest of PPV under PPV.
  const shown = useMemo(() => allGames
    .filter((g) => (league === 'all' ? g.league !== 'ppv' || isPpvFight(g) : chipOf(g).id === league))
    .slice(0, lowMemory() ? 40 : 80), [allGames, league]);
  // What the matching finds for each (the slow part: not done again when the
  // owner's picks or the down list change).
  const matched = useMemo(
    () => shown.map((g) => (g.league === 'ppv' ? (ppvLinks.get(g.id) ?? []) : channels ? matchGame(g, channels, undefined, learned) : [])),
    [shown, channels, ppvLinks, learned],
  );

  // ── search ────────────────────────────────────────────────────────────────
  // Each time Game Day opens: read each provider's answer (kept ten minutes),
  // and send its scan in the background when the answer is missing, old or
  // made from another line-up (shouldScan). Nothing waits for it.
  const aliveRef = useRef(true);
  const lateTimers = useRef<number[]>([]);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; lateTimers.current.forEach((id) => window.clearTimeout(id)); lateTimers.current = []; };
  }, []);
  const aiCheckedRef = useRef('');
  useEffect(() => { if (!isActive) aiCheckedRef.current = ''; }, [isActive]);
  useEffect(() => {
    if (!isActive || !aiOn || !channels || !aiHosts.length) return;
    const key = aiHosts.join(',');
    if (aiCheckedRef.current === key) return;
    aiCheckedRef.current = key;
    const list = channels;
    const put = (host: string, scan: CachedScan | null) => {
      if (scan && aliveRef.current) setAiScans((m) => (m.get(host) === scan ? m : new Map(m).set(host, scan)));
    };
    for (const host of aiHosts) {
      void (async () => {
        const cached = await fetchCachedScan(host);
        put(host, cached);
        const cands = scanCandidates(list, host);
        if (!cands.length) return;
        const hash = lineupHash(cands);
        if (!shouldScan(host, cached, hash)) return;
        setAiBusy((n) => n + 1);
        let r: ScanResult = 'error';
        try { r = await sendScan(host, cands, hash); } finally { if (aliveRef.current) setAiBusy((n) => Math.max(0, n - 1)); }
        if (r !== 'scanned' && r !== 'started' && r !== 'fresh' && r !== 'busy' && r !== 'timeout') return;
        put(host, await fetchCachedScan(host, true));
        // The server finishes the scan after answering, or it was given up on
        // after six seconds, or another box on this provider is scanning it
        // now: read it again a little later (never a second scan).
        if ((r === 'started' || r === 'timeout' || r === 'busy') && aliveRef.current) {
          for (const ms of [SCAN_SOON_MS, SCAN_LATE_MS]) {
            lateTimers.current.push(window.setTimeout(() => { if (aliveRef.current) void fetchCachedScan(host, true).then((s) => put(host, s)); }, ms));
          }
        }
      })().catch(() => undefined);
    }
  }, [isActive, aiOn, channels, aiHosts]);
  // What was found for each game listed, as links on this box: only a channel
  // still loaded under that name (or one still naming a team), and never one
  // a viewer here said is not the game.
  const searchByGame = useMemo(() => {
    const out = new Map<string, GameChannel[]>();
    if (!aiOn || !channels || !aiScans.size) return out;
    const wrong = wrongLinks();
    for (const [host, scan] of aiScans) {
      const ids = new Set<number>();
      for (const id of Object.keys(scan.matches)) for (const m of scan.matches[id]) ids.add(m.stream_id);
      if (!ids.size) continue;
      // One pass over the channels per provider, not one per game.
      const here = channels.filter((c) => ids.has(Number(c.stream.stream_id)) && hostOf(c.line.host) === host);
      if (!here.length) continue;
      for (const g of shown) {
        const m = scan.matches[g.id];
        if (!m || !m.length || !g.home || !g.away) continue;
        const links = aiLinks(g, here, host, m).filter((l) => !isWrongLink(wrong, g.id, host, l.stream.stream_id));
        if (links.length) out.set(g.id, [...(out.get(g.id) ?? []), ...links]);
      }
    }
    return out;
  // wrongTick: a "Not this game" here takes the link off.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOn, channels, aiScans, shown, wrongTick]);
  const rows = useMemo(() => shown.map((g, i) => {
    const auto = matched[i] ?? [];
    const search = searchByGame.get(g.id) ?? [];
    // The names' matches first: a channel they found too is not "found by search".
    const named = search.length ? mergeLinks([auto, search], channels ?? []) : auto;
    // What the guide said (once the game's list has been opened) over the names.
    const checked = guided.get(g.id);
    const groups = splitSearch(arrangeLinks(g, checked ? mergeLinks([checked, named], channels ?? []) : named, false));
    // The row's Watch pick and a reminder's channel: a channel named for the
    // game or confirmed by its guide, never a network only its name matched;
    // with none, a channel found by search with high confidence. The owner's
    // picks go over them, last of all.
    const searchKeys = new Set(groups.search.map(channelKey));
    const laid = applyChannelEdits(g, searchKeys.size ? [...byScore(groups.main), ...byScore(groups.search)] : byScore(groups.main), edits, lines, channels ?? []);
    const found = searchKeys.size ? laid.filter((c) => c.picked || !searchKeys.has(channelKey(c))) : laid;
    const searched = searchKeys.size ? laid.filter((c) => !c.picked && searchKeys.has(channelKey(c))) : [];
    const sure = searched.filter((c) => searchOf(c) === 'high');
    const pick = found.find((c) => !isDown(c)) ?? sure.find((c) => !isDown(c)) ?? found[0] ?? sure[0] ?? null;
    // The owner added a channel to a game nothing else found: a 'pick' signal.
    const picks = groups.main.length || !g.home || !g.away ? [] : found.filter((c) => c.picked);
    // Worked out here, not on every key press: a formatter per row per
    // press is slow on an old box.
    const when = kickoffParts(g.start);
    const tv = g.networks.filter((n) => !isStreamingOnly(n));
    // No pick, but the guide may still find one: a network its name matched,
    // or a feed on this box of one of the game's streaming services.
    const unsure = !pick && (groups.unconfirmed.length > 0 || gameServices(g).some((s) => boxServices.has(s)));
    return {
      game: g, auto, search, found, picks, channel: pick, channelDown: !!pick && isDown(pick), more: Math.max(0, found.length + searched.length - 1), when, tv, unsure,
    };
    // t: the kickoff day and time are drawn in the app's language, so a language change recomputes them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [shown, matched, searchByGame, guided, edits, lines, channels, boxServices, isDown, t]);

  // The owner's adds to games nothing else found: each sent once a day.
  useEffect(() => {
    if (!isActive || !aiOn || !channels) return;
    let cats: Map<string, string> | null = null;
    for (const r of rows) {
      for (const c of r.picks) {
        cats ??= new Map(channels.map((x) => [channelKey(x), x.cat]));
        sendLearn({ host: hostOf(c.line.host), gameId: r.game.id, streamId: c.stream.stream_id, name: c.stream.name, cat: cats.get(channelKey(c)) ?? '', source: 'pick' });
      }
    }
  }, [rows, isActive, aiOn, channels]);

  // A focus that fell off the list (games arrived, a league filter) comes back.
  useEffect(() => {
    if (rowIdx < 0 || (rows.length > 0 && rowIdx >= rows.length)) setRowIdx(Math.max(0, Math.min(rowIdx, rows.length - 1)));
  }, [rows.length, rowIdx]);

  // ── the game's channel list ───────────────────────────────────────────────
  const pickerRow = picker ? rows.find((r) => r.game.id === picker.gameId) ?? null : null;
  const pickItems = useMemo<PickItem[]>(() => {
    if (!picker || !pickerRow) return [];
    // Each channel once, best source first, always with its current name
    // (never one a guide check cached before the last channel-list refresh).
    // The matching's own links and the guide's word on them: the owner's
    // picks come after the arranging.
    const merged = mergeLinks([picker.extra, pickerRow.auto, pickerRow.search], channels ?? []);
    // What the guide leaves, in three groups never mixed together: the
    // game's channels; the networks it could not confirm (once it has been
    // read); and the zone channels (RedZone, "MLB Zone": every game of the
    // league, never just this one).
    const groups = splitSearch(arrangeLinks(pickerRow.game, merged, picker.scanning));
    // In each, best first, a channel reported down after the working ones of
    // its kind. Same quality and both working: the active line first, then
    // the other lines in the order Live TV lists them. The original position
    // settles the rest (an old WebView's sort is not stable).
    const rank = new Map(lines.map((l, i) => [lineKey(l), i]));
    const rankOf = (c: GameChannel) => rank.get(lineKey(c.line)) ?? lines.length;
    const sorted = (list: GameChannel[]) => list.map((l, i) => ({ l, i }))
      .sort((a, b) => b.l.score - a.l.score || Number(isDown(a.l)) - Number(isDown(b.l)) || rankOf(a.l) - rankOf(b.l) || a.i - b.i)
      .map((x) => x.l);
    const main = sorted(groups.main);
    const search = sorted(groups.search);
    const unconfirmed = sorted(groups.unconfirmed);
    const zone = sorted(groups.zone);
    const found = new Set(search.map(channelKey));
    const unsure = new Set(unconfirmed.map(channelKey));
    // The owner's picks, last of all: what they add goes first (even a
    // channel the guide dropped), what they hide is gone (even if the guide
    // brought it back), what they mark down goes last.
    const arranged = applyChannelEdits(pickerRow.game, [...main, ...search, ...unconfirmed, ...zone], edits, lines, channels ?? []);
    const items: PickItem[] = arranged.map((link) => ({
      kind: 'link', link, down: isDown(link),
      // A channel the owner picked is up with the picks, not in its group.
      group: link.picked ? 'main' : found.has(channelKey(link)) ? 'search' : unsure.has(channelKey(link)) ? 'unconfirmed' : link.via === 'zone' ? 'zone' : 'main',
    }));
    const own = pickerRow.game.league === 'ppv' ? new Set(pickerRow.found.map(channelKey)) : undefined;
    for (const c of channels ? leagueCategories(pickerRow.game, channels, 2, own) : []) items.push({ kind: 'browse', ...c });
    return items;
  }, [picker, pickerRow, channels, isDown, lines, edits]);
  const firstLinkIdx = pickItems.findIndex((it) => it.kind === 'link');
  // Where the "Found by search", "Not confirmed by the guide" and the zone
  // groups start (their headings go there).
  const firstSearchIdx = useMemo(() => pickItems.findIndex((it) => it.kind === 'link' && it.group === 'search'), [pickItems]);
  const firstUnconfirmedIdx = useMemo(() => pickItems.findIndex((it) => it.kind === 'link' && it.group === 'unconfirmed'), [pickItems]);
  const firstZoneIdx = useMemo(() => pickItems.findIndex((it) => it.kind === 'link' && it.group === 'zone'), [pickItems]);

  const openPicker = useCallback((i: number) => {
    const r = rows[i];
    if (!r) return;
    const gameId = r.game.id;
    const first = r.found.findIndex((c) => !isDown(c));
    // A PPV event is its channel's name: no guide to ask.
    const hasGuide = r.game.league !== 'ppv';
    setPicker({ gameId, focus: Math.max(0, first), moved: false, scanning: !!channels && hasGuide, extra: [] });
    if (!channels || !hasGuide) return;
    // What the guide says of the channels found by name, and of the league's
    // numbered channels and the game's streaming feeds no name found.
    // The list fills in as the answers come (a few lookups at a time).
    const lay = (extra: GameChannel[], done: boolean) => {
      setPicker((p) => (p && p.gameId === gameId
        ? { ...p, extra, scanning: !done, focus: extra.length && !p.moved ? 0 : p.focus }
        : p));
      // The whole answer stays with the game's row (until the channel list
      // is read again): a network it confirmed can be the row's Watch pick.
      if (done) setGuided((m) => (m.get(gameId) === extra ? m : new Map(m).set(gameId, extra)));
    };
    // The guide is asked about the channels found by search too: one showing
    // something else is dropped, one with the game joins its channels.
    void checkGuides(r.game, channels, r.search.length ? [...r.auto, ...r.search] : r.auto, games ?? [], Date.now(), (partial) => lay(partial, false))
      .then((extra) => lay(extra, true))
      .catch(() => setPicker((p) => (p && p.gameId === gameId ? { ...p, scanning: false } : p)));
  }, [rows, channels, isDown, games]);

  // The guide's answers reorder the list: a viewer who has moved stays on the
  // channel they were on, not on whatever now sits at that row.
  const focusKeyRef = useRef<string | null>(null);
  const lastOrderRef = useRef<string | null>(null);
  useEffect(() => {
    if (!picker) { focusKeyRef.current = null; lastOrderRef.current = null; return; }
    // The list is rebuilt on every move: what counts is whether its order did.
    const order = pickItems.map(pickKey).join(',');
    const changed = lastOrderRef.current !== null && lastOrderRef.current !== order;
    lastOrderRef.current = order;
    if (changed && picker.moved && focusKeyRef.current) {
      const i = pickItems.findIndex((it) => pickKey(it) === focusKeyRef.current);
      if (i >= 0 && i !== picker.focus) { setPicker((p) => (p ? { ...p, focus: i } : p)); return; }
    }
    const cur = pickItems[picker.focus];
    focusKeyRef.current = cur ? pickKey(cur) : null;
  }, [picker, pickItems]);

  // A two-team game's list closing with nothing to watch: remembered this
  // session, so a channel Live TV then plays for the teams can say where it was.
  const aiOnRef = useRef(aiOn);
  aiOnRef.current = aiOn;
  const noteMiss = useCallback(() => {
    if (!aiOnRef.current) return;
    const st = stateRef.current;
    const row = st.picker ? st.rows.find((r) => r.game.id === st.picker?.gameId) : undefined;
    if (!row || !row.game.home || !row.game.away) return;
    if (st.pickItems.some((it) => it.kind === 'link' && it.group === 'main' && !it.down)) return;
    rememberMiss(row.game, teamTokens(row.game));
  }, []);
  const closePicker = useCallback(() => { noteMiss(); setPicker(null); }, [noteMiss]);

  const activate = useCallback((item: PickItem | undefined) => {
    if (!item) return;
    const gameId = stateRef.current.picker?.gameId;
    noteMiss();
    setPicker(null);
    if (item.kind === 'link') {
      const { line, stream } = item.link;
      if (item.group === 'search') {
        const league = stateRef.current.rows.find((r) => r.game.id === gameId)?.game.league ?? '';
        trackAiPlay(league, searchOf(item.link) ?? 'medium');
      }
      // Live TV shows every line at once, so a link from another line plays
      // on that line as it is: the active account is not switched.
      const others = stateRef.current.lines;
      if (others.length > 1 && lineKey(line) !== lineKey(others[0])) {
        toast({ title: t('gameDay.playingOn', { service: serviceName(line) }) });
      }
      handLiveDeeplink({
        host: line.host, username: line.username, streamId: stream.stream_id,
        name: stream.name, icon: stream.stream_icon || undefined,
        categoryId: stream.category_id != null ? String(stream.category_id) : undefined, num: stream.num ?? undefined,
      });
    } else {
      handLiveCategory({ host: item.line.host, username: item.line.username, categoryId: item.categoryId });
    }
    onWatch(gameId);
  }, [onWatch, toast, t, noteMiss]);

  // A kickoff reminder with no channel asked for this game's list.
  useEffect(() => {
    if (!isActive || !rows.length || !channels) return;
    let want: string | null = null;
    try { want = sessionStorage.getItem(GAMEDAY_OPEN_KEY); } catch { want = null; }
    if (!want) return;
    const i = rows.findIndex((r) => r.game.id === want);
    // A PPV event that isn't a fight is under the PPV filter: go there first.
    if (i < 0 && want.startsWith('ppv:') && league !== 'ppv' && ppvLinks.has(want)) {
      setLeague('ppv'); setChipIdx(Math.max(0, leagues.findIndex((l) => l.id === 'ppv')));
      return;
    }
    try { sessionStorage.removeItem(GAMEDAY_OPEN_KEY); } catch { /* ignore */ }
    if (i < 0) return;
    setZone('rows'); setRowIdx(i); setAction(0);
    openPicker(i);
  }, [isActive, rows, channels, openPicker, league, leagues, ppvLinks]);

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
    toast({ title: on ? t('gameDay.toast.setTitle') : t('gameDay.toast.removedTitle'), description: on ? t('gameDay.toast.setDesc', { name: r.game.name }) : r.game.name });
  }, [rows, toast, t]);

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
  const stateRef = useRef({ zone, chipIdx, rowIdx, action, rows, leagues, picker, pickItems, lines, reportFor });
  stateRef.current = { zone, chipIdx, rowIdx, action, rows, leagues, picker, pickItems, lines, reportFor };
  // OK on a channel in the list: let go soon = play, held = its menu.
  const holdRef = useRef<{ timer: number | null; item: PickItem | null; fired: boolean }>({ timer: null, item: null, fired: false });
  const clearHold = useCallback(() => {
    const h = holdRef.current;
    if (h.timer) window.clearTimeout(h.timer);
    h.timer = null; h.item = null;
  }, []);
  useEffect(() => { if (!picker) clearHold(); }, [picker, clearHold]);
  useEffect(() => clearHold, [clearHold]);
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      // The report menu owns the remote while it is open.
      if (stateRef.current.reportFor) return;
      // A popup over the Player (kickoff reminder, voice) has the remote.
      if (modalOpen()) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
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
        if (e.key === 'ArrowUp') setPicker((p) => (p ? { ...p, moved: true, focus: Math.max(0, p.focus - 1) } : p));
        else if (e.key === 'ArrowDown') setPicker((p) => (p ? { ...p, moved: true, focus: Math.min(Math.max(0, n - 1), p.focus + 1) } : p));
        else if (e.key === 'ArrowLeft') closePicker();
        else if (ok) {
          const item = n ? st.pickItems[Math.min(st.picker.focus, n - 1)] : undefined;
          const hold = holdRef.current;
          if (!item) closePicker();
          else if (item.kind === 'browse') activate(item);
          else if (!hold.timer && !hold.fired) {
            hold.item = item;
            hold.timer = window.setTimeout(() => {
              hold.timer = null; hold.item = null; hold.fired = true;
              setReportFor(item.link);
            }, HOLD_MS);
          }
        }
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
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.keyCode !== 13 && e.keyCode !== 23) return;
      const hold = holdRef.current;
      // Let go before the hold: a short press, so play. After it, the menu is already open.
      if (hold.timer) {
        const item = hold.item;
        clearHold();
        activate(item ?? undefined);
      }
      hold.fired = false;
    };
    window.addEventListener('keydown', handler, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, [isActive, onExitLeft, onExitUp, openPicker, closePicker, activate, remind, clearHold]);

  // More than one signed-in line: each link says which service it is on.
  const multi = lines.length > 1;
  // The link being reported was found by search: its menu offers "Not this game".
  const reportIsSearch = !!reportFor && pickItems.some((it) => it.kind === 'link' && it.group === 'search' && channelKey(it.link) === channelKey(reportFor));
  const focusedRow = isActive && zone === 'rows' && !picker ? rowIdx : -1;

  return (
    <div className="relative flex-1 min-w-0 flex flex-col text-white px-4 py-3 overflow-hidden">
      <div className="flex items-center mb-3">
        <Trophy className="w-6 h-6 text-brand-gold mr-2" />
        <h2 className="font-quicksand font-bold text-2xl mr-4">{t('gameDay.title')}</h2>
        <div className="flex flex-wrap items-center" data-howto="gd.chips">
          {leagues.map((l, i) => {
            const focused = isActive && zone === 'chips' && chipIdx === i && !picker;
            const on = league === l.id;
            return (
              <button
                key={l.id}
                type="button"
                data-focused={focused ? 'true' : 'false'}
                onClick={() => { setLeague(l.id); setRowIdx(0); }}
                // The focus ring is gold: on the selected chip's solid gold
                // it vanished, so the selected chip under the remote keeps
                // its gold in the text and a gold tint, and the ring shows.
                className={`tv-ring mr-2 mb-1 rounded-full px-3 py-1 text-sm font-semibold ${on && focused ? 'bg-brand-gold/25 text-brand-gold' : on ? 'bg-brand-gold text-black' : focused ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
              >
                {l.label}
              </button>
            );
          })}
        </div>
      </div>

      {games === null && !error && (
        <div className="flex-1 flex items-center justify-center text-white/70"><Loader2 className="w-6 h-6 animate-spin mr-2" /> {t('gameDay.loading')}</div>
      )}
      {error && games === null && (
        <div className="flex-1 flex items-center justify-center text-white/70">{t('gameDay.loadError')}</div>
      )}
      {games && rows.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-white/70">{t('gameDay.empty')}</div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto pr-1">
        {rows.map((r, i) => {
          const g = r.game;
          const focused = focusedRow === i;
          const live = g.state === 'in';
          const reminded = hasReminder(g.id);
          const remindable = canRemind(g);
          const { tv, when } = r;
          return (
            <div
              key={g.id}
              data-gd-row={i}
              data-focused={focused ? 'true' : 'false'}
              data-howto="gd.game"
              className={`tv-ring flex items-center rounded-xl px-3 py-2 mb-2 ${focused ? 'bg-brand-gold/20' : 'bg-white/5'}`}
            >
              <div className="w-28 shrink-0 mr-3">
                <div className="text-xs font-bold uppercase tracking-wide text-brand-ice/70 truncate">
                  {g.leagueLabel}{!live && when.day ? ` · ${when.day}` : ''}
                </div>
                {live
                  ? <div className="text-sm font-bold text-red-400 truncate">{t('gameDay.liveDot', { detail: g.detail })}</div>
                  : <div className="text-sm text-white/80 truncate">{when.time}</div>}
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
                  <span className="text-xs text-white/50">{t('gameDay.findingChannels')}</span>
                ) : r.channel ? (
                  <div className="min-w-0">
                    <div className="flex items-center min-w-0">
                      {r.channelDown && <AlertTriangle className="w-4 h-4 text-amber-400 mr-1 shrink-0" aria-label={t('gameDay.reportedDown')} />}
                      <span className={`truncate text-sm ${r.channelDown ? 'text-amber-300' : 'text-white/90'}`}>{r.channel.stream.name}</span>
                      {multi && <ServiceTag name={serviceName(r.channel.line)} label={t('gameDay.serviceTag', { service: serviceName(r.channel.line) })} onLight={false} />}
                      {r.more > 0 && <span className="ml-1 text-xs text-white/50 shrink-0">+{r.more}</span>}
                    </div>
                    {searchOf(r.channel) && !r.channel.picked && (
                      <span className="block truncate text-xs text-brand-ice/70">{t('gameDay.foundBySearch')}</span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-white/50 truncate block">
                    {r.unsure
                      ? t('gameDay.checkOn', { networks: g.networks.join(', ') })
                      : tv.length ? t('gameDay.notInChannelsOn', { networks: tv.join(', ') }) : g.networks.length ? t('gameDay.streamingOnly', { networks: g.networks.join(', ') }) : t('gameDay.notInChannels')}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => { setRowIdx(i); setAction(0); openPicker(i); }}
                className={`rounded-lg px-3 py-2 mr-2 text-sm font-semibold flex items-center ${focused && action === 0 ? 'bg-white text-black' : 'bg-white/10 text-white'}`}
              >
                <Play className="w-4 h-4 mr-1 shrink-0" /> <span className="min-w-0 truncate">{t('gameDay.watchBtn')}</span>
              </button>
              {remindable ? (
                <button
                  type="button"
                  onClick={() => { setRowIdx(i); remind(i); }}
                  aria-pressed={reminded}
                  data-howto={i === 0 ? 'gd.remind' : undefined}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold flex items-center ${focused && action === 1 ? 'bg-white text-black' : reminded ? 'bg-brand-gold/30 text-brand-gold' : 'bg-white/10 text-white'}`}
                >
                  {reminded ? <BellRing className="w-4 h-4 mr-1 shrink-0" /> : <Bell className="w-4 h-4 mr-1 shrink-0" />}
                  <span className="min-w-0 truncate">{reminded ? t('gameDay.reminderOnBtn') : t('gameDay.remindBtn')}</span>
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
            <button type="button" onClick={closePicker} aria-label={t('common.close')} className="ml-auto rounded-lg bg-white/10 p-2 shrink-0"><X className="w-5 h-5" /></button>
          </div>
          <p className="text-sm text-white/60 mb-3">
            {pickerRow.game.leagueLabel} · {pickerRow.game.state === 'in' ? t('gameDay.liveDetail', { detail: pickerRow.game.detail }) : kickoffLabel(pickerRow.game.start)}
            {pickerRow.game.networks.length > 0 && ` · ${t('gameDay.tvNetworks', { networks: pickerRow.game.networks.join(', ') })}`}
          </p>
          <div ref={pickRef} className="flex-1 overflow-y-auto pr-1" data-howto="gd.links">
            {pickItems.map((item, i) => {
              const focused = picker.focus === i;
              const base = `tv-ring flex items-center rounded-xl px-4 py-3 mb-2 w-full text-left ${focused ? 'bg-white text-black' : 'bg-white/5 text-white'}`;
              if (item.kind === 'browse') {
                return (
                  <button key={`b-${item.line.host}-${item.categoryId}`} type="button" data-gd-pick={i} data-focused={focused ? 'true' : 'false'} className={base} onClick={() => activate(item)}>
                    <FolderOpen className="w-5 h-5 mr-3 shrink-0" />
                    <span className="flex-1 min-w-0 truncate font-semibold">{t('gameDay.browse', { name: item.name })}</span>
                  </button>
                );
              }
              const { link } = item;
              return (
                <div key={`l-${link.line.host}-${link.line.username}-${link.stream.stream_id}`}>
                  {i === firstSearchIdx && (
                    <div className="px-2 pt-1 pb-2 text-xs font-bold uppercase tracking-wide text-white/40">
                      {t('gameDay.searchHeading')}
                    </div>
                  )}
                  {i === firstUnconfirmedIdx && (
                    <div className="px-2 pt-1 pb-2 text-xs font-bold uppercase tracking-wide text-white/40" data-howto="gd.unconfirmed">
                      {t('gameDay.unconfirmedHeading')}
                    </div>
                  )}
                  {i === firstZoneIdx && (
                    <div className="px-2 pt-1 pb-2 text-xs font-bold uppercase tracking-wide text-white/40">
                      {t('gameDay.zoneHeading')}
                    </div>
                  )}
                  <button type="button" data-gd-pick={i} data-focused={focused ? 'true' : 'false'} data-howto={item.down ? 'gd.down' : undefined} className={base} onClick={() => activate(item)}>
                    {item.down
                      ? <AlertTriangle className="w-5 h-5 mr-3 shrink-0 text-amber-500" aria-label={t('gameDay.reportedDown')} />
                      : <Play className="w-5 h-5 mr-3 shrink-0" />}
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center min-w-0">
                        <span className="truncate font-semibold">{link.stream.name}</span>
                        {multi && <ServiceTag name={serviceName(link.line)} label={t('gameDay.serviceTag', { service: serviceName(link.line) })} onLight={focused} howto={i === firstLinkIdx ? 'gd.serviceTag' : undefined} />}
                      </span>
                      {link.picked && (
                        <span data-howto="gd.picked" className={`flex items-center min-w-0 text-xs font-bold ${focused ? 'text-amber-700' : 'text-brand-gold'}`}>
                          <Star className="w-3 h-3 mr-1 shrink-0" />
                          <span className="truncate">{t('gameDay.link.picked', { defaultValue: PICKED_LABEL })}</span>
                        </span>
                      )}
                      {link.note && <span className={`block truncate text-xs ${focused ? 'text-black/60' : 'text-white/50'}`}>{link.note}</span>}
                    </span>
                    <span className={`ml-3 shrink-0 text-xs font-bold uppercase tracking-wide ${focused ? 'text-black/60' : 'text-brand-ice/70'}`}>
                      {item.group === 'search' ? t('gameDay.link.search') : t(`gameDay.link.${link.via}`, { defaultValue: LINK_LABELS[link.via] })}
                    </span>
                  </button>
                </div>
              );
            })}
            {picker.scanning && (
              <div className="flex items-center text-white/60 text-sm px-2 py-2"><Loader2 className="w-4 h-4 animate-spin mr-2" /> {t('gameDay.checkingGuide')}</div>
            )}
            {aiBusy > 0 && !!pickerRow.game.home && !!pickerRow.game.away && !pickItems.some((it) => it.kind === 'link' && it.group === 'main') && (
              <div className="flex items-center text-white/60 text-sm px-2 py-2"><Loader2 className="w-4 h-4 animate-spin mr-2" /> {t('gameDay.searching')}</div>
            )}
            {!picker.scanning && pickItems.length === 0 && (
              <div className="text-white/70 px-2 py-4">
                {pickerRow.game.networks.length ? t('gameDay.noneOn', { networks: pickerRow.game.networks.join(', ') }) : t('gameDay.none')}
              </div>
            )}
          </div>
          {firstLinkIdx >= 0 && (
            <p className="mt-2 shrink-0 text-xs font-nunito text-white/50" data-howto="gd.holdHint">{t('gameDay.holdHint')}</p>
          )}
        </div>
      )}

      {reportFor && (
        <Suspense fallback={null}>
          <ReportChannelDialog
            channelName={reportFor.stream.name}
            channelId={reportFor.stream.stream_id}
            categoryName={pickerRow ? `Game Day: ${pickerRow.game.name}` : 'Game Day'}
            serviceLabel={multi ? serviceName(reportFor.line) : undefined}
            onReportedDown={() => signalChannel(reportFor.line.host, reportFor.stream.stream_id, reportFor.stream.name, 'down')}
            isDown={crowdDown(reportFor)}
            onClearDown={() => signalChannel(reportFor.line.host, reportFor.stream.stream_id, reportFor.stream.name, 'clear')}
            onWrongGame={aiOn && pickerRow && reportIsSearch ? () => {
              const cat = channels?.find((c) => channelKey(c) === channelKey(reportFor))?.cat ?? '';
              markWrong(pickerRow.game, reportFor, cat);
              setWrongTick((n) => n + 1);
            } : undefined}
            onOpenBufferingGuide={() => {
              setReportFor(null);
              onNavigate?.('support');
              setTimeout(() => { window.dispatchEvent(new CustomEvent('support:open-buffering-guide')); }, 80);
            }}
            onClose={() => setReportFor(null)}
          />
        </Suspense>
      )}
    </div>
  );
});
GameDaySection.displayName = 'GameDaySection';

export default GameDaySection;
