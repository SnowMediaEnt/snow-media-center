// Plex detail page — instant render from the caller's PlexItem, with skeleton
// placeholders that fill in as getPlexMetadata resolves. Backdrop art is
// lazy-mounted after first paint so it never blocks interaction on cold TV
// hardware. Cast row + actor filmography overlay have their own D-pad zones
// and share the same Back stack as show → seasons → episodes.
// Fire-TV D-pad only. All Plex HTTP via plex.ts.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, RotateCw, List } from 'lucide-react';
import { getPlexMetadata, getPlexSeasons, getPlexEpisodes, getPlexActorItems, resolutionLabel,
  type PlexMetadata, type PlexSeason, type PlexEpisode, type PlexItem, type PlexPerson } from '@/lib/plex';
import PlexImage from './PlexImage';
import { isNativePlatform } from '@/utils/platform';
import { runWhenIdle } from '@/utils/idle';
import type { SubtitleSearchContext } from './PlexPlayerOverlay';

interface Props {
  isActive: boolean;
  base: string;
  token: string;
  item: PlexItem;
  onPlay: (item: PlexItem, resumeSec?: number, ctx?: SubtitleSearchContext) => void;
  /** Play a specific episode (shows). */
  onPlayEpisode: (ep: PlexEpisode, ctx?: SubtitleSearchContext) => void;
  onBack: () => void;
}

type Step = 'detail' | 'seasons' | 'episodes' | 'actorGrid';
type DetailZone = 'buttons' | 'cast';

