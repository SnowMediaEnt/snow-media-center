// Live TV › Settings: the short state line under each menu row
// ("Dreamstreams · expires Nov 19", "2 services", "Compact · Slim rows"), so a
// viewer, or support on the phone, can read it without opening the page.
// Everything comes from the box: nothing here asks any server.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SnowRecorder, hasRecorder } from '@/capacitor/SnowRecorder';
import { usePlayerAccount } from '@/hooks/usePlayerAccount';
import { usePlayerEngine } from '@/hooks/usePlayerEngine';
import { formatDate } from '@/i18n/format';
import { isDemo } from '@/lib/demoMode';
import { useFavoritesOrder } from '@/lib/favoritesOrder';
import { lineKey } from '@/lib/favoritesSync';
import { LIVE_LAYOUTS, useLiveLayout } from '@/lib/liveLayout';
import { HIDDEN_CATEGORIES_EVENT, loadHiddenCategories } from '@/lib/liveLines';
import { REWIND_SETTINGS_EVENT, loadRewindSettings } from '@/lib/liveRewind';
import { LIVE_BUFFER_EVENT, LIVE_BUFFER_LABEL_KEY, loadLiveBuffer } from '@/lib/liveBuffer';
import { useLiveRowSize } from '@/lib/liveRows';
import { readOutsideHere } from '@/lib/outsideActions';
import { OUTSIDE_SOURCES_EVENT, outsideCreds } from '@/lib/outsideSource';
import { SAVED_ACCOUNTS_REFRESH_EVENT, expDateToMs, savedAccountId, serverDisplayName, type XtreamCreds } from '@/lib/xtream';

/** The Settings menu's rows, top to bottom. */
export type HubRow = 'account' | 'services' | 'channels' | 'appearance' | 'rewind' | 'player' | 'help' | 'signout';

/** What the box holds about the lines, read together (the Services and Channels lines). */
interface LinesNow {
  services: number;
  hidden: number;
  username: string;
}

/** Read again on these: a line saved or switched, an outside service saved or removed, a category hidden. */
const LINE_EVENTS = ['playerAccountRefresh', OUTSIDE_SOURCES_EVENT, SAVED_ACCOUNTS_REFRESH_EVENT, HIDDEN_CATEGORIES_EVENT];

async function readLines(): Promise<LinesNow> {
  // No panel check for a summary (Services' own page asks when it opens).
  const here = await readOutsideHere({ recheck: false });
  const ids = new Set(here.accounts.map((a) => a.id));
  if (here.active) ids.add(savedAccountId(here.active.host, here.active.username));
  // Hidden categories on every line Live TV lists from this box.
  const lines: Array<Pick<XtreamCreds, 'host' | 'username'>> = [
    ...(here.active ? [here.active] : []),
    ...here.accounts.filter((a) => a.host && a.username),
    ...here.sources.map(outsideCreds),
  ];
  const keys = new Set(lines.map((l) => lineKey(l)));
  let hidden = 0;
  for (const k of keys) hidden += loadHiddenCategories(k).size;
  return { services: ids.size + here.sources.length, hidden, username: here.active?.username ?? '' };
}

/**
 * The state line of every row. `refresh` changes when the hub wants a fresh
 * read of what has no event of its own (the network folder for recordings):
 * it passes its page, so coming back to the menu reads it again.
 */
