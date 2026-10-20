// Live TV › Settings › Channels (owner, 2026-10-20): what Live TV shows and
// how, in one page.
//
//   Hide categories: HideCategoriesScreen, opened in this page (it reads every
//   line's categories from its server, so only once asked for).
//   Favorites order: My order or A–Z, the same choice as Sort my way / Sort
//   A–Z in a channel's menu (lib/favoritesOrder).
//   When a channel is down, play it from my other service: the failover
//   switch (lib/channelFailover), only with more than one line on the box.
//   Update channels: the same as Live TV's Update Channels button (the hub
//   closes and Live TV loads its lists again).
//
// The remote: Up / Down walk the rows, OK uses one; Back (or Left) returns to
// the Settings menu, and from Hide categories to this page. Chrome 66:
// margins and space-y, no flex gap.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownAZ, ChevronRight, ListFilter, RefreshCw, Shuffle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { fingerIsDriving } from '@/lib/phoneMode';
import { keepInView } from '@/utils/keepInView';
import { loadFailoverOn, readLiveLineCount, saveFailoverOn } from '@/lib/channelFailover';
import { loadFavOrder, saveFavOrder, useFavoritesOrder, type FavSortMode } from '@/lib/favoritesOrder';
import { loadSavedAccounts, savedAccountId } from '@/lib/xtream';
import HideCategoriesScreen from './HideCategoriesScreen';

interface Props {
  /** Back from the page: the remote returns to the Settings menu. */
  onBack: () => void;
  /** Whether the remote is on this page (false while it is on the Settings menu). */
  active?: boolean;
  /** Update channels: Live TV's own Update Channels (absent: the row isn't offered). */
  onUpdateChannels?: () => void;
}

type RowId = 'hide' | 'favs' | 'failover' | 'update';

const isBackKey = (e: KeyboardEvent) => e.key === 'Escape' || e.key === 'Backspace' || e.keyCode === 4;
const isOkKey = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' || e.keyCode === 23;
const swallow = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