const COLS = 6;
const fmtRuntime = (ms?: number): string => {
  if (!ms || ms <= 0) return '';
  const total = Math.floor(ms / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const techBadge = (meta?: PlexMetadata['media']): string => {
  if (!meta) return '';
  const parts: string[] = [];
  if (meta.videoCodec) parts.push(meta.videoCodec.toUpperCase());
  if (meta.audioChannels) {
    const ch = meta.audioChannels;
    parts.push(ch === 6 ? '5.1' : ch === 8 ? '7.1' : `${ch}ch`);
  } else if (meta.audioCodec) parts.push(meta.audioCodec.toUpperCase());
  return parts.join(' · ');
};

const ResBadge = memo(({ label, className = '' }: { label: string; className?: string }) => {
  if (!label) return null;
  const gold = label === '4K';
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded bg-black/70 ${gold ? 'text-brand-gold' : 'text-white/80'} ${className}`}>
      {label}
    </span>
  );
});
ResBadge.displayName = 'ResBadge';

const PlexDetail = memo(({ isActive, base, token, item, onPlay, onPlayEpisode, onBack }: Props) => {
  // ── back-stack of items (top = current). Opening a title from actor
  //    filmography pushes; Back pops before we ever hit onBack().
  const [stack, setStack] = useState<PlexItem[]>([item]);
  const current = stack[stack.length - 1];

  const [meta, setMeta] = useState<PlexMetadata | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  const [step, setStep] = useState<Step>('detail');
  const [zone, setZone] = useState<DetailZone>('buttons');
  const [btn, setBtn] = useState(0);
  const [castIdx, setCastIdx] = useState(0);

  const [seasons, setSeasons] = useState<PlexSeason[]>([]);
  const [seasonsLoading, setSeasonsLoading] = useState(false);
  const [seasonIdx, setSeasonIdx] = useState(0);

  const [episodes, setEpisodes] = useState<PlexEpisode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [epIdx, setEpIdx] = useState(0);

  // Actor filmography overlay
  const [actorName, setActorName] = useState('');
  const [actorItems, setActorItems] = useState<PlexItem[]>([]);
  const [actorLoading, setActorLoading] = useState(false);
  const [actorCursor, setActorCursor] = useState(0);

  // Cast is mounted lazily AFTER meta resolves — poster images alone can pin
  // 30-100MB into the WebView layer on a 1GB Fire TV Stick, and the detail
  // page is already fighting a heap spike from getPlexMetadata's JSON parse.
  const [castReady, setCastReady] = useState(false);

  // Reset all state when the top-of-stack item changes. getPlexMetadata is
  // deferred via runWhenIdle so its JSON parse can't block the first D-pad
  // press after openDetail (the page renders instantly from `current`).
  useEffect(() => {
    setMeta(null);
    setMetaLoading(true);
    setStep('detail');
    setZone('buttons');
    setBtn(0);
    setCastIdx(0);
    setCastReady(false);
    setSeasons([]); setEpisodes([]); setSeasonIdx(0); setEpIdx(0);
    let cancelled = false;
    const cancelIdle = runWhenIdle(() => {
      if (cancelled) return;
      getPlexMetadata(base, token, current.ratingKey)
        .then((m) => { if (!cancelled) setMeta(m); })
        .catch(() => { /* keep meta null — instant render from `current` still works */ })
        .finally(() => {
          if (cancelled) return;
          setMetaLoading(false);
          // Cast headshots mount on the NEXT idle window after meta resolves.
          runWhenIdle(() => { if (!cancelled) setCastReady(true); }, 400);
        });
    }, 120);
    return () => { cancelled = true; cancelIdle(); };
  }, [base, token, current]);

  // Backdrop art is expensive to decode (a 1280x720 JPEG easily pushes 4-6MB
  // into the WebView surface and, on the Fire TV Stick 4K Max we're targeting,
  // is the direct cause of the ~200MB allocation → 25s GC pause when the
  // detail page opens). On NATIVE we skip it entirely; on web we defer past
  // first paint. Either way the gradient overlay below still frames the page.
  const [backdropReady, setBackdropReady] = useState(false);
  const showBackdrop = !isNativePlatform();
  useEffect(() => {
    if (!showBackdrop) { setBackdropReady(false); return; }
    setBackdropReady(false);
    const cancel = runWhenIdle(() => setBackdropReady(true), 600);
    return cancel;
  }, [current, showBackdrop]);

  const isShow = (meta?.type ?? current.type) === 'show';
  const isEpisode = (meta?.type ?? current.type) === 'episode';
  const viewOffset = meta?.viewOffset ?? 0;
  const canResume = !isShow && viewOffset > 0 && (!meta?.duration || viewOffset < meta.duration - 30000);
  const resumeSec = Math.floor(viewOffset / 1000);

  const detailButtons: Array<{ id: string; label: string }> = useMemo(() => {
    const b: Array<{ id: string; label: string }> = [];
    if (isShow) b.push({ id: 'browse', label: 'Browse Episodes' });
    else b.push({ id: 'play', label: 'Play' });
    if (canResume) {
      const h = Math.floor(resumeSec / 3600);
      const m = Math.floor((resumeSec % 3600) / 60);
      b.push({ id: 'resume', label: `Resume ${h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m}m`}` });
    }
    return b;
  }, [isShow, canResume, resumeSec]);

  useEffect(() => { if (btn >= detailButtons.length) setBtn(0); }, [detailButtons.length, btn]);

  const cast: PlexPerson[] = meta?.cast ?? [];

  const loadSeasons = useCallback(async () => {
    setSeasonsLoading(true);
    try {
      const s = await getPlexSeasons(base, token, current.ratingKey);
      setSeasons(s);
      setSeasonIdx(0);
    } finally { setSeasonsLoading(false); }
  }, [base, token, current]);

  const loadEpisodes = useCallback(async (seasonKey: string) => {
    setEpisodesLoading(true);
    try {
      const e = await getPlexEpisodes(base, token, seasonKey);
      setEpisodes(e);
      setEpIdx(0);
    } finally { setEpisodesLoading(false); }
  }, [base, token]);

  const openActor = useCallback(async (person: PlexPerson) => {
    const sectionKey = meta?.librarySectionID;
    if (!person.id || !sectionKey) return;
    setActorName(person.tag);
    setActorItems([]);
    setActorCursor(0);
    setActorLoading(true);
    setStep('actorGrid');
    try {
      const list = await getPlexActorItems(base, token, sectionKey, person.id);
      setActorItems(list);
    } finally {
      setActorLoading(false);
    }
  }, [base, token, meta]);

  const playCurrent = useCallback((resume?: number) => {
    const ctx: SubtitleSearchContext = { title: meta?.title || current.title, year: meta?.year };
    onPlay(current, resume, ctx);
  }, [meta, current, onPlay]);

  const activateDetail = useCallback((id: string) => {
    if (id === 'play') playCurrent(undefined);
    else if (id === 'resume') playCurrent(resumeSec);
    else if (id === 'browse') { setStep('seasons'); void loadSeasons(); }
  }, [playCurrent, resumeSec, loadSeasons]);

  const pushItem = useCallback((next: PlexItem) => {
    setStack((s) => [...s, next]);
  }, []);
  const popStackOrBack = useCallback(() => {
    setStack((s) => {
      if (s.length > 1) return s.slice(0, -1);
      // At the root — the only way out is the caller's onBack.
      window.setTimeout(() => onBack(), 0);
      return s;
    });
  }, [onBack]);

  // Refs for the key handler
  const stepRef = useRef(step); useEffect(() => { stepRef.current = step; }, [step]);
  const zoneRef = useRef(zone); useEffect(() => { zoneRef.current = zone; }, [zone]);
  const btnRef = useRef(btn); useEffect(() => { btnRef.current = btn; }, [btn]);
  const castIdxRef = useRef(castIdx); useEffect(() => { castIdxRef.current = castIdx; }, [castIdx]);
  const btnsRef = useRef(detailButtons); useEffect(() => { btnsRef.current = detailButtons; }, [detailButtons]);
  const castRef = useRef(cast); useEffect(() => { castRef.current = cast; }, [cast]);
  const seasonsRef = useRef(seasons); useEffect(() => { seasonsRef.current = seasons; }, [seasons]);
  const seasonIdxRef = useRef(seasonIdx); useEffect(() => { seasonIdxRef.current = seasonIdx; }, [seasonIdx]);
  const episodesRef = useRef(episodes); useEffect(() => { episodesRef.current = episodes; }, [episodes]);
  const epIdxRef = useRef(epIdx); useEffect(() => { epIdxRef.current = epIdx; }, [epIdx]);
  const actorItemsRef = useRef(actorItems); useEffect(() => { actorItemsRef.current = actorItems; }, [actorItems]);
  const actorCursorRef = useRef(actorCursor); useEffect(() => { actorCursorRef.current = actorCursor; }, [actorCursor]);
  const activateRef = useRef(activateDetail); useEffect(() => { activateRef.current = activateDetail; }, [activateDetail]);
  const loadEpisodesRef = useRef(loadEpisodes); useEffect(() => { loadEpisodesRef.current = loadEpisodes; }, [loadEpisodes]);
  const onPlayEpisodeRef = useRef(onPlayEpisode); useEffect(() => { onPlayEpisodeRef.current = onPlayEpisode; }, [onPlayEpisode]);
  const popRef = useRef(popStackOrBack); useEffect(() => { popRef.current = popStackOrBack; }, [popStackOrBack]);
  const metaRef = useRef(meta); useEffect(() => { metaRef.current = meta; }, [meta]);
  const currentRef = useRef(current); useEffect(() => { currentRef.current = current; }, [current]);
  const openActorRef = useRef(openActor); useEffect(() => { openActorRef.current = openActor; }, [openActor]);
  const pushItemRef = useRef(pushItem); useEffect(() => { pushItemRef.current = pushItem; }, [pushItem]);

  // useLayoutEffect (pre-paint) so no D-pad press is lost between openDetail
  // firing setDetailItem in the parent and this handler being wired up.
  useLayoutEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;
      const keys = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '];
      if (!isBack && !keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();

      const s = stepRef.current;
      if (isBack) {
        if (s === 'actorGrid') { setStep('detail'); setZone('cast'); return; }
        if (s === 'episodes') { setStep('seasons'); return; }
        if (s === 'seasons') { setStep('detail'); return; }
        // detail step: never trap inside the cast row for Back
        popRef.current();
        return;
      }

      if (s === 'detail') {
        const z = zoneRef.current;
        if (z === 'buttons') {
          const bs = btnsRef.current;
          const b = btnRef.current;
          if (e.key === 'ArrowLeft') { if (b > 0) setBtn(b - 1); }
          else if (e.key === 'ArrowRight') { if (b < bs.length - 1) setBtn(b + 1); }
          else if (e.key === 'ArrowDown') {
            if (castRef.current.length > 0) { setZone('cast'); setCastIdx(0); }
          }
          else if (e.key === 'Enter' || e.key === ' ') { const def = bs[b]; if (def) activateRef.current(def.id); }
          return;
        }
        // cast zone
        const list = castRef.current;
        const c = castIdxRef.current;
        if (list.length === 0) { setZone('buttons'); return; }
        if (e.key === 'ArrowUp') { setZone('buttons'); }
        else if (e.key === 'ArrowLeft') { if (c > 0) setCastIdx(c - 1); }
        else if (e.key === 'ArrowRight') { if (c < list.length - 1) setCastIdx(c + 1); }
        else if (e.key === 'Enter' || e.key === ' ') { const p = list[c]; if (p) void openActorRef.current(p); }
        return;
      }
      if (s === 'seasons') {
        const ss = seasonsRef.current;
        const si = seasonIdxRef.current;
        if (ss.length === 0) return;
        if (e.key === 'ArrowLeft') { if (si > 0) setSeasonIdx(si - 1); }
        else if (e.key === 'ArrowRight') { if (si < ss.length - 1) setSeasonIdx(si + 1); }
        else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          const sea = ss[si]; if (sea) { setStep('episodes'); void loadEpisodesRef.current(sea.ratingKey); }
        }
        return;
      }
      if (s === 'episodes') {
        const eps = episodesRef.current;
        const ei = epIdxRef.current;
        if (eps.length === 0) return;
        if (e.key === 'ArrowUp') { if (ei === 0) setStep('seasons'); else setEpIdx(ei - 1); }
        else if (e.key === 'ArrowDown') { if (ei < eps.length - 1) setEpIdx(ei + 1); }
        else if (e.key === 'Enter' || e.key === ' ') {
          const ep = eps[ei];
          if (ep) {
            const sea = seasonsRef.current[seasonIdxRef.current];
            const ctx: SubtitleSearchContext = {
              title: ep.title,
              grandparentTitle: metaRef.current?.title || currentRef.current.title,
              season: sea?.index,
              episode: ep.index,
            };
            onPlayEpisodeRef.current(ep, ctx);
          }
        }
        return;
      }
      // actorGrid step
      const grid = actorItemsRef.current;
      const cur = actorCursorRef.current;
      const total = grid.length;
      if (total === 0) return;
      if (e.key === 'ArrowUp') { if (cur >= COLS) setActorCursor(cur - COLS); }
      else if (e.key === 'ArrowDown') { if (cur + COLS < total) setActorCursor(cur + COLS); }
      else if (e.key === 'ArrowLeft') { if (cur % COLS !== 0) setActorCursor(cur - 1); }
      else if (e.key === 'ArrowRight') { if ((cur % COLS) < COLS - 1 && cur + 1 < total) setActorCursor(cur + 1); }
      else if (e.key === 'Enter' || e.key === ' ') {
        const it = grid[cur];
        if (it) { pushItemRef.current(it); /* setStep to detail happens via item-change effect */ }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive]);

  const tech = techBadge(meta?.media);
  // Resolution: seed from item, replace with metadata when available.
  const resLabel = resolutionLabel(meta?.media?.videoResolution || current.videoResolution);

  // Play button appears immediately for episodes when meta confirms it.
  const showEpisodePlay = isEpisode && !detailButtons.some((b) => b.id === 'play');

  return (
    <div className="fixed inset-0 z-[55] text-white overflow-hidden">
      {/* Backdrop — skipped on NATIVE (heap-cost, decorative only); on web
          it's a small 640x360 image mounted after first paint. */}
      <div className="absolute inset-0 bg-black">
        {showBackdrop && backdropReady && (meta?.art || current.art) && (
          <PlexImage
            priority
            base={base}
            path={meta?.art || current.art}
            token={token}
            w={640}
            h={360}
            className="w-full h-full object-cover opacity-40 blur-[2px]"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/50" />
      </div>

      <div className="relative z-10 h-full overflow-y-auto p-8">
        {step === 'detail' && (
          <div className="max-w-6xl mx-auto flex gap-8">
            <div className="w-64 flex-shrink-0">
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden ring-1 ring-white/10 bg-black/40">
                <PlexImage base={base} path={meta?.thumb || current.thumb} token={token} w={400} h={600} className="w-full h-full object-cover" />
                {resLabel && (
                  <div className="absolute top-2 right-2"><ResBadge label={resLabel} /></div>
                )}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <h1 className="font-quicksand font-bold text-4xl truncate flex-1 min-w-0">{meta?.title || current.title}</h1>
                {resLabel && <ResBadge label={resLabel} className="shrink-0" />}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-brand-ice/80 font-nunito mb-3 min-h-[24px]">
                {(meta?.year ?? current.year) && <span>{meta?.year ?? current.year}</span>}
                {meta?.duration && <span>· {fmtRuntime(meta.duration)}</span>}
                {meta?.contentRating && <span className="px-1.5 py-0.5 rounded border border-white/25 text-[11px]">{meta.contentRating}</span>}
                {tech && <span className="px-1.5 py-0.5 rounded bg-white/10 text-[11px]">{tech}</span>}
                {metaLoading && !meta && <span className="h-4 w-32 rounded bg-white/10 animate-pulse" />}
              </div>
              <div className="flex flex-wrap items-center gap-4 mb-3 min-h-[26px]">
                {typeof meta?.audienceRating === 'number' && (
                  <div className="flex items-baseline gap-1">
                    <span className="text-brand-gold text-lg">★</span>
                    <span className="font-quicksand font-bold text-lg">{meta.audienceRating.toFixed(1)}</span>
                    <span className="text-xs text-brand-ice/60">/10 Rating</span>
                  </div>
                )}
                {typeof meta?.rating === 'number' && (
                  <div className="text-sm text-brand-ice/70 font-nunito">Critics <span className="font-bold text-white">{meta.rating.toFixed(1)}</span></div>
                )}
                {metaLoading && !meta && <span className="h-5 w-20 rounded bg-white/10 animate-pulse" />}
              </div>
              {(meta?.genres.length ?? 0) > 0 && <p className="text-sm text-brand-ice/80 font-nunito mb-3">{meta!.genres.join(' · ')}</p>}
              {(meta?.summary || current.summary) && (
                <p className="text-brand-ice/90 font-nunito text-sm leading-relaxed mb-4 max-w-3xl">{meta?.summary || current.summary}</p>
              )}
              {(meta?.directors.length ?? 0) > 0 && (
                <p className="text-xs text-brand-ice/70 font-nunito mb-4"><span className="text-brand-ice/50">Director:</span> {meta!.directors.join(', ')}</p>
              )}
              <div className="flex flex-wrap gap-3">
                {detailButtons.map((b, i) => {
                  const focused = isActive && zone === 'buttons' && btn === i;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      data-focused={focused ? 'true' : 'false'}
                      onClick={() => { setZone('buttons'); setBtn(i); activateDetail(b.id); }}
                      className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-quicksand font-semibold transition-transform duration-150 ${focused ? 'bg-brand-gold text-brand-navy scale-105 shadow-[0_0_18px_rgba(245,200,80,0.55)]' : 'bg-white/10 text-white ring-1 ring-white/15'}`}>
                      {b.id === 'play' && <Play className="w-4 h-4 fill-current" />}
                      {b.id === 'resume' && <RotateCw className="w-4 h-4" />}
                      {b.id === 'browse' && <List className="w-4 h-4" />}
                      {b.label}
                    </button>
                  );
                })}
                {showEpisodePlay && (
                  <button
                    type="button"
                    data-focused={isActive && zone === 'buttons' && btn === detailButtons.length ? 'true' : 'false'}
                    onClick={() => playCurrent(undefined)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-quicksand font-semibold bg-brand-gold text-brand-navy shadow-[0_0_18px_rgba(245,200,80,0.55)]">
                    <Play className="w-4 h-4 fill-current" /> Play
                  </button>
                )}
                {metaLoading && detailButtons.length === 0 && (
                  <div className="h-11 w-32 rounded-xl bg-white/10 animate-pulse" />
                )}
              </div>

              {/* Cast row — horizontal, D-pad scrollable, focus zone 'cast'. */}
              <div className="mt-8">
                <div className="text-xs uppercase tracking-wide text-brand-ice/50 mb-2">Cast</div>
                {metaLoading || !castReady ? (
                  <div className="flex gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="w-[110px] flex-shrink-0">
                        <div className="w-[110px] h-[110px] rounded-full bg-white/10 animate-pulse" />
                        <div className="h-3 w-20 rounded bg-white/10 animate-pulse mx-auto mt-2" />
                      </div>
                    ))}
                  </div>
                ) : cast.length === 0 ? (
                  <div className="text-xs text-brand-ice/50 font-nunito">No cast info.</div>
                ) : (
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {cast.map((p, i) => {
                      const focused = isActive && zone === 'cast' && castIdx === i;
                      return (
                        <div
                          key={`${p.id ?? p.tag}-${i}`}
                          ref={(el) => { if (focused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
                          onClick={() => { setZone('cast'); setCastIdx(i); void openActor(p); }}
                          className={`relative flex-shrink-0 w-[120px] rounded-xl transition-transform duration-150 cursor-pointer ${focused ? 'scale-110 z-10' : ''}`}>
                          <div className={`w-[110px] h-[110px] mx-auto rounded-full overflow-hidden ring-1 ring-white/10 bg-black/40 ${focused ? 'ring-2 ring-brand-gold shadow-[0_0_16px_rgba(245,200,80,0.5)]' : ''}`}>
                            <PlexImage priority base={base} path={p.thumb} token={token} w={120} h={120} className="w-full h-full object-cover" />
                          </div>
                          <div className={`mt-1 text-center text-[11px] font-nunito truncate ${focused ? 'text-brand-gold' : 'text-white/85'}`}>{p.tag}</div>
                          {p.role && <div className="text-center text-[10px] font-nunito text-brand-ice/60 truncate">{p.role}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 'seasons' && (
          <div className="max-w-6xl mx-auto">
            <h2 className="font-quicksand font-bold text-2xl mb-4">{meta?.title || current.title} · Seasons</h2>
            {seasonsLoading ? (
              <div className="text-brand-ice/60 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : seasons.length === 0 ? (
              <div className="text-brand-ice/60">No seasons.</div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-3">
                {seasons.map((s, i) => {
                  const focused = isActive && seasonIdx === i;
                  return (
                    <div key={s.ratingKey}
                      ref={(el) => { if (focused && el) el.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }}
                      className={`flex-shrink-0 w-[140px] rounded-lg overflow-hidden transition-transform duration-150 ${focused ? 'ring-2 ring-brand-gold scale-105 shadow-[0_0_16px_rgba(245,200,80,0.4)]' : 'ring-1 ring-white/10'}`}>
                      <div className="aspect-[2/3]"><PlexImage priority base={base} path={s.thumb} token={token} w={180} h={270} className="w-full h-full object-cover" /></div>
                      <div className="px-1.5 py-1 text-[11px] font-nunito text-white/90 truncate">{s.title}</div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-brand-ice/50 mt-3">◀ ▶ pick a season · OK to open · Back to detail</p>
          </div>
        )}

        {step === 'episodes' && (
          <div className="max-w-4xl mx-auto">
            <h2 className="font-quicksand font-bold text-2xl mb-4">
              {(meta?.title || current.title)}{seasons[seasonIdx] ? ` · ${seasons[seasonIdx].title}` : ''}
            </h2>
            {episodesLoading ? (
              <div className="text-brand-ice/60 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : episodes.length === 0 ? (
              <div className="text-brand-ice/60">No episodes.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {episodes.map((ep, i) => {
                  const focused = isActive && epIdx === i;
                  return (
                    <div key={ep.ratingKey}
                      ref={(el) => { if (focused && el) el.scrollIntoView({ block: 'nearest' }); }}
                      className={`flex items-center gap-3 p-2 rounded-lg transition-transform duration-150 ${focused ? 'bg-brand-gold/20 ring-2 ring-brand-gold scale-[1.01]' : 'bg-black/40 ring-1 ring-white/10'}`}>
                      <div className="w-40 aspect-video flex-shrink-0 rounded overflow-hidden bg-black/60">
                        <PlexImage priority base={base} path={ep.thumb} token={token} w={320} h={180} className="w-full h-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-quicksand font-semibold truncate">
                          {ep.index != null ? `${ep.index}. ` : ''}{ep.title}
                        </div>
                        <div className="text-xs text-brand-ice/60 font-nunito">{fmtRuntime(ep.duration)}</div>
                        {ep.summary && <div className="text-xs text-brand-ice/70 font-nunito line-clamp-2 mt-1">{ep.summary}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-brand-ice/50 mt-3">▲ ▼ pick · OK to play · Back to seasons</p>
          </div>
        )}

        {step === 'actorGrid' && (
          <div className="max-w-6xl mx-auto">
            <h2 className="font-quicksand font-bold text-2xl mb-4">{actorName} · Titles</h2>
            {actorLoading ? (
              <div className="text-brand-ice/60 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : actorItems.length === 0 ? (
              <div className="text-brand-ice/60 font-nunito text-sm">No other titles on this server.</div>
            ) : (
              <div className="grid grid-cols-6 gap-3">
                {actorItems.map((it, idx) => {
                  const focused = isActive && actorCursor === idx;
                  const label = resolutionLabel(it.videoResolution);
                  return (
                    <div
                      key={it.ratingKey}
                      ref={(el) => { if (focused && el) el.scrollIntoView({ block: 'nearest' }); }}
                      onClick={() => { setActorCursor(idx); pushItem(it); }}
                      className={`relative cursor-pointer rounded-lg overflow-hidden transition-transform duration-150 ${focused ? 'z-10 ring-2 ring-brand-gold scale-105 shadow-[0_0_16px_rgba(245,200,80,0.4)]' : 'ring-1 ring-white/10'}`}>
                      <div className="relative aspect-[2/3]">
                        <PlexImage priority base={base} path={it.thumb} token={token} w={180} h={270} className="w-full h-full object-cover" />
                        {label && <div className="absolute top-1 right-1"><ResBadge label={label} /></div>}
                      </div>
                      <div className={`px-1.5 py-1 text-[11px] font-nunito truncate ${focused ? 'text-brand-gold' : 'text-white/90'}`}>{it.title}</div>
                      {focused && <div className="absolute inset-0 border-[3px] border-brand-gold rounded-lg pointer-events-none" />}
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-brand-ice/50 mt-3">◀ ▶ ▲ ▼ browse · OK to open · Back to cast</p>
          </div>
        )}
      </div>
    </div>
  );
});

PlexDetail.displayName = 'PlexDetail';
export default PlexDetail;