export function useHubStates(refresh: unknown): Record<HubRow, string> {
  const { t } = useTranslation();
  const { account, days } = usePlayerAccount();
  const { engine } = usePlayerEngine();
  const favOrder = useFavoritesOrder();
  const layout = useLiveLayout();
  const rowSize = useLiveRowSize();
  const [lines, setLines] = useState<LinesNow | null>(null);
  const [rewindOn, setRewindOn] = useState(() => loadRewindSettings().enabled);
  const [liveBuffer, setLiveBuffer] = useState(loadLiveBuffer);
  /** Where recordings go: null on a box that doesn't record (or the demo), '' for the box itself. */
  const [recTo, setRecTo] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const read = () => { void readLines().then((next) => { if (alive) setLines(next); }); };
    read();
    for (const ev of LINE_EVENTS) window.addEventListener(ev, read);
    return () => { alive = false; for (const ev of LINE_EVENTS) window.removeEventListener(ev, read); };
  }, []);

  useEffect(() => {
    const read = () => setRewindOn(loadRewindSettings().enabled);
    window.addEventListener(REWIND_SETTINGS_EVENT, read);
    return () => window.removeEventListener(REWIND_SETTINGS_EVENT, read);
  }, []);

  useEffect(() => {
    const read = () => setLiveBuffer(loadLiveBuffer());
    window.addEventListener(LIVE_BUFFER_EVENT, read);
    return () => window.removeEventListener(LIVE_BUFFER_EVENT, read);
  }, []);

  useEffect(() => {
    if (!hasRecorder() || isDemo()) return;
    let alive = true;
    SnowRecorder.getNetworkFolder()
      .then((nf) => { if (alive) setRecTo(nf.configured ? (nf.label || nf.host || '') : ''); })
      .catch(() => { if (alive) setRecTo(''); });
    return () => { alive = false; };
  }, [refresh]);

  const accountLine = (() => {
    if (!account) return '';
    const expired = /expired|disabled|banned/i.test(account.status || '') || (days !== null && days < 0);
    if (expired) return t('liveAccount.account.statusExpired');
    if (account.isTrial) {
      return days === null ? t('liveAccount.account.trial') : `${t('liveAccount.account.trial')} · ${t('liveAccount.account.daysLeft', { count: days })}`;
    }
    const exp = expDateToMs(account.expDate);
    // "Nov 19" this year, "Jan 3, 2027" for another.
    const date = exp ? formatDate(exp, new Date(exp).getFullYear() === new Date().getFullYear() ? 'short' : 'medium') : '';
    // The brand's own spelling ("DreamStreams"): the stored label is "Dreamstreams".
    const name = serverDisplayName(account.serverLabel);
    return date ? `${name} · ${t('liveAccount.hub.state.expires', { date })}` : name;
  })();

  const layoutInfo = LIVE_LAYOUTS.find((l) => l.id === layout);
  const listRows = layout === 'classic' || layout === 'compact';

  return {
    account: accountLine,
    // Nothing read (the demo, no line): no "0 services".
    services: lines?.services ? t('liveAccount.hub.state.services', { count: lines.services }) : '',
    channels: lines
      ? `${lines.hidden ? t('liveAccount.hub.state.hidden', { count: lines.hidden }) : t('liveAccount.hub.state.noneHidden')} · ${t(favOrder.mode === 'az' ? 'liveAccount.hub.state.favAz' : 'liveAccount.hub.state.favMine')}`
      : '',
    appearance: [
      layoutInfo ? t(layoutInfo.labelKey) : '',
      listRows ? t(rowSize === 'slim' ? 'liveAccount.hub.state.slimRows' : 'liveAccount.hub.state.normalRows') : '',
    ].filter(Boolean).join(' · '),
    rewind: [
      t(rewindOn ? 'liveAccount.hub.state.rewindOn' : 'liveAccount.hub.state.rewindOff'),
      recTo === null ? '' : recTo ? t('liveAccount.hub.state.recordingsOn', { name: recTo }) : t('liveAccount.hub.state.recordingsHere'),
    ].filter(Boolean).join(' · '),
    // Product names, not translated; then the Live buffer.
    player: `${engine === 'mpv' ? 'MPV' : 'ExoPlayer'} · ${t('liveAccount.hub.state.liveBuffer', { size: t(LIVE_BUFFER_LABEL_KEY[liveBuffer]) })}`,
    help: t('liveAccount.hub.state.help'),
    signout: lines?.username ? t('liveAccount.hub.state.signedInAs', { username: lines.username }) : '',
  };
}
