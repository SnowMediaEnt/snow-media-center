// Skip Intro and Up Next for Plex episodes.
//
// Renders nothing. While an episode plays it reads where the intro and the
// credits are (Plex's markers, present when the server's intro/credits
// detection has run) and which episode comes next, watches the playhead, and
// hands the player one prompt at a time: "Skip Intro" during the intro, then
// "Up next · playing in 10" at the credits (or 20 s before the end when the
// server has no credits marker). OK takes it; Back on Up Next keeps watching
// the credits. When the episode ends with Up Next still standing, the next
// one starts instead of the player closing.
//
// Its own component so the once-a-second playhead check re-renders this, not
// the whole Plex screen. Near the intro and the end it checks every second,
// otherwise every five.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getNextPlexEpisode, getPlexPlayInfo, type PlexEpisode, type PlexPlayInfo } from '@/lib/plex';
import type { PlayerPrompt } from './PlexPlayerOverlay';

export type NextEpisode = PlexEpisode & { seasonIndex?: number };

interface Props {
  /** The player is up and this title is loaded. */
  active: boolean;
  base: string;
  token: string;
  ratingKey: string | null;
  getPosition: () => Promise<{ position: number; duration: number; playing: boolean }>;
  seekTo: (seconds: number) => Promise<void>;
  onPrompt: (prompt: PlayerPrompt | null) => void;
  onPlayNext: (ep: NextEpisode, info: PlexPlayInfo) => void;
  /** What is playing (movie or episode), once known; null when it changes. */
  onInfo?: (info: PlexPlayInfo | null) => void;
  /** Receives the function the player runs when the episode ends: true when
   *  it started the next episode (so the player must not close). */
  registerEnded: (fn: (() => boolean) | null) => void;
}

const UP_NEXT_SECONDS = 10;
/** Without a credits marker, Up Next shows this long before the end. */
const NO_CREDITS_LEAD = 20;

const episodeLabel = (ep: NextEpisode): string => {
  const se = ep.seasonIndex != null && ep.index != null ? `S${ep.seasonIndex} · E${ep.index}  ` : '';
  return `${se}${ep.title}`.trim();
};

const EpisodeAutoplay = memo(({ active, base, token, ratingKey, getPosition, seekTo, onPrompt, onPlayNext, onInfo, registerEnded }: Props) => {
  const [info, setInfo] = useState<PlexPlayInfo | null>(null);
  const [next, setNext] = useState<NextEpisode | null>(null);
  const [pos, setPos] = useState<{ at: number; dur: number; playing: boolean } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const startedRef = useRef(false);

  const getPositionRef = useRef(getPosition); useEffect(() => { getPositionRef.current = getPosition; }, [getPosition]);
  const seekToRef = useRef(seekTo); useEffect(() => { seekToRef.current = seekTo; }, [seekTo]);
  const onPromptRef = useRef(onPrompt); useEffect(() => { onPromptRef.current = onPrompt; }, [onPrompt]);
  const onPlayNextRef = useRef(onPlayNext); useEffect(() => { onPlayNextRef.current = onPlayNext; }, [onPlayNext]);
  const onInfoRef = useRef(onInfo); useEffect(() => { onInfoRef.current = onInfo; }, [onInfo]);

  // What this episode is and what follows it. A new title starts clean.
  useEffect(() => {
    setInfo(null); setNext(null); setPos(null); setDismissed(false); setCountdown(null);
    startedRef.current = false;
    if (!ratingKey || !base) return;
    let gone = false;
    void (async () => {
      const i = await getPlexPlayInfo(base, token, ratingKey).catch(() => null);
      if (gone || !i) return;
      setInfo(i);
      const n = await getNextPlexEpisode(base, token, i).catch(() => null);
      if (!gone) setNext(n);
    })();
    return () => { gone = true; };
  }, [base, token, ratingKey]);

  const intro = useMemo(() => info?.markers.find((m) => m.type === 'intro') ?? null, [info]);
  // Plex can mark credits at the start of a cold open too; only the ones in
  // the second half are the end credits.
  const credits = useMemo(() => info?.markers.find((m) => m.type === 'credits' && (!info.duration || m.start > info.duration / 2)) ?? null, [info]);
  const upNextAt = next && pos && pos.dur > 0 ? (credits ? credits.start : pos.dur - NO_CREDITS_LEAD) : null;

  // Playhead: every second near the intro and the end, every five otherwise.
  const watching = active && !!info && (!!intro || !!next);
  const introRef = useRef(intro); introRef.current = intro;
  // Read by the countdown between renders: a pause must hold it at once.
  const playingRef = useRef(false);
  const upNextAtRef = useRef(upNextAt); upNextAtRef.current = upNextAt;
  useEffect(() => {
    if (!watching) return;
    let alive = true;
    let timer = 0;
    const tick = async () => {
      let at = -1;
      try {
        const p = await getPositionRef.current();
        if (!alive) return;
        at = p.position;
        playingRef.current = p.playing;
        setPos({ at: p.position, dur: p.duration > 0 ? p.duration : (info?.duration ?? 0), playing: p.playing });
      } catch { /* try again next tick */ }
      if (!alive) return;
      const i = introRef.current;
      const u = upNextAtRef.current;
      const near = at < 0
        || (i != null && at < i.end + 1)
        || (u != null && at >= u - 15)
        || (u == null && next != null); // duration not known yet
      timer = window.setTimeout(() => { void tick(); }, near ? 1000 : 5000);
    };
    void tick();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [watching, info, next]);

  const inIntro = !!intro && !!pos && pos.at >= intro.start && pos.at < intro.end - 1;
  const inUpNext = !!next && upNextAt != null && !!pos && pos.at >= upNextAt && !dismissed;

  const go = useCallback(() => {
    if (startedRef.current || !next || !info) return;
    startedRef.current = true;
    onPlayNextRef.current(next, info);
  }, [next, info]);

  // Up Next counts down while the picture is playing (a pause holds it).
  useEffect(() => {
    if (!inUpNext) { setCountdown(null); return; }
    setCountdown(UP_NEXT_SECONDS);
    const id = window.setInterval(() => {
      if (!playingRef.current) return;
      setCountdown((c) => (c == null ? c : Math.max(0, c - 1)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [inUpNext]);
  useEffect(() => { if (countdown === 0) go(); }, [countdown, go]);

  // The episode ran out with Up Next still standing: straight on.
  useEffect(() => {
    registerEnded(() => {
      if (next && info && !dismissed) { go(); return true; }
      return false;
    });
    return () => registerEnded(null);
  }, [registerEnded, next, info, dismissed, go]);

  const prompt = useMemo<PlayerPrompt | null>(() => {
    if (inUpNext && next) {
      return {
        kind: 'next',
        label: 'Play next episode',
        detail: episodeLabel(next),
        countdown: countdown ?? undefined,
        onOk: go,
        onBack: () => setDismissed(true),
      };
    }
    if (inIntro && intro) {
      return { kind: 'skip', label: 'Skip Intro', onOk: () => { void seekToRef.current(intro.end); } };
    }
    return null;
  }, [inUpNext, next, countdown, go, inIntro, intro]);

  useEffect(() => { onPromptRef.current(prompt); }, [prompt]);
  useEffect(() => () => onPromptRef.current(null), []);

  return null;
});
EpisodeAutoplay.displayName = 'EpisodeAutoplay';
export default EpisodeAutoplay;
