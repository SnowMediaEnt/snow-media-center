// Plex detail page — poster, metadata, ratings, cast + Play/Resume/Back.
// For SHOWS: replaces Play with Browse Episodes (seasons → episodes lists).
// Fire-TV D-pad only. All Plex HTTP via plex.ts.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, RotateCw, ArrowLeft, List } from 'lucide-react';
import { getPlexMetadata, getPlexSeasons, getPlexEpisodes,
  type PlexMetadata, type PlexSeason, type PlexEpisode, type PlexItem } from '@/lib/plex';
import PlexImage from './PlexImage';
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


type Step = 'detail' | 'seasons' | 'episodes';

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
  if (meta.videoResolution) parts.push(/^\d+$/.test(meta.videoResolution) ? `${meta.videoResolution}p` : meta.videoResolution.toUpperCase());
  if (meta.videoCodec) parts.push(meta.videoCodec.toUpperCase());
  if (meta.audioChannels) {
    const ch = meta.audioChannels;
    parts.push(ch === 6 ? '5.1' : ch === 8 ? '7.1' : `${ch}ch`);
  } else if (meta.audioCodec) parts.push(meta.audioCodec.toUpperCase());
  return parts.join(' · ');
};

const PlexDetail = memo(({ isActive, base, token, item, onPlay, onPlayEpisode, onBack }: Props) => {
  const [meta, setMeta] = useState<PlexMetadata | null>(null);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>('detail');
  // detail buttons: 0=Play/Browse, 1=Resume (movies only), 2=Back
  const [btn, setBtn] = useState(0);

  const [seasons, setSeasons] = useState<PlexSeason[]>([]);
  const [seasonsLoading, setSeasonsLoading] = useState(false);
  const [seasonIdx, setSeasonIdx] = useState(0);

  const [episodes, setEpisodes] = useState<PlexEpisode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [epIdx, setEpIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPlexMetadata(base, token, item.ratingKey)
      .then((m) => { if (!cancelled) setMeta(m); })
      .catch(() => { if (!cancelled) setMeta(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [base, token, item.ratingKey]);

  const isShow = (meta?.type ?? item.type) === 'show';
  const viewOffset = meta?.viewOffset ?? 0;
  const canResume = !isShow && viewOffset > 0 && (!meta?.duration || viewOffset < meta.duration - 30000);
  const resumeSec = Math.floor(viewOffset / 1000);
  const detailButtons: Array<{ id: string; label: string; sub?: string }> = useMemo(() => {
    const b: Array<{ id: string; label: string; sub?: string }> = [];
    if (isShow) b.push({ id: 'browse', label: 'Browse Episodes' });
    else b.push({ id: 'play', label: 'Play' });
    if (canResume) {
      const h = Math.floor(resumeSec / 3600);
      const m = Math.floor((resumeSec % 3600) / 60);
      b.push({ id: 'resume', label: `Resume ${h > 0 ? `${h}:${String(m).padStart(2, '0')}` : `${m}m`}` });
    }
    b.push({ id: 'back', label: 'Back' });
    return b;
  }, [isShow, canResume, resumeSec]);

  useEffect(() => { if (btn >= detailButtons.length) setBtn(0); }, [detailButtons.length, btn]);

  const loadSeasons = useCallback(async () => {
    setSeasonsLoading(true);
    try {
      const s = await getPlexSeasons(base, token, item.ratingKey);
      setSeasons(s);
      setSeasonIdx(0);
    } finally { setSeasonsLoading(false); }
  }, [base, token, item.ratingKey]);

  const loadEpisodes = useCallback(async (seasonKey: string) => {
    setEpisodesLoading(true);
    try {
      const e = await getPlexEpisodes(base, token, seasonKey);
      setEpisodes(e);
      setEpIdx(0);
    } finally { setEpisodesLoading(false); }
  }, [base, token]);

  const movieCtx: SubtitleSearchContext = { title: meta?.title || item.title, year: meta?.year };
  const activateDetail = useCallback((id: string) => {
    if (id === 'play') onPlay(item, undefined, movieCtx);
    else if (id === 'resume') onPlay(item, resumeSec, movieCtx);
    else if (id === 'back') onBack();
    else if (id === 'browse') { setStep('seasons'); void loadSeasons(); }
  }, [item, onPlay, onBack, resumeSec, loadSeasons, movieCtx]);


  // Refs for the key handler
  const stepRef = useRef(step); useEffect(() => { stepRef.current = step; }, [step]);
  const btnRef = useRef(btn); useEffect(() => { btnRef.current = btn; }, [btn]);
  const btnsRef = useRef(detailButtons); useEffect(() => { btnsRef.current = detailButtons; }, [detailButtons]);
  const seasonsRef = useRef(seasons); useEffect(() => { seasonsRef.current = seasons; }, [seasons]);
  const seasonIdxRef = useRef(seasonIdx); useEffect(() => { seasonIdxRef.current = seasonIdx; }, [seasonIdx]);
  const episodesRef = useRef(episodes); useEffect(() => { episodesRef.current = episodes; }, [episodes]);
  const epIdxRef = useRef(epIdx); useEffect(() => { epIdxRef.current = epIdx; }, [epIdx]);
  const activateRef = useRef(activateDetail); useEffect(() => { activateRef.current = activateDetail; }, [activateDetail]);
  const loadEpisodesRef = useRef(loadEpisodes); useEffect(() => { loadEpisodesRef.current = loadEpisodes; }, [loadEpisodes]);
  const onPlayEpisodeRef = useRef(onPlayEpisode); useEffect(() => { onPlayEpisodeRef.current = onPlayEpisode; }, [onPlayEpisode]);
  const onBackRef = useRef(onBack); useEffect(() => { onBackRef.current = onBack; }, [onBack]);
  const metaRef = useRef(meta); useEffect(() => { metaRef.current = meta; }, [meta]);
  const itemRef = useRef(item); useEffect(() => { itemRef.current = item; }, [item]);


  useEffect(() => {
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
        if (s === 'episodes') setStep('seasons');
        else if (s === 'seasons') setStep('detail');
        else onBackRef.current();
        return;
      }
      if (s === 'detail') {
        const bs = btnsRef.current;
        const b = btnRef.current;
        if (e.key === 'ArrowLeft') { if (b > 0) setBtn(b - 1); }
        else if (e.key === 'ArrowRight') { if (b < bs.length - 1) setBtn(b + 1); }
        else if (e.key === 'Enter' || e.key === ' ') { const btnDef = bs[b]; if (btnDef) activateRef.current(btnDef.id); }
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
      // episodes
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
            grandparentTitle: metaRef.current?.title || itemRef.current.title,
            season: sea?.index,
            episode: ep.index,
          };

          onPlayEpisodeRef.current(ep, ctx);
        }
      }

    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [isActive]);

  if (loading || !meta) {
    return (
      <div className="fixed inset-0 z-[55] bg-black/85 flex items-center justify-center text-white">
        <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
      </div>
    );
  }

  const tech = techBadge(meta.media);

  return (
    <div className="fixed inset-0 z-[55] text-white overflow-hidden">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black">
        {meta.art && <PlexImage base={base} path={meta.art} token={token} w={1280} h={720} className="w-full h-full object-cover opacity-40 blur-[2px]" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/50" />
      </div>

      <div className="relative z-10 h-full overflow-y-auto p-8">
        {step === 'detail' && (
          <div className="max-w-6xl mx-auto flex gap-8">
            <div className="w-64 flex-shrink-0">
              <div className="aspect-[2/3] rounded-xl overflow-hidden ring-1 ring-white/10 bg-black/40">
                <PlexImage base={base} path={meta.thumb} token={token} w={400} h={600} className="w-full h-full object-cover" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-quicksand font-bold text-4xl mb-2 truncate">{meta.title}</h1>
              <div className="flex flex-wrap items-center gap-2 text-sm text-brand-ice/80 font-nunito mb-3">
                {meta.year && <span>{meta.year}</span>}
                {meta.duration && <span>· {fmtRuntime(meta.duration)}</span>}
                {meta.contentRating && <span className="px-1.5 py-0.5 rounded border border-white/25 text-[11px]">{meta.contentRating}</span>}
                {tech && <span className="px-1.5 py-0.5 rounded bg-white/10 text-[11px]">{tech}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-4 mb-3">
                {typeof meta.audienceRating === 'number' && (
                  <div className="flex items-baseline gap-1">
                    <span className="text-brand-gold text-lg">★</span>
                    <span className="font-quicksand font-bold text-lg">{meta.audienceRating.toFixed(1)}</span>
                    <span className="text-xs text-brand-ice/60">/10 Rating</span>
                  </div>
                )}
                {typeof meta.rating === 'number' && (
                  <div className="text-sm text-brand-ice/70 font-nunito">Critics <span className="font-bold text-white">{meta.rating.toFixed(1)}</span></div>
                )}
              </div>
              {meta.genres.length > 0 && <p className="text-sm text-brand-ice/80 font-nunito mb-3">{meta.genres.join(' · ')}</p>}
              {meta.summary && <p className="text-brand-ice/90 font-nunito text-sm leading-relaxed mb-4 max-w-3xl">{meta.summary}</p>}
              {meta.cast.length > 0 && (
                <p className="text-xs text-brand-ice/70 font-nunito mb-1"><span className="text-brand-ice/50">Cast:</span> {meta.cast.map((c) => c.tag).join(', ')}</p>
              )}
              {meta.directors.length > 0 && (
                <p className="text-xs text-brand-ice/70 font-nunito mb-4"><span className="text-brand-ice/50">Director:</span> {meta.directors.join(', ')}</p>
              )}
              <div className="flex flex-wrap gap-3">
                {detailButtons.map((b, i) => {
                  const focused = isActive && btn === i;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      data-focused={focused ? 'true' : 'false'}
                      onClick={() => activateDetail(b.id)}
                      className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-quicksand font-semibold transition-transform duration-150 ${focused ? 'bg-brand-gold text-brand-navy scale-105 shadow-[0_0_18px_rgba(245,200,80,0.55)]' : 'bg-white/10 text-white ring-1 ring-white/15'}`}>
                      {b.id === 'play' && <Play className="w-4 h-4 fill-current" />}
                      {b.id === 'resume' && <RotateCw className="w-4 h-4" />}
                      {b.id === 'browse' && <List className="w-4 h-4" />}
                      {b.id === 'back' && <ArrowLeft className="w-4 h-4" />}
                      {b.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {step === 'seasons' && (
          <div className="max-w-6xl mx-auto">
            <h2 className="font-quicksand font-bold text-2xl mb-4">{meta.title} · Seasons</h2>
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
                      <div className="aspect-[2/3]"><PlexImage base={base} path={s.thumb} token={token} w={240} h={360} className="w-full h-full object-cover" /></div>
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
              {meta.title}{seasons[seasonIdx] ? ` · ${seasons[seasonIdx].title}` : ''}
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
                        <PlexImage base={base} path={ep.thumb} token={token} w={320} h={180} className="w-full h-full object-cover" />
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
      </div>
    </div>
  );
});

PlexDetail.displayName = 'PlexDetail';
export default PlexDetail;
