// Hold OK on a Plex movie or show (or a finger held on its poster): a short
// menu to recommend it to the other viewers of this server, or to take the
// recommendation back. Signed out, it says to sign in instead. Every title
// also has "Report a problem" (onReport: PlexSection opens the same report as
// Live TV's channels, tagged Plex); a title that can't be recommended (an
// episode whose show is not known, anything adult) has only that and Cancel.
//
// Owns the remote while open (plexRecommendHold gave it the key owner):
// ▲ ▼ move, OK chooses, Back closes. OK is taken only once the press that
// opened the menu has been let go, so the hold itself never chooses. The menu
// closes at once and the toast follows when the account has answered.
// Whenever it goes, the remote goes back (an unmount gives it back too, so
// the key owner is never left as the menu's with no menu on screen).
import { memo, useEffect, useRef, useState } from 'react';
import { Check, Flag, Loader2, ThumbsUp, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PlexItem } from '@/lib/plex';
import { canRecommend, loadMyRecommended, myRecommendedKeys, recommendTarget, recommendTitle, unrecommendTitle } from '@/lib/plexRecommend';
import { resolveViewer, viewerAccountId } from '@/lib/viewer';
import { isPlexKeyOwner } from './plexKeyOwner';
import { claimPlexHoldMenu, plexOkHeld, releasePlexHoldMenu, tapIsHoldLift, toastRecommendResult } from './plexRecommendHold';

interface Props {
  item: PlexItem;
  /** The server's machineIdentifier. */
  server: string;
  /** Plex has the remote. Off while a notice of the Player's is over it: the
   *  menu leaves every key to that notice (PlexSection then closes it). */
  isActive?: boolean;
  /** "Report a problem": the caller closes this menu and opens the report. */
  onReport?: (item: PlexItem) => void;
  onClose: () => void;
}

// 'checking': is it this account's already? 'on': it is.
type Mode = 'checking' | 'signedOut' | 'off' | 'on';