const ChannelsScreen = memo(({ onBack, active = true, onUpdateChannels }: Props) => {
  const { t } = useTranslation();
  const [hideOpen, setHideOpen] = useState(false);
  const [focus, setFocus] = useState<RowId>('hide');
  const favMode = useFavoritesOrder().mode;
  const [failoverOn, setFailoverOn] = useState(loadFailoverOn);
  // More than one line: what Live TV last counted (it knows every line it
  // lists), else the saved accounts.
  const [multiLine, setMultiLine] = useState(() => readLiveLineCount() > 1);
  useEffect(() => {
    if (multiLine) return;
    let cancelled = false;
    void loadSavedAccounts().then((list) => {
      const ids = new Set(list.filter((a) => a.host && a.username && a.password).map((a) => savedAccountId(a.host, a.username)));
      if (!cancelled && ids.size > 1) setMultiLine(true);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [multiLine]);

  const rows = useMemo<RowId[]>(() => [
    'hide', 'favs', ...(multiLine ? ['failover' as const] : []), ...(onUpdateChannels ? ['update' as const] : []),
  ], [multiLine, onUpdateChannels]);
  const stateRef = useRef({ rows, focus });
  stateRef.current = { rows, focus };

  /** My order ⇄ A–Z; the viewer's own order is kept as it is (switching back shows it again). */
  const setFavMode = useCallback((mode: FavSortMode) => { saveFavOrder({ mode, keys: loadFavOrder().keys }); }, []);

  const activate = useCallback((id: RowId) => {
    if (id === 'hide') setHideOpen(true);
    else if (id === 'favs') setFavMode(loadFavOrder().mode === 'az' ? 'mine' : 'az');
    else if (id === 'failover') { const next = !loadFailoverOn(); saveFailoverOn(next); setFailoverOn(next); }
    else if (id === 'update') onUpdateChannels?.();
  }, [setFavMode, onUpdateChannels]);

  // The remote went back to the menu by a tap there: the page is itself again.
  useEffect(() => { if (!active) setHideOpen(false); }, [active]);

  useEffect(() => {
    if (!active || hideOpen) return; // the menu, or Hide categories, has the remote
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (isBackKey(e) || e.key === 'ArrowLeft') { swallow(e); onBack(); return; }
      const ok = isOkKey(e);
      if (!ok && e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowRight') return;
      swallow(e);
      const { rows: list, focus: cur } = stateRef.current;
      const i = Math.max(0, list.indexOf(cur));
      if (e.key === 'ArrowDown') setFocus(list[Math.min(list.length - 1, i + 1)]);
      else if (e.key === 'ArrowUp') setFocus(list[Math.max(0, i - 1)]);
      else if (ok && !e.repeat) activate(list[i]);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active, hideOpen, onBack, activate]);

  // Keep the highlighted row on screen (a bigger text size, a longer language);
  // on the last row show what is under it too.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = listRef.current;
    if (!node || !active || fingerIsDriving()) return;
    const { rows: list, focus: cur } = stateRef.current;
    if (cur === list[list.length - 1]) { node.scrollTop = node.scrollHeight; return; }
    if (cur === list[0]) { node.scrollTop = 0; return; }
    const el = Array.from(node.querySelectorAll<HTMLElement>('[data-row]')).find((n) => n.getAttribute('data-row') === cur);
    if (el) keepInView(node, el, 12);
  }, [focus, active]);

  const closeHide = useCallback(() => { setHideOpen(false); setFocus('hide'); }, []);
  if (hideOpen) return <HideCategoriesScreen embedded active={active} onBack={closeHide} />;

  const focused = (id: RowId) => active && focus === id;
  const rowProps = (id: RowId) => ({
    'data-row': id,
    'data-focused': focused(id) ? 'true' : 'false',
    onClick: () => { setFocus(id); activate(id); },
    className: `tv-ring flex items-center rounded-2xl px-4 py-3 border cursor-pointer bg-slate-900/60 border-white/10 ${focused(id) ? 'scale-[1.02] z-10' : ''}`,
  });
  const chip = (on: boolean) => `ml-2 px-3 py-1 rounded-lg text-sm font-quicksand font-bold ${on ? 'bg-brand-gold text-brand-navy' : 'bg-white/10 text-white/70'}`;

  return (
    <div className="h-full min-h-0 overflow-hidden flex flex-col text-white" data-channels-screen>
      <div ref={listRef} className="flex-1 overflow-auto p-1">
        <div className="w-full max-w-3xl space-y-3">
          <div {...rowProps('hide')}>
            <ListFilter className="w-5 h-5 mr-3 text-brand-gold shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-quicksand font-bold">{t('liveAccount.channels.hide')}</p>
              <p className="text-xs font-nunito text-brand-ice/70 mt-1">{t('liveAccount.channels.hideDesc')}</p>
            </div>
            <ChevronRight className="w-5 h-5 ml-3 text-white/60 shrink-0" />
          </div>

          <div {...rowProps('favs')} data-fav-mode={favMode}>
            {favMode === 'az' ? <ArrowDownAZ className="w-5 h-5 mr-3 text-brand-gold shrink-0" /> : <Shuffle className="w-5 h-5 mr-3 text-brand-gold shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-quicksand font-bold">{t('liveAccount.channels.favOrder')}</p>
              <p className="text-xs font-nunito text-brand-ice/70 mt-1">{t('liveAccount.channels.favOrderDesc')}</p>
            </div>
            <span className={chip(favMode === 'mine')}>{t('liveAccount.channels.favMine')}</span>
            <span className={chip(favMode === 'az')}>{t('liveAccount.channels.favAz')}</span>
          </div>

          {multiLine && (
            <div {...rowProps('failover')} data-on={failoverOn ? 'true' : 'false'}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-quicksand font-bold">{t('liveAccount.channels.failover')}</p>
                <p className="text-xs font-nunito text-brand-ice/70 mt-1">{t('liveAccount.channels.failoverDesc')}</p>
              </div>
              <span className={`ml-4 ${chip(failoverOn)}`}>{failoverOn ? t('live.playback.on') : t('live.playback.off')}</span>
            </div>
          )}

          {onUpdateChannels && (
            <div {...rowProps('update')}>
              <RefreshCw className="w-5 h-5 mr-3 text-brand-gold shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-quicksand font-bold">{t('live.shell.updateChannelsBtn')}</p>
                <p className="text-xs font-nunito text-brand-ice/70 mt-1">{t('liveAccount.channels.updateDesc')}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

ChannelsScreen.displayName = 'ChannelsScreen';
export default ChannelsScreen;
