// Support › Device check (ported from Tronix components/deviceCheck/
// DeviceCheckScreen; owner, 2026-10-29: "can we add the device check to SMC
// like we just added to Tronix"). A quick scan of this device and its
// connection, rated green / yellow / orange / red, with suggestions.
//
//   header     Back · the title · Check again
//   summary    the overall rating and a calm line; Run speed test, Ask the
//              assistant (Support's AI tab, lib/assistantHandoff), Get help
//              (a ticket, lib/deviceScanSend)
//   left       What we found: This device, Connection, TV / screen, each with
//              its level and its lines; orange and red lines say why
//              (lib/deviceScanRating)
//   right      Suggestions by category (the scan's orange / red areas first,
//              "Worth a look") and Budget / Mid / Best (lib/deviceScanPicks)
//
// Not Device Health's 30 s stream check (lib/deviceCheck.ts): this plays nothing.
//
// TV: the whole width in two columns; ▲▼ within a column, ◀▶ between the
// columns and along the buttons; Back one step (the help form back to the
// check, the check back to Support, its card highlighted). The remote's Back
// arrives through Capacitor on a box (useOwnHardwareBack), the system Back on
// a phone (usePlatformBack). A phone: one column. Not on a Kids profile
// (Support leaves the card out).
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Gauge, LifeBuoy, Loader2, RefreshCw, ScanSearch } from 'lucide-react';
import { BackButton } from '@/components/ui/BackButton';
import SpeedTest, { type SpeedTestResult } from '@/components/SpeedTest';
import { useTVFocus, type TVFocusNavigationMap } from '@/hooks/useTVFocus';
import { usePlatformBack } from '@/hooks/usePlatformBack';
import { useOwnHardwareBack } from '@/hooks/useOwnHardwareBack';
import { useAuth } from '@/hooks/useAuth';
import { usePhoneLayout } from '@/lib/phoneMode';
import { trackEvent } from '@/lib/analytics';
import { loadVersion } from '@/hooks/useVersion';
import { keepSpeed, scanDevice, type DeviceScan } from '@/lib/deviceScan';
import { needsReason, rateScan, type Area, type Level } from '@/lib/deviceScanRating';
import { groupPicks, smcPicks } from '@/lib/deviceScanPicks';
import { assistantMessage, scanSummary, ticketSubject } from '@/lib/deviceScanSend';

const DeviceScanHelpForm = lazy(() => import('./DeviceScanHelpForm'));

interface Props {
  /** Back: Support's menu again. */
  onClose: () => void;
  /** Ask the assistant: Support's AI tab, the message sent there. */
  onAsk?: (message: string) => void;
  /** After a ticket was sent: Support › Submit a Ticket. */
  onOpenTickets?: () => void;
}

const DOT: Record<Level, string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-yellow-300',
  orange: 'bg-orange-400',
  red: 'bg-red-500',
};
const TEXT: Record<Level, string> = {
  green: 'text-emerald-300',
  yellow: 'text-yellow-200',
  orange: 'text-orange-300',
  red: 'text-red-300',
};
const AREAS: readonly Area[] = ['device', 'connection', 'screen'];
const ACTIONS = ['ds-speed', 'ds-ask', 'ds-help'] as const;

