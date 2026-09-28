// Live TV › Recordings (TRACKER 25): the recordings on the box and on a USB
// drive, newest first, with their size and length, and free space per drive.
// OK on one: Play (the native player, from the file), Rename, Delete (asks to
// confirm), or Stop while it is still recording.
//
// It takes over the Live TV section while open (LiveSection hands it the
// remote), and plays full screen on the native player like a channel does:
// the snowplayer-fullscreen class on <html> and a transparent background, so
// the picture shows through and nothing flashes white.
//
// A recording that ran past 3.9 GB on a USB drive carries on in a "(part 2)"
// file: each part is its own row (own id), and `recording` is shown as it is.
//
// One Back = one step: the playing recording → the list; the keyboard →
// the rename box; the rename box or a menu → the list; the list → Live TV.
// Rename follows the app's keyboard rule (useTVFocus, 1.6.x path): the field
// is only highlighted, OK asks for the keyboard (no autofocus), Enter saves.
// Chrome 66: margins, no flex gap beyond gap-1..4, no inset.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Circle, Film, HardDrive, Pencil, Play, Square, Trash2, Usb, X } from 'lucide-react';
import {
  SnowRecorder, RECORDINGS_CHANGED_EVENT, notifyRecordingsChanged, type RecordVolume, type RecordingItem,
} from '@/capacitor/SnowRecorder';
import { SnowPlayer } from '@/capacitor/SnowPlayer';
import { useNativePlayer } from '@/hooks/useNativePlayer';
import { cleanRename, formatDuration, isLowSpace, listWindow } from '@/lib/recording';
import { formatBytes } from '@/lib/liveRewind';
import { loadPlayerVolume } from '@/utils/volume';
import { focusTextInputForDpad, hideKeyboardForDpad } from '@/utils/dpadKeyboard';
import { toast } from '@/hooks/use-toast';

interface Props {
  onClose: () => void;
  /** This section has the remote. False: the screen stays as it is and takes no keys. */
  active?: boolean;
}

type Action = 'play' | 'rename' | 'delete' | 'stop' | 'cancel';
const ROWS_SHOWN = 5;

