// Backups section — admin-published fallback streams from public.backup_streams.
// Deliberately does NOT take Xtream creds: backups are not Xtream content.
// RLS already filters to active rows inside their start/end window; the hook
// only filters server/tenant targeting.
import { memo, useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Loader2, RefreshCw, LifeBuoy, Radio, Film } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useBackupStreams, type BackupStream } from '@/hooks/useBackupStreams';
import { hasNativePlayer } from '@/capacitor/SnowPlayer';
import { useNativePlayer } from '@/hooks/useNativePlayer';
import { loadVolume, saveVolume } from '@/lib/xtream';
import { trackEvent } from '@/lib/analytics';
import { isDemo } from '@/lib/demoMode';

const VideoPlayer = lazy(() => import('./VideoPlayer'));

// Demo latch (?demo=1) — backups work normally in demo (public table, no
// creds needed) but analytics are suppressed like everywhere else.
const DEMO = isDemo();
// Native ExoPlayer path — the WebView <video> element cannot play MKV and
// handles multichannel audio badly on Fire TV.
const NATIVE_PLAYBACK = hasNativePlayer();

type RowId = 'refresh' | 'live' | 'vod';
interface Focus { row: RowId; col: number }

interface Props {
  isActive: boolean;
  onExitLeft: () => void;
  onExitUp?: () => void;
  serverLabel?: string | null;
}