const DeviceScanScreen = memo(({ onClose, onAsk, onOpenTickets }: Props) => {
  const { t } = useTranslation();
  const phone = usePhoneLayout() !== null;
  const { user } = useAuth();
  const [scan, setScan] = useState<DeviceScan | null>(null);
  const [scanning, setScanning] = useState(true);
  const [showSpeed, setShowSpeed] = useState(false);
  const [speedFailed, setSpeedFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const picks = useMemo(() => smcPicks(), []);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const runScan = useCallback(() => {
    setScanning(true);
    void scanDevice().then((s) => {
      if (!alive.current) return;
      setScan(s);
      setScanning(false);
    });
  }, []);
  useEffect(() => {
    runScan();
    try { trackEvent('device_scan_open', 'support'); } catch { /* ignore */ }
    void loadVersion().then((v) => {
      if (!alive.current || !v?.version) return;
      setAppVersion(`${v.version}${v.versionCode ? ` (${v.versionCode})` : ''}`);
    }).catch(() => { /* left out */ });
  }, [runScan]);

  const rating = useMemo(() => (scan ? rateScan(scan) : null), [scan]);
  useEffect(() => {
    if (!rating) return;
    try { trackEvent('device_scan_rated', 'support', { overall: rating.overall ?? 'none', device: rating.areas.device ?? 'none', connection: rating.areas.connection ?? 'none' }); } catch { /* ignore */ }
  }, [rating]);
  const groups = useMemo(() => groupPicks(picks, rating?.highlight ?? []), [picks, rating]);
  // The picks in screen order (their focus ids are their place here).
  const flatPicks = useMemo(() => groups.flatMap((g) => g.tiers.flatMap((tr) => tr.picks)), [groups]);
  const summary = useMemo(() => (scan && rating ? scanSummary(scan, rating, appVersion) : ''), [scan, rating, appVersion]);

  const onSpeed = useCallback((r: SpeedTestResult) => {
    if ('failed' in r) { setSpeedFailed(true); return; }
    setSpeedFailed(false);
    const kept = keepSpeed(r);
    if (kept) setScan((s) => (s ? { ...s, speed: kept } : s));
  }, []);

  const ask = useCallback(() => {
    if (!scan || !rating) return;
    try { trackEvent('device_scan_ask', 'support', { overall: rating.overall ?? 'none' }); } catch { /* ignore */ }
    onAsk?.(assistantMessage(t('deviceScan.askQuestion'), scan, rating, picks, appVersion));
  }, [scan, rating, onAsk, picks, t, appVersion]);

  const askShown = !!onAsk;
  const actions = useMemo(() => ACTIONS.filter((a) => a !== 'ds-ask' || askShown), [askShown]);
  const areaIds = useMemo(() => (rating ? AREAS.filter((a) => rating.findings.some((f) => f.area === a)).map((a) => `ds-area-${a}`) : []), [rating]);
  const pickIds = useMemo(() => flatPicks.map((_, i) => `ds-pick-${i}`), [flatPicks]);

  // The D-pad map: the header row, the buttons, then two columns (one on a phone).
  const lastLeft = useRef(0);
  const lastRight = useRef(0);
  const navigation = useMemo<TVFocusNavigationMap>(() => {
    const nav: TVFocusNavigationMap = {};
    const stay = () => null;
    const firstAction = actions[0];
    const lastAction = actions[actions.length - 1];
    const topOfColumns = (prefer: 'left' | 'right') => () =>
      (prefer === 'right' && pickIds.length ? pickIds[0] : areaIds[0] ?? pickIds[0] ?? null);
    nav['ds-back'] = { right: 'ds-rescan', down: firstAction, left: stay, up: stay };
    nav['ds-rescan'] = { left: 'ds-back', down: lastAction, right: stay, up: stay };
    actions.forEach((id, i) => {
      nav[id] = {
        up: i === actions.length - 1 && !phone ? 'ds-rescan' : 'ds-back',
        left: actions[i - 1] ?? stay,
        right: actions[i + 1] ?? stay,
        down: topOfColumns(!phone && i === actions.length - 1 ? 'right' : 'left'),
      };
    });
    if (phone) {
      const col = [...areaIds, ...pickIds];
      col.forEach((id, i) => {
        nav[id] = { up: col[i - 1] ?? firstAction, down: col[i + 1] ?? stay, left: stay, right: stay };
      });
      return nav;
    }
    areaIds.forEach((id, i) => {
      nav[id] = {
        up: areaIds[i - 1] ?? firstAction,
        down: areaIds[i + 1] ?? stay,
        left: stay,
        right: pickIds.length ? () => { lastLeft.current = i; return pickIds[Math.min(lastRight.current, pickIds.length - 1)]; } : stay,
      };
    });
    pickIds.forEach((id, i) => {
      nav[id] = {
        up: pickIds[i - 1] ?? lastAction,
        down: pickIds[i + 1] ?? stay,
        left: areaIds.length ? () => { lastRight.current = i; return areaIds[Math.min(lastLeft.current, areaIds.length - 1)]; } : stay,
        right: stay,
      };
    });
    return nav;
  }, [actions, areaIds, pickIds, phone]);

  // Back from the help form or the speed test: their button highlighted again.
  const returnTo = useRef<string | null>(null);
  const focusActive = !showSpeed && !sending;
  const { containerRef, focusById, focusProps, currentFocusId } = useTVFocus({
    navigation,
    initialFocusId: 'ds-back',
    onBack: onClose,
    enabled: focusActive,
    scrollBlock: 'nearest',
  });
  // A box's remote Back (Capacitor) turns into the Escape useTVFocus answers;
  // a phone's system Back closes it the same one step.
  useOwnHardwareBack(focusActive, onClose);
  usePlatformBack(focusActive, onClose);
  useEffect(() => {
    if (!focusActive || !returnTo.current) return;
    const id = returnTo.current;
    returnTo.current = null;
    window.requestAnimationFrame(() => { focusById(id, 'nearest'); });
  }, [focusActive, focusById]);

  const openSpeed = useCallback(() => { returnTo.current = 'ds-speed'; setSpeedFailed(false); setShowSpeed(true); }, []);
  const openSend = useCallback(() => { if (rating) { returnTo.current = 'ds-help'; setSending(true); } }, [rating]);

  const overall = rating?.overall ?? null;
  const btn = 'tv-ring h-10 px-4 rounded-lg text-base font-semibold inline-flex items-center whitespace-nowrap border';
  const actionBtn = (id: string, label: string, Icon: typeof Gauge, onClick: () => void, disabled?: boolean) => (
    <button
      type="button"
      {...focusProps(id)}
      data-focused={currentFocusId === id ? 'true' : 'false'}
      data-howto={id === 'ds-ask' ? 'ds.ask' : undefined}
      onClick={onClick}
      disabled={disabled}
      className={`${btn} mb-2 md:mb-0 md:mr-2 bg-white/10 border-white/20 text-white disabled:opacity-60`}
    >
      <Icon className="w-5 h-5 mr-2 flex-shrink-0" aria-hidden="true" />{label}
    </button>
  );

  const header = (
    <div className="flex items-center px-6 py-3 border-b border-white/10 bg-[#0a1628]">
      <BackButton
        onClick={onClose}
        label={t('common.back')}
        focusId="ds-back"
        {...focusProps('ds-back')}
        focused={currentFocusId === 'ds-back'}
        className="h-10 px-4 text-base flex-shrink-0"
      />
      <ScanSearch className="hidden md:block w-7 h-7 ml-3 mr-2 text-brand-gold flex-shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 mx-3 md:mx-0">
        <h1 className="text-xl md:text-2xl font-bold truncate leading-tight">{t('deviceScan.title')}</h1>
        <p className="hidden md:block text-sm text-white/70 leading-tight truncate">{t('deviceScan.subtitle')}</p>
      </div>
      <button
        type="button"
        {...focusProps('ds-rescan')}
        data-focused={currentFocusId === 'ds-rescan' ? 'true' : 'false'}
        onClick={runScan}
        disabled={scanning}
        aria-label={t('deviceScan.rescan')}
        className={`${btn} bg-white/10 border-white/20 text-white flex-shrink-0 disabled:opacity-60`}
      >
        <RefreshCw className={`w-5 h-5 md:mr-2 ${scanning ? 'animate-spin' : ''}`} aria-hidden="true" />
        <span className="hidden md:inline">{t('deviceScan.rescan')}</span>
      </button>
    </div>
  );

  const overallCard = (
    <div data-device-scan-overall={overall ?? 'none'} data-howto="ds.overall" className="rounded-xl px-4 py-3 bg-black/30 border border-white/10 md:flex md:items-center">
      <div className="flex items-center min-w-0 flex-1">
        {scanning && !scan
          ? <Loader2 className="w-6 h-6 mr-3 animate-spin text-brand-gold flex-shrink-0" aria-hidden="true" />
          : <span aria-hidden="true" className={`w-5 h-5 rounded-full mr-3 flex-shrink-0 ${overall ? DOT[overall] : 'bg-white/30'}`} />}
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">
            {scanning && !scan ? t('deviceScan.scanning') : t(`deviceScan.overall.${overall ?? 'none'}`)}
          </p>
          {scan && <p className="text-sm text-white/75 leading-snug">{t(`deviceScan.overallNote.${overall ?? 'none'}`)}</p>}
          {speedFailed && <p className="text-sm text-amber-300 leading-snug" role="status">{t('deviceScan.speedFailed')}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-col items-stretch md:mt-0 md:flex-row md:items-center md:flex-shrink-0 md:ml-4">
        {actionBtn('ds-speed', scan?.speed ? t('deviceScan.runSpeedAgain') : t('deviceScan.runSpeed'), Gauge, openSpeed)}
        {askShown && actionBtn('ds-ask', t('deviceScan.ask'), Bot, ask, !scan)}
        {actionBtn('ds-help', t('deviceScan.help'), LifeBuoy, openSend, !scan)}
      </div>
    </div>
  );

  const found = (
    <section className="min-w-0" data-device-scan-found="" data-howto="ds.found">
      <h2 className="text-base font-bold text-white/90 mb-2">{t('deviceScan.found')}</h2>
      {rating && AREAS.map((area) => {
        const lines = rating.findings.filter((f) => f.area === area);
        if (!lines.length) return null;
        const lvl = rating.areas[area];
        const id = `ds-area-${area}`;
        return (
          <div
            key={area}
            {...focusProps(id)}
            data-device-scan-area={area}
            data-level={lvl ?? 'none'}
            data-focused={currentFocusId === id ? 'true' : 'false'}
            className="tv-ring rounded-xl px-4 py-2 mb-2 bg-slate-900/70 border border-white/10 outline-none"
          >
            <div className="flex items-center mb-1">
              <span className="text-base font-bold flex-1 min-w-0 truncate">{t(`deviceScan.area.${area}`)}</span>
              <span className={`inline-flex items-center text-sm font-semibold ${lvl ? TEXT[lvl] : 'text-white/60'}`}>
                <span aria-hidden="true" className={`w-3 h-3 rounded-full mr-1.5 ${lvl ? DOT[lvl] : 'bg-white/30'}`} />
                {t(`deviceScan.level.${lvl ?? 'none'}`)}
              </span>
            </div>
            <ul>
              {lines.map((f) => (
                <li key={f.key} data-finding={f.key} data-level={f.level ?? 'none'} className="py-0.5">
                  <span className="flex items-start text-sm">
                    <span aria-hidden="true" className={`w-2.5 h-2.5 rounded-full mt-1.5 mr-2 flex-shrink-0 ${f.level ? DOT[f.level] : 'bg-white/25'}`} />
                    <span dir="auto" className="min-w-0">{t(`deviceScan.find.${f.key}`, f.params ?? {})}</span>
                  </span>
                  {needsReason(f) && (
                    <span data-why={f.key} className={`block text-xs ml-[1.125rem] leading-snug ${TEXT[f.level as Level]}`}>
                      {t(`deviceScan.why.${f.key}`)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );

  let pickIndex = -1;
  const suggestions = (
    <section className="min-w-0" data-device-scan-picks="" data-howto="ds.picks">
      <h2 className="text-base font-bold text-white/90 mb-2">{t('deviceScan.picks.title')}</h2>
      {groups.length === 0 && <p className="text-sm text-white/70 px-1">{t('deviceScan.picks.none')}</p>}
      {groups.map((g) => (
        <div key={g.category} data-pick-category={g.category} data-highlighted={g.highlighted ? 'true' : 'false'} className="mb-3">
          <div className="flex items-center mb-1">
            <span className="text-sm font-bold uppercase tracking-wide text-white/80 flex-1 min-w-0 truncate">{t(`deviceScan.cat.${g.category}`)}</span>
            {g.highlighted && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-400/40">{t('deviceScan.picks.worthALook')}</span>
            )}
          </div>
          {g.tiers.map((tr) => tr.picks.map((p) => {
            pickIndex += 1;
            const id = `ds-pick-${pickIndex}`;
            return (
              <div
                key={id}
                {...focusProps(id)}
                data-device-pick={pickIndex}
                data-focused={currentFocusId === id ? 'true' : 'false'}
                className={`tv-ring min-h-[2.5rem] rounded-lg px-3 py-1.5 mb-1 flex flex-wrap items-center border outline-none ${g.highlighted ? 'bg-slate-800/80 border-orange-400/30' : 'bg-slate-900/70 border-white/10'}`}
              >
                <span className="w-16 flex-shrink-0 text-xs font-bold uppercase text-brand-ice">{t(`deviceScan.tier.${tr.tier}`)}</span>
                <span className="min-w-0 flex-1 basis-[10rem]">
                  <span dir="auto" className="block text-sm font-semibold leading-tight">{p.name}</span>
                  {p.why && <span dir="auto" className="block text-xs text-white/70 leading-snug">{p.why}</span>}
                </span>
              </div>
            );
          }))}
        </div>
      ))}
    </section>
  );

  return (
    <>
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        data-device-scan=""
        // The speed test is drawn by this screen at z-50: this layer steps aside while it is up.
        style={showSpeed ? { display: 'none' } : undefined}
        className="fixed top-0 left-0 right-0 bottom-0 z-[110] flex flex-col text-white bg-[#060d18]"
      >
        {header}
        <div className="tv-scroll-container flex-1 min-h-0 overflow-auto px-6 py-3">
          {overallCard}
          <div className="mt-3 md:grid md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-x-5">
            {found}
            <div className="mt-2 md:mt-0">{suggestions}</div>
          </div>
        </div>
      </div>
      {showSpeed && <SpeedTest onClose={() => setShowSpeed(false)} onResult={onSpeed} />}
      {sending && rating && scan && (
        <Suspense fallback={null}>
          <DeviceScanHelpForm
            signedIn={!!user}
            subject={ticketSubject(scan, rating)}
            summary={summary}
            onBack={() => setSending(false)}
            onOpenTickets={user ? onOpenTickets : undefined}
          />
        </Suspense>
      )}
    </>
  );
});

DeviceScanScreen.displayName = 'DeviceScanScreen';
export default DeviceScanScreen;