const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
const when = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const markBack = () => { (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now(); };
const isBackKey = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
const isOkKey = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 23;
const swallow = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

/** A recording full screen on the native player: OK pause, ◀ -10 s, ▶ +30 s, Back leaves. */
const RecordingPlayer = ({ item, onClose }: { item: RecordingItem; onClose: () => void }) => {
  // A file plays as a film would (live:false); ExoPlayer is the default engine.
  const native = useNativePlayer({ active: true, url: item.playUrl, live: false, volume: loadPlayerVolume(), onEnded: onClose });
  const [pos, setPos] = useState({ position: 0, duration: 0 });
  useEffect(() => {
    document.documentElement.classList.add('snowplayer-fullscreen');
    return () => { document.documentElement.classList.remove('snowplayer-fullscreen'); };
  }, []);
  useEffect(() => {
    const t = window.setInterval(() => { void native.getPosition().then((p) => setPos({ position: p.position, duration: p.duration })); }, 1000);
    return () => window.clearInterval(t);
  }, [native]);
  const nativeRef = useRef(native);
  nativeRef.current = native;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The remote's own media keys are the player's (useNativePlayer); these are the D-pad.
      if (e.key.startsWith('Media') || e.key.startsWith('Channel')) return;
      swallow(e);
      if (isBackKey(e)) { markBack(); onClose(); return; }
      if (e.repeat && isOkKey(e)) return;
      const n = nativeRef.current;
      if (isOkKey(e)) { n.controller?.togglePlay(); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        void n.getPosition().then((p) => {
          const to = p.position + (e.key === 'ArrowRight' ? 30 : -10);
          const max = p.duration > 0 ? p.duration - 1 : to;
          return n.seekTo(Math.max(0, Math.min(max, to)));
        });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const pct = pos.duration > 0 ? Math.min(100, (pos.position / pos.duration) * 100) : 0;
  return (
    <div data-recording-player className="fixed left-0 top-0 w-full h-full z-[60] text-white bg-transparent">
      {native.error && (
        <div className="absolute left-0 top-0 w-full h-full flex flex-col items-center justify-center bg-black/85 p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-brand-gold mb-3" />
          <p className="text-xl font-quicksand font-semibold mb-1">This recording can't be played</p>
          <p className="text-sm text-brand-ice/80 font-nunito">{native.error.message}</p>
        </div>
      )}
      <div className="absolute left-0 right-0 bottom-0 px-8 pt-8 pb-8 bg-gradient-to-t from-black/90 to-transparent">
        <p className="text-2xl font-quicksand font-bold truncate">
          <Film className="inline w-6 h-6 mr-2 -mt-1 text-brand-gold" />{item.name}
        </p>
        <div className="mt-2 flex items-center">
          <span className="text-base font-nunito tabular-nums mr-3">{formatDuration(pos.position)}</span>
          <div className="flex-1 h-2.5 bg-white/15 rounded-full overflow-hidden">
            <div className="h-full bg-brand-gold" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-base font-nunito tabular-nums ml-3">{pos.duration > 0 ? formatDuration(pos.duration) : '--:--'}</span>
        </div>
        <p className="mt-2 text-sm font-nunito text-brand-ice/70">
          OK {native.paused ? 'play' : 'pause'} · ◀ back 10 s · ▶ forward 30 s · Back to Recordings
          {item.recording ? ' · still recording: plays up to where it was when opened' : ''}
        </p>
      </div>
    </div>
  );
};

type RenameRow = 'field' | 'save' | 'cancel';
const RENAME_ROWS: RenameRow[] = ['field', 'save', 'cancel'];
/** After the keyboard is put away, its parting Enter is not a press (Amazon's keyboard). */
const DISMISS_GRACE_MS = 700;
/** After the keyboard is asked for, an Enter this soon is the echo of that OK, not "done". */
const OPEN_ECHO_MS = 800;

/**
 * Rename box. The field is highlighted, not focused: OK asks for the keyboard
 * (focusTextInputForDpad → Keyboard.show), the keyboard's Enter saves, ▲▼ or
 * Back put the keyboard away. Back with no keyboard up cancels.
 */
const RenameDialog = ({ item, onSave, onCancel }: { item: RecordingItem; onSave: (item: RecordingItem, text: string) => void; onCancel: () => void }) => {
  const [text, setText] = useState(item.name);
  const [row, setRow] = useState<RenameRow>('field');
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Whether we asked for the keyboard and think it is up (Back, ▲▼ and Enter clear it).
  const typingRef = useRef(false);
  const openedAtRef = useRef(0);
  const dismissedAtRef = useRef(0);
  // The OK that chose Rename is still down: it must not press anything here.
  const armedRef = useRef(false);
  const stateRef = useRef({ text, row });
  stateRef.current = { text, row };

  const putAway = useCallback(() => {
    typingRef.current = false;
    dismissedAtRef.current = Date.now();
    void hideKeyboardForDpad(inputRef.current);
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
        const handle = await Keyboard.addListener('keyboardDidHide', () => { typingRef.current = false; });
        if (cancelled) { void handle.remove(); return; }
        stop = () => { void handle.remove(); };
      } catch { /* no keyboard plugin here (web, tests) */ }
    })();
    return () => { cancelled = true; stop?.(); };
  }, []);

  useEffect(() => {
    const onKeyUp = () => { armedRef.current = true; };
    const onKey = (e: KeyboardEvent) => {
      const now = Date.now();
      if (typingRef.current) {
        // The keyboard is up: letters go to the field; a few keys are ours.
        if (isBackKey(e) && e.key !== 'Backspace') { swallow(e); markBack(); putAway(); return; }
        if (e.key === 'Backspace') { e.stopPropagation(); return; } // deletes a letter
        if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
          swallow(e);
          if (now - openedAtRef.current < OPEN_ECHO_MS) return;
          putAway();
          onSave(item, stateRef.current.text);
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          swallow(e);
          putAway();
          if (e.key === 'ArrowDown') setRow('save');
          return;
        }
        e.stopPropagation();
        return;
      }
      swallow(e);
      if (isBackKey(e)) { markBack(); onCancel(); return; }
      if (isOkKey(e)) {
        if (e.repeat || !armedRef.current || now - dismissedAtRef.current < DISMISS_GRACE_MS) return;
        const r = stateRef.current.row;
        if (r === 'field') {
          typingRef.current = true;
          openedAtRef.current = now;
          void focusTextInputForDpad(inputRef.current);
        } else if (r === 'save') onSave(item, stateRef.current.text);
        else onCancel();
        return;
      }
      if (e.key === 'ArrowDown') setRow((r) => RENAME_ROWS[Math.min(RENAME_ROWS.length - 1, RENAME_ROWS.indexOf(r) + 1)]);
      else if (e.key === 'ArrowUp') setRow((r) => RENAME_ROWS[Math.max(0, RENAME_ROWS.indexOf(r) - 1)]);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [item, onSave, onCancel, putAway]);

  const rowCls = (r: RenameRow) => `tv-ring rounded-xl px-4 py-3 ${row === r ? 'bg-brand-gold/25 z-10' : 'bg-white/5'}`;
  return (
    <div data-recording-rename className="fixed left-0 top-0 w-full h-full z-[90] flex items-center justify-center bg-black/75">
      <div className="rounded-2xl bg-brand-navy/95 border border-brand-gold/40 shadow-[0_0_40px_rgba(245,200,80,0.25)] p-5 text-white" style={{ width: 560, maxWidth: '94%' }}>
        <p className="mb-3 text-xl font-quicksand font-bold">Rename recording</p>
        <div className="space-y-2">
          <div data-rename-row="field" data-focused={row === 'field' ? 'true' : 'false'} className={rowCls('field')}>
            {/* No autofocus: OK on this row asks for the keyboard. */}
            <input
              ref={inputRef}
              type="text"
              value={text}
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
              className="w-full bg-transparent text-white px-1 py-1 font-nunito text-lg focus:outline-none"
            />
            <p className="mt-1 text-sm font-nunito text-brand-ice/60">OK to type · Enter saves</p>
          </div>
          <div data-rename-row="save" data-focused={row === 'save' ? 'true' : 'false'} className={`${rowCls('save')} flex items-center`}>
            <Check className="w-5 h-5 mr-3 flex-shrink-0 text-brand-gold" />
            <span className="text-lg font-quicksand font-bold">Save</span>
          </div>
          <div data-rename-row="cancel" data-focused={row === 'cancel' ? 'true' : 'false'} className={`${rowCls('cancel')} flex items-center`}>
            <X className="w-5 h-5 mr-3 flex-shrink-0" />
            <span className="text-lg font-nunito">Cancel</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const RecordingsScreen = memo(({ onClose, active = true }: Props) => {
  const [items, setItems] = useState<RecordingItem[] | null>(null);
  const [volumes, setVolumes] = useState<RecordVolume[]>([]);
  const [focus, setFocus] = useState(0);
  const [menu, setMenu] = useState<{ item: RecordingItem; focus: number; confirm?: boolean } | null>(null);
  const [renaming, setRenaming] = useState<RecordingItem | null>(null);
  const [playing, setPlaying] = useState<RecordingItem | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await SnowRecorder.list();
      setItems(r.recordings);
      setVolumes(r.volumes);
    } catch {
      setItems([]);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  // Where the native "recordings changed" event lands (see notifyRecordingsChanged).
  useEffect(() => {
    const on = () => { void reload(); };
    window.addEventListener(RECORDINGS_CHANGED_EVENT, on);
    return () => window.removeEventListener(RECORDINGS_CHANGED_EVENT, on);
  }, [reload]);
  // Sizes and lengths move while something records.
  const anyRecording = !!items?.some((i) => i.recording);
  useEffect(() => {
    if (!anyRecording || playing || renaming) return;
    const t = window.setInterval(() => { void reload(); }, 5000);
    return () => window.clearInterval(t);
  }, [anyRecording, playing, renaming, reload]);

  const list = items ?? [];
  const safeFocus = Math.min(focus, Math.max(0, list.length - 1));
  const actionsFor = (it: RecordingItem): Action[] =>
    it.recording ? ['play', 'stop', 'cancel'] : ['play', 'rename', 'delete', 'cancel'];

  const remove = useCallback(async (it: RecordingItem) => {
    setMenu(null);
    try {
      await SnowRecorder.remove({ path: it.path });
      toast({ title: 'Recording deleted', description: it.name });
    } catch (e) {
      toast({ title: 'Could not delete', description: (e as Error)?.message ?? '', variant: 'destructive' });
    }
    notifyRecordingsChanged();
  }, []);

  const doAction = useCallback(async (a: Action, it: RecordingItem) => {
    if (a === 'cancel') { setMenu(null); return; }
    if (a === 'play') { setMenu(null); setPlaying(it); return; }
    if (a === 'stop') {
      setMenu(null);
      try { await SnowRecorder.stop({ id: it.id }); } catch { /* ignore */ }
      toast({ title: 'Recording stopped', description: it.name });
      window.setTimeout(() => { notifyRecordingsChanged(); }, 1500);
      return;
    }
    if (a === 'rename') { setMenu(null); setRenaming(it); return; }
    // Delete asks first, and starts on "Keep it".
    setMenu({ item: it, focus: 1, confirm: true });
  }, []);

  const saveRename = useCallback(async (it: RecordingItem, text: string) => {
    const name = cleanRename(text);
    setRenaming(null);
    if (!name || name === it.name) return;
    try {
      await SnowRecorder.rename({ path: it.path, name });
      toast({ title: 'Renamed', description: name });
    } catch (e) {
      toast({ title: 'Could not rename', description: (e as Error)?.message ?? '', variant: 'destructive' });
    }
    notifyRecordingsChanged();
  }, []);
  const cancelRename = useCallback(() => setRenaming(null), []);

  // The OK that opened this screen is still down until its key comes up: skip it.
  const armedRef = useRef(false);
  useEffect(() => {
    const onUp = () => { armedRef.current = true; };
    window.addEventListener('keyup', onUp, true);
    return () => window.removeEventListener('keyup', onUp, true);
  }, []);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The list and its menus (the player and the rename box have their own keys).
  const stateRef = useRef({ list, safeFocus, menu, doAction, remove });
  stateRef.current = { list, safeFocus, menu, doAction, remove };
  useEffect(() => {
    if (!active || playing || renaming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.startsWith('Media') || e.key.startsWith('Channel')) return;
      const st = stateRef.current;
      swallow(e);
      if (isBackKey(e)) {
        markBack();
        // The delete question goes back to the menu; the menu goes back to the list.
        if (st.menu?.confirm) setMenu({ item: st.menu.item, focus: 0 });
        else if (st.menu) setMenu(null);
        else onCloseRef.current();
        return;
      }
      if (isOkKey(e) && (e.repeat || !armedRef.current)) return;
      if (st.menu) {
        const m = st.menu;
        if (m.confirm) {
          if (e.key === 'ArrowDown') setMenu({ ...m, focus: 1 });
          else if (e.key === 'ArrowUp') setMenu({ ...m, focus: 0 });
          else if (isOkKey(e)) {
            if (m.focus === 0) void st.remove(m.item);
            else setMenu({ item: m.item, focus: 0 });
          }
          return;
        }
        const acts = actionsFor(m.item);
        if (e.key === 'ArrowDown') setMenu({ ...m, focus: Math.min(acts.length - 1, m.focus + 1) });
        else if (e.key === 'ArrowUp') setMenu({ ...m, focus: Math.max(0, m.focus - 1) });
        else if (isOkKey(e)) void st.doAction(acts[m.focus], m.item);
        return;
      }
      if (e.key === 'ArrowDown') setFocus(Math.min(Math.max(0, st.list.length - 1), st.safeFocus + 1));
      else if (e.key === 'ArrowUp') setFocus(Math.max(0, st.safeFocus - 1));
      else if (e.key === 'ArrowLeft') onCloseRef.current();
      else if (isOkKey(e)) {
        const it = st.list[st.safeFocus];
        if (it) setMenu({ item: it, focus: 0 });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, playing, renaming]);

  const closePlayer = useCallback(() => {
    setPlaying(null);
    void SnowPlayer.stop().catch(() => { /* ignore */ });
  }, []);
  if (playing) return <RecordingPlayer item={playing} onClose={closePlayer} />;

  const win = listWindow(list.length, safeFocus, ROWS_SHOWN);
  const actionLabel = (a: Action): string => {
    switch (a) {
      case 'play': return 'Play';
      case 'rename': return 'Rename';
      case 'delete': return 'Delete';
      case 'stop': return 'Stop recording';
      default: return 'Cancel';
    }
  };
  const actionIcon = (a: Action) => {
    const cls = 'w-5 h-5 mr-3 flex-shrink-0';
    switch (a) {
      case 'play': return <Play className={cls} />;
      case 'rename': return <Pencil className={cls} />;
      case 'delete': return <Trash2 className={`${cls} text-red-400`} />;
      case 'stop': return <Square className={`${cls} fill-current`} />;
      default: return <X className={cls} />;
    }
  };
  const menuRow = (key: string, focused: boolean, icon: JSX.Element, label: string, danger = false) => (
    <div
      key={key}
      data-menu-row={key}
      data-focused={focused ? 'true' : 'false'}
      className={`tv-ring flex items-center rounded-xl px-4 py-3 text-lg font-nunito ${focused ? 'bg-brand-gold/25 z-10' : ''} ${danger ? 'text-red-300' : ''}`}
    >
      {icon}{label}
    </div>
  );

  return (
    <div data-recordings-screen className="flex-1 min-h-0 min-w-0 flex flex-col text-white p-5 bg-black/30 overflow-hidden">
      <div className="flex items-center mb-3">
        <ArrowLeft className="w-6 h-6 mr-2 text-brand-ice/70" />
        <h1 className="text-2xl font-quicksand font-bold mr-4">Recordings</h1>
        <div className="flex-1 min-w-0 text-right truncate">
          {volumes.map((v) => (
            <span key={v.id} className={`ml-4 text-sm font-nunito ${isLowSpace(v.freeBytes) ? 'text-amber-300' : 'text-brand-ice/70'}`}>
              {v.removable ? <Usb className="inline w-4 h-4 mr-1 -mt-0.5" /> : <HardDrive className="inline w-4 h-4 mr-1 -mt-0.5" />}
              {v.label}: {formatBytes(v.freeBytes)} free{isLowSpace(v.freeBytes) ? ' (low)' : ''}
            </span>
          ))}
        </div>
      </div>

      {items === null && <p className="text-lg font-nunito text-brand-ice/70">Loading…</p>}
      {items && list.length === 0 && (
        <p className="text-lg font-nunito text-brand-ice/70">
          No recordings yet. Hold OK on a channel (or use Record in the player) to record one.
        </p>
      )}

      <div className="flex-1 min-h-0">
        {win.start > 0 && <p className="text-center text-brand-ice/50 text-sm leading-none pb-1">▲</p>}
        <div className="space-y-2">
          {list.slice(win.start, win.end).map((it, j) => {
            const i = win.start + j;
            const focused = i === safeFocus && !menu;
            return (
              <div
                key={it.path}
                data-recording-row={i}
                data-focused={focused ? 'true' : 'false'}
                className={`tv-ring flex items-center rounded-xl px-4 py-2 ${focused ? 'bg-brand-gold/25 z-10' : 'bg-white/5'}`}
              >
                {it.recording
                  ? <Circle className="w-5 h-5 mr-3 fill-red-500 text-red-500 flex-shrink-0" />
                  : <Film className="w-5 h-5 mr-3 text-brand-gold flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-lg font-nunito font-semibold truncate">{it.name}</p>
                  <p className="text-sm font-nunito text-brand-ice/70 truncate">
                    {it.recording ? 'Recording now · ' : ''}{when(it.startedAt)} · {it.volumeLabel}
                  </p>
                </div>
                <span className="ml-3 text-base font-nunito tabular-nums text-brand-ice/80 flex-shrink-0">
                  {it.durationSec > 0 ? formatDuration(it.durationSec) : ''}
                </span>
                <span className="ml-4 text-base font-nunito tabular-nums text-brand-ice/60 flex-shrink-0">{formatBytes(it.bytes)}</span>
              </div>
            );
          })}
        </div>
        {win.end < list.length && <p className="text-center text-brand-ice/50 text-sm leading-none pt-1">▼</p>}
      </div>

      <p className="mt-2 text-sm font-nunito text-brand-ice/60">▲▼ choose · OK options · Back or ◀ closes</p>

      {menu && (
        <div data-recording-menu className="fixed left-0 top-0 w-full h-full z-[90] flex items-center justify-center bg-black/75">
          <div className="rounded-2xl bg-brand-navy/95 border border-brand-gold/40 shadow-[0_0_40px_rgba(245,200,80,0.25)] p-4" style={{ width: 480, maxWidth: '94%' }}>
            {menu.confirm ? (
              <>
                <p className="mb-1 text-lg font-quicksand font-bold">Delete this recording?</p>
                <p className="mb-3 text-base font-nunito text-brand-ice/80 truncate">{menu.item.name}</p>
                <div className="space-y-1">
                  {menuRow('sure', menu.focus === 0, <Trash2 className="w-5 h-5 mr-3 flex-shrink-0 text-red-400" />, 'Delete it', true)}
                  {menuRow('keep', menu.focus === 1, <X className="w-5 h-5 mr-3 flex-shrink-0" />, 'Keep it')}
                </div>
              </>
            ) : (
              <>
                <p className="mb-3 text-lg font-quicksand font-bold truncate">{menu.item.name}</p>
                <div className="space-y-1">
                  {actionsFor(menu.item).map((a, i) => menuRow(a, i === menu.focus, actionIcon(a), actionLabel(a)))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {renaming && (
        <RenameDialog item={renaming} onSave={saveRename} onCancel={cancelRename} />
      )}
    </div>
  );
});

RecordingsScreen.displayName = 'RecordingsScreen';
export default RecordingsScreen;