const BackupsSection = memo(({ isActive, onExitLeft, onExitUp, serverLabel }: Props) => {
  const { toast } = useToast();
  const { live, vod, loading, refresh } = useBackupStreams(serverLabel ?? null);

  const [focus, setFocus] = useState<Focus>({ row: 'refresh', col: 0 });
  const [playing, setPlaying] = useState<BackupStream | null>(null);
  const [volume, setVolume] = useState<number>(() => loadVolume());
  const [isPaused, setIsPaused] = useState(false);
  const [, setTracksTick] = useState(0);
  useEffect(() => { saveVolume(volume); }, [volume]);

  const rootRef = useRef<HTMLDivElement | null>(null);

  // ── Refs mirror state so the capture-phase key handler stays stable and
  // never closes over stale values (LiveSection pattern). ──────────────────
  const focusRef = useRef(focus);
  const playingRef = useRef(playing);
  const liveRef = useRef(live);
  const vodRef = useRef(vod);
  const rowsRef = useRef<RowId[]>(['refresh']);
  const onExitLeftRef = useRef(onExitLeft);
  const onExitUpRef = useRef(onExitUp);
  const serverLabelRef = useRef(serverLabel);
  const refreshRef = useRef(refresh);
  const toastRef = useRef(toast);
  useEffect(() => { focusRef.current = focus; }, [focus]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { liveRef.current = live; }, [live]);
  useEffect(() => { vodRef.current = vod; }, [vod]);
  useEffect(() => { onExitLeftRef.current = onExitLeft; }, [onExitLeft]);
  useEffect(() => { onExitUpRef.current = onExitUp; }, [onExitUp]);
  useEffect(() => { serverLabelRef.current = serverLabel; }, [serverLabel]);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => { toastRef.current = toast; }, [toast]);
  useEffect(() => {
    rowsRef.current = ['refresh', ...(live.length ? ['live' as const] : []), ...(vod.length ? ['vod' as const] : [])];
  }, [live.length, vod.length]);

  const rowLen = (id: RowId): number =>
    id === 'refresh' ? 1 : id === 'live' ? liveRef.current.length : vodRef.current.length;

  // ── Native playback ──────────────────────────────────────────────────────
  const nativeActive = NATIVE_PLAYBACK && !!playing;
  const native = useNativePlayer({
    active: nativeActive,
    url: nativeActive && playing ? playing.url : null,
    volume,
    // CRITICAL: false for movies, or STATE_ENDED triggers infinite reconnect.
    live: playing?.kind === 'live',
    onPlayStateChange: (p) => setIsPaused(p),
    onTracksChanged: () => setTracksTick((t) => t + 1),
  });
  useEffect(() => {
    if (!nativeActive) return;
    document.documentElement.classList.add('snowplayer-fullscreen');
    return () => { document.documentElement.classList.remove('snowplayer-fullscreen'); };
  }, [nativeActive]);

  const playItem = useCallback((item: BackupStream) => {
    setIsPaused(false);
    setPlaying(item);
    if (!DEMO) {
      try { trackEvent('backup_play', 'player', { kind: item.kind, title: item.title, server: serverLabelRef.current ?? null }); } catch { /* ignore */ }
    }
  }, []);

  const doRefresh = useCallback(() => {
    refreshRef.current();
    if (!DEMO) { try { trackEvent('backup_refresh', 'player', {}); } catch { /* ignore */ } }
    toastRef.current({ title: 'Updated', description: 'Backup list refreshed.' });
  }, []);

  // Clamp focus when shelves appear/disappear (rows can shrink on refresh).
  useEffect(() => {
    const rows = rowsRef.current;
    const f = focusRef.current;
    if (!rows.includes(f.row)) setFocus({ row: 'refresh', col: 0 });
    else if (f.col > rowLen(f.row) - 1) setFocus({ row: f.row, col: Math.max(0, rowLen(f.row) - 1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.length, vod.length]);

  // Keep the focused card visible (block:'nearest' — never 'center').
  useEffect(() => {
    if (!isActive) return;
    const el = rootRef.current?.querySelector(`[data-focus-key="${focus.row}:${focus.col}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focus, isActive]);

  // Mirror native error/retry into refs for the stable key handler below.
  const nativeErrorRef = useRef(native.error);
  const nativeRetryRef = useRef(native.retry);
  useEffect(() => { nativeErrorRef.current = native.error; }, [native.error]);
  useEffect(() => { nativeRetryRef.current = native.retry; }, [native.retry]);

  // ── D-pad: capture-phase window listener gated on isActive. Uses refs so
  // the handler identity is stable. NO stopImmediatePropagation on arrows —
  // that caused the Plex detail freeze and starves overlays mounted above. ──
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (typing) return;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;

      // ── Player owns the screen while a stream is up ──
      if (playingRef.current) {
        if (isBack) {
          e.preventDefault(); e.stopPropagation();
          (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
          setPlaying(null);
          return;
        }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); setVolume((v) => Math.max(0, +(v - 0.05).toFixed(2))); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setVolume((v) => Math.min(1, +(v + 0.05).toFixed(2))); return; }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation();
          const err = nativeErrorRef.current;
          if (err) nativeRetryRef.current();
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); }
        return;
      }

      // ── Back exits the section (hardware-back guard stamped first) ──
      if (isBack) {
        e.preventDefault(); e.stopPropagation();
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
        onExitLeftRef.current();
        return;
      }

      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '];
      if (!keys.includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      // Blur lingering DOM focus so WebView spatial navigation can't also move.
      const ae = document.activeElement as HTMLElement | null;
      if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur();

      const rows = rowsRef.current;
      const f = focusRef.current;
      const ri = Math.max(0, rows.indexOf(f.row));

      if (e.key === 'ArrowUp') {
        if (ri === 0) { onExitUpRef.current?.(); return; }
        const nr = rows[ri - 1];
        setFocus({ row: nr, col: Math.min(f.col, rowLen(nr) - 1) });
      } else if (e.key === 'ArrowDown') {
        if (ri >= rows.length - 1) return;
        const nr = rows[ri + 1];
        setFocus({ row: nr, col: Math.min(f.col, rowLen(nr) - 1) });
      } else if (e.key === 'ArrowLeft') {
        if (f.col === 0) { onExitLeftRef.current(); return; }
        setFocus({ row: f.row, col: f.col - 1 });
      } else if (e.key === 'ArrowRight') {
        setFocus({ row: f.row, col: Math.min(rowLen(f.row) - 1, f.col + 1) });
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (f.row === 'refresh') { doRefresh(); return; }
        const list = f.row === 'live' ? liveRef.current : vodRef.current;
        const item = list[f.col];
        if (item) playItem(item);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, doRefresh, playItem]);

  const nativeErrorRef = useRef(native.error);
  const nativeRetryRef = useRef(native.retry);
  useEffect(() => { nativeErrorRef.current = native.error; }, [native.error]);
  useEffect(() => { nativeRetryRef.current = native.retry; }, [native.retry]);

  // ── Fullscreen player ────────────────────────────────────────────────────
  if (playing) {
    return (
      <div className={`fixed inset-0 z-[60] text-white ${nativeActive ? 'bg-transparent' : 'bg-black'}`}>
        {!nativeActive && (
          <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-12 h-12 animate-spin text-brand-gold" /></div>}>
            <VideoPlayer
              src={playing.url}
              volume={volume}
              className="w-full h-full"
              onError={(msg) => {
                if (!DEMO) {
                  try { trackEvent('player_error', 'player', { kind: 'backup', channel_or_title: playing.title, server: serverLabel ?? null, message: msg.slice(0, 200) }); } catch { /* ignore */ }
                }
                toast({ title: 'Playback failed', description: 'This backup stream could not be played.' });
              }}
            />
          </Suspense>
        )}
        {nativeActive && native.buffering && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 className="w-12 h-12 animate-spin text-brand-gold" />
          </div>
        )}
        {nativeActive && native.error && (
          <div className="absolute inset-x-0 bottom-10 flex justify-center pointer-events-none">
            <div className="px-4 py-2 rounded-lg bg-black/70 border border-red-400/40 text-sm font-nunito">
              Stream error — OK to retry, Back to stop.
            </div>
          </div>
        )}
        <div className="absolute top-4 left-4 font-quicksand font-bold text-lg drop-shadow-lg">
          {playing.title}
        </div>
        {isPaused && (
          <div className="absolute top-4 right-4 px-3 py-1 rounded-lg bg-black/60 text-sm font-nunito">Paused</div>
        )}
      </div>
    );
  }

  const shelfFocused = (row: RowId, col: number) => isActive && focus.row === row && focus.col === col;
  const cardCls = (focused: boolean) =>
    `tv-focusable home-focus-surface cursor-pointer rounded-xl border transition-transform duration-150 flex-shrink-0 ${
      focused ? 'bg-brand-gold/20 border-brand-gold ring-2 ring-brand-gold scale-105 shadow-[0_0_24px_rgba(245,200,80,0.25)]' : 'bg-slate-900/70 border-white/10'
    }`;

  return (
    <div ref={rootRef} className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 px-6 pt-4 pb-2 flex-shrink-0">
        <div className="min-w-0">
          <h2 className="text-xl font-quicksand font-bold flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-brand-gold" /> Backups
          </h2>
          <p className="text-brand-ice/60 font-nunito text-sm mt-1">
            Streams posted by Snow Media. Press Refresh if something was just added.
          </p>
        </div>
        <button
          type="button"
          data-focus-key="refresh:0"
          data-focused={shelfFocused('refresh', 0) ? 'true' : 'false'}
          onClick={doRefresh}
          className={`tv-focusable home-focus-surface flex items-center gap-2 px-4 py-2 rounded-lg border font-nunito font-semibold transition-transform duration-150 flex-shrink-0 ${
            shelfFocused('refresh', 0)
              ? 'bg-brand-gold/20 border-brand-gold ring-2 ring-brand-gold scale-105'
              : 'bg-slate-900/70 border-white/10'
          }`}
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Shelves */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 space-y-6">
        {loading && live.length === 0 && vod.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-brand-gold" />
          </div>
        )}

        {live.length > 0 && (
          <section>
            <h3 className="text-lg font-quicksand font-bold mb-2 flex items-center gap-2">
              <Radio className="w-4 h-4 text-brand-gold" /> Live
            </h3>
            <div className="flex gap-4 overflow-x-auto pb-2 pt-1 pl-1 -ml-1">
              {live.map((s, i) => (
                <div
                  key={s.id}
                  data-focus-key={`live:${i}`}
                  data-focused={shelfFocused('live', i) ? 'true' : 'false'}
                  onClick={() => playItem(s)}
                  className={`${cardCls(shelfFocused('live', i))} w-64 p-4`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold font-nunito bg-red-600/80">LIVE</span>
                    {s.server_label && (
                      <span className="text-[10px] text-brand-ice/50 font-nunito truncate">{s.server_label}</span>
                    )}
                  </div>
                  <div className="font-quicksand font-bold truncate">{s.title}</div>
                  {s.subtitle && <div className="text-brand-ice/60 font-nunito text-sm truncate mt-1">{s.subtitle}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {vod.length > 0 && (
          <section>
            <h3 className="text-lg font-quicksand font-bold mb-2 flex items-center gap-2">
              <Film className="w-4 h-4 text-brand-gold" /> Movies &amp; Shows
            </h3>
            <div className="flex gap-4 overflow-x-auto pb-2 pt-1 pl-1 -ml-1">
              {vod.map((s, i) => (
                <div
                  key={s.id}
                  data-focus-key={`vod:${i}`}
                  data-focused={shelfFocused('vod', i) ? 'true' : 'false'}
                  onClick={() => playItem(s)}
                  className={`${cardCls(shelfFocused('vod', i))} w-40 overflow-hidden`}
                >
                  {s.poster_url ? (
                    <div className="w-full aspect-[2/3] bg-black/40">
                      <img src={s.poster_url} alt={s.title} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-full aspect-[2/3] bg-black/40 flex items-center justify-center p-3 text-center">
                      <span className="font-quicksand font-bold text-sm line-clamp-3">{s.title}</span>
                    </div>
                  )}
                  <div className="p-2">
                    <div className="font-quicksand font-semibold text-sm truncate">{s.title}</div>
                    {s.subtitle && <div className="text-brand-ice/60 font-nunito text-xs truncate">{s.subtitle}</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!loading && live.length === 0 && vod.length === 0 && (
          <div className="h-full flex items-center justify-center text-center px-8">
            <p className="text-brand-ice/60 font-nunito text-lg">
              No backups right now. When Snow Media posts one it shows up here automatically.
            </p>
          </div>
        )}
      </div>
    </div>
  );
});

BackupsSection.displayName = 'BackupsSection';
export default BackupsSection;