const PlexRecommendMenu = memo(({ item, server, isActive = true, onReport, onClose }: Props) => {
  const { t } = useTranslation();
  const canRec = canRecommend(item);
  const target = canRec ? recommendTarget(item) : null;
  const targetKey = target?.ratingKey ?? '';
  const [mode, setMode] = useState<Mode>(() => {
    const known = myRecommendedKeys(server);
    return known ? (known.has(targetKey) ? 'on' : 'off') : 'checking';
  });
  useEffect(() => {
    if (!canRec) return;
    let cancelled = false;
    void (async () => {
      await resolveViewer();
      if (cancelled) return;
      if (!viewerAccountId()) { setMode('signedOut'); return; }
      const keys = await loadMyRecommended(server);
      // Unreadable: offered as not recommended; recommending something
      // already recommended is still just "recommended".
      if (!cancelled) setMode(keys?.has(targetKey) ? 'on' : 'off');
    })();
    return () => { cancelled = true; };
  }, [server, targetKey, canRec]);

  // onClose gives the remote back (PlexSection: releasePlexHoldMenu); so
  // does going away any other way.
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const isActiveRef = useRef(isActive); isActiveRef.current = isActive;
  useEffect(() => {
    claimPlexHoldMenu();
    return () => releasePlexHoldMenu();
  }, []);

  const rows: Array<{ id: string; label: string; run?: () => void }> = [];
  const reportRow = onReport ? [{ id: 'report', label: t('live.report.vod.reportProblem'), run: () => onReport(item) }] : [];
  if (!target) {
    rows.push(...reportRow);
    rows.push({ id: 'cancel', label: t('common.cancel'), run: onClose });
  } else if (mode === 'signedOut') {
    rows.push(...reportRow);
    rows.push({ id: 'ok', label: t('common.ok'), run: onClose });
  } else {
    if (mode === 'checking') rows.push({ id: 'checking', label: t('plex.recommend.checking') });
    else if (mode === 'off') {
      rows.push({
        id: 'add',
        label: t('plex.recommend.action'),
        run: () => {
          onClose();
          if (target) void recommendTitle(server, target).then((r) => toastRecommendResult(r, true, target.title));
        },
      });
    } else {
      rows.push({
        id: 'remove',
        label: t('plex.recommend.remove'),
        run: () => {
          onClose();
          if (target) void unrecommendTitle(server, target.ratingKey).then((r) => toastRecommendResult(r, false, target.title));
        },
      });
    }
    rows.push(...reportRow);
    rows.push({ id: 'cancel', label: t('common.cancel'), run: onClose });
  }
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const [focus, setFocus] = useState(0);
  const focusRef = useRef(focus); focusRef.current = focus;
  useEffect(() => { if (focus >= rows.length) setFocus(0); }, [focus, rows.length]);
  // Armed at once unless OK is still down from the hold that opened it (a
  // right click, an air mouse, or a release that came first, need no wait).
  const armedRef = useRef(!plexOkHeld());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPlexKeyOwner('menu') || !isActiveRef.current) return;
      const isBack = e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4 || e.keyCode === 8;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (isBack) {
        (window as unknown as { __overlayHandledBackAt?: number }).__overlayHandledBackAt = Date.now();
        if (!e.repeat) onCloseRef.current();
        return;
      }
      const n = rowsRef.current.length;
      // Clamped ends, as everywhere in Plex.
      if (e.key === 'ArrowDown') { setFocus((i) => Math.min(n - 1, i + 1)); return; }
      if (e.key === 'ArrowUp') { setFocus((i) => Math.max(0, i - 1)); return; }
      // The hold that opened this: its repeats, and anything before it is let go.
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && armedRef.current) rowsRef.current[focusRef.current]?.run?.();
    };
    const onUp = (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') armedRef.current = true; };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onUp, true);
    };
  }, []);

  const signedOut = !!target && mode === 'signedOut';
  const title = target?.title ?? item.title;
  const year = target ? target.year : item.year;
  return (
    <div
      className="fixed z-[80] flex items-center justify-center bg-black/75 px-4"
      style={{ top: 0, right: 0, bottom: 0, left: 0 }}
      // The lift of the finger whose hold opened this lands here: not a tap.
      onClick={(e) => { if (e.target === e.currentTarget && !tapIsHoldLift()) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('plex.recommend.menuAria', { title })}
        data-plex-recommend-menu=""
        // w-full + max-w, not min(): CSS min() is Chrome 79.
        className="w-full max-w-[460px] rounded-2xl bg-brand-navy/95 border border-brand-gold/40 shadow-[0_0_40px_rgba(245,200,80,0.25)] p-6 text-white"
      >
        <div className="flex items-center mb-4 min-w-0">
          <ThumbsUp className="w-6 h-6 text-brand-gold flex-shrink-0 mr-3" aria-hidden="true" />
          <h2 className="font-quicksand font-bold text-xl truncate min-w-0">
            {title}{year ? ` (${year})` : ''}
          </h2>
        </div>
        {signedOut && (
          <p className="mb-4 text-sm text-brand-ice/85 font-nunito">{t('plex.recommend.signIn')}</p>
        )}
        <div className="space-y-2">
          {rows.map((row, i) => {
            const focused = focus === i;
            const muted = row.id === 'cancel' || row.id === 'ok';
            return (
              <button
                key={row.id}
                type="button"
                data-focused={focused ? 'true' : 'false'}
                data-recommend-row={row.id}
                disabled={!row.run}
                onMouseEnter={() => setFocus(i)}
                onClick={() => { if (!tapIsHoldLift()) row.run?.(); }}
                // The icons' margin, not flex gap (Chrome 84).
                className={`tv-ring appearance-none w-full text-left px-4 py-3 rounded-xl border border-white/10 font-nunito font-semibold transition-transform duration-150 ease-out flex items-center ${
                  focused ? (muted ? 'bg-white/15 scale-[1.02] z-10' : 'bg-brand-gold/25 scale-[1.02] z-10') : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                {row.id === 'checking' ? <Loader2 className="w-5 h-5 mr-3 text-brand-gold flex-shrink-0 animate-spin" aria-hidden="true" />
                  : row.id === 'report' ? <Flag className="w-5 h-5 mr-3 text-brand-gold flex-shrink-0" aria-hidden="true" />
                  : row.id === 'add' || row.id === 'remove' ? <ThumbsUp className={`w-5 h-5 mr-3 text-brand-gold flex-shrink-0${row.id === 'remove' ? ' fill-current' : ''}`} aria-hidden="true" />
                    : row.id === 'ok' ? <Check className="w-5 h-5 mr-3 text-brand-gold flex-shrink-0" aria-hidden="true" />
                      : <X className="w-5 h-5 mr-3 text-brand-ice/70 flex-shrink-0" aria-hidden="true" />}
                <span className="min-w-0 truncate">{row.label}</span>
              </button>
            );
          })}
        </div>
        {target && !signedOut && (
          <p className="mt-4 text-xs text-brand-ice/70 font-nunito">{t('plex.recommend.note')}</p>
        )}
      </div>
    </div>
  );
});

PlexRecommendMenu.displayName = 'PlexRecommendMenu';
export default PlexRecommendMenu;
