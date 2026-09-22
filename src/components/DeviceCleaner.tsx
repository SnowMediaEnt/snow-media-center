import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Accessibility,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Cpu,
  HardDrive,
  Loader2,
  PackageX,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { gridNavigation, useTVFocus } from '@/hooks/useTVFocus';
import { isFireTV, isNativePlatform } from '@/utils/platform';
import { BackButton, BACK_ROW } from '@/components/ui/BackButton';
import {
  AppManager,
  type CachedApkInfo,
  type DeviceAppInfo,
  type DeviceStorageInfo,
} from '@/capacitor/AppManager';

interface DeviceCleanerProps {
  onBack: () => void;
}

/** Every control here carries a focus id and sits in the row grid below. */
const CLEANER_FOCUSABLE = '[data-tv-focus-id]';
/** How many apps the Fire TV "clear one at a time" list shows. */
const FIRE_LIST_MAX = 12;

const DAY = 24 * 60 * 60 * 1000;
/** Not opened in this long counts as unused. Two months is long enough that a
 *  seasonal app (a sports app in its off-season) is only ever *listed*, never
 *  removed without the viewer pressing Remove. */
const UNUSED_AFTER_DAYS = 60;
/** Below this an app's cache is not worth a trip through Settings. */
const CACHE_WORTH_CLEARING = 2 * 1024 * 1024;
/** One pass through Settings takes a few seconds per app, so the queue is
 *  capped: the biggest caches first, which is where nearly all the space is. */
const MAX_CACHE_QUEUE = 24;

/** Package names of the app stores a normal install comes from. */
const KNOWN_STORES = new Set([
  'com.android.vending',
  'com.amazon.venezia',
  'com.amazon.mShop.android',
  'com.amazon.mShop.android.shopping',
  'com.amazon.firebat',
  'com.amazon.tv.launcher',
  'com.google.android.packageinstaller',
  'com.android.packageinstaller',
  'com.google.android.feedback',
  'com.snowmedia.center',
  'com.snowmedia.app',
]);

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value.toFixed(value >= 100 || i <= 1 ? 0 : 1)} ${units[i]}`;
};

const formatAgo = (ms: number): string => {
  if (!ms) return 'never opened';
  const days = Math.floor((Date.now() - ms) / DAY);
  if (days <= 0) return 'used today';
  if (days === 1) return 'used yesterday';
  if (days < 30) return `last used ${days} days ago`;
  const months = Math.round(days / 30);
  return `last used about ${months} ${months === 1 ? 'month' : 'months'} ago`;
};

type RunPhase = 'idle' | 'junk' | 'memory' | 'caches' | 'done';

interface RunState {
  phase: RunPhase;
  /** Apps whose cache the Accessibility Service still has to walk. */
  total: number;
  done: number;
  current: string;
  /** What the run has freed or dealt with so far, newest last. */
  lines: string[];
  cancelled: boolean;
}

const emptyRun: RunState = { phase: 'idle', total: 0, done: 0, current: '', lines: [], cancelled: false };

const LAST_RUN_KEY = 'smc-cleaner-last-run';

const DeviceCleaner = ({ onBack }: DeviceCleanerProps) => {
  const { toast } = useToast();
  const native = isNativePlatform();
  // Fire OS has no screen where a third-party accessibility service can be
  // switched on, so the automatic cache pass can never run there. Everything
  // else works; caches go through Fire TV's own per-app page instead.
  const fireTv = native && isFireTV();

  const [loading, setLoading] = useState(true);
  const [storage, setStorage] = useState<DeviceStorageInfo | null>(null);
  const [apps, setApps] = useState<DeviceAppInfo[]>([]);
  const [usageAccess, setUsageAccess] = useState(false);
  const [a11y, setA11y] = useState(false);
  const [leftovers, setLeftovers] = useState<CachedApkInfo[]>([]);
  const [leftoverBytes, setLeftoverBytes] = useState(0);
  const [run, setRun] = useState<RunState>(emptyRun);
  const [lastRun, setLastRun] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_RUN_KEY); } catch { return null; }
  });

  const busy = run.phase !== 'idle' && run.phase !== 'done';

  const readDevice = useCallback(async (quiet = false) => {
    if (!native) { setLoading(false); return; }
    if (!quiet) setLoading(true);
    try {
      const [info, list, a11yState, cached] = await Promise.all([
        AppManager.getStorageInfo().catch(() => null),
        AppManager.getDeviceApps().catch(() => ({ apps: [] as DeviceAppInfo[], usageAccess: false })),
        AppManager.isAccessibilityEnabled().catch(() => ({ enabled: false })),
        AppManager.listCachedApks().catch(() => ({ files: [] as CachedApkInfo[], totalBytes: 0, count: 0 })),
      ]);
      if (info) setStorage(info);
      setApps(list.apps || []);
      setUsageAccess(!!list.usageAccess);
      setA11y(!!a11yState.enabled);
      setLeftovers(cached.files || []);
      setLeftoverBytes(cached.totalBytes || 0);
    } catch (e) {
      console.error('[DeviceCleaner] read failed:', e);
    } finally {
      setLoading(false);
    }
  }, [native]);

  useEffect(() => { void readDevice(); }, [readDevice]);

  // Coming back from Settings — the viewer may have just granted a permission,
  // and a cache run changes the numbers while we are in the background.
  useEffect(() => {
    if (!native) return;
    let handle: { remove: () => void | Promise<void> } | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const h = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) void readDevice(true);
        });
        if (cancelled) { void h.remove(); return; }
        handle = h;
      } catch { /* @capacitor/app missing on web */ }
    })();
    return () => { cancelled = true; if (handle) void handle.remove(); };
  }, [native, readDevice]);

  const appName = useCallback((pkg: string) => {
    const hit = apps.find((a) => a.packageName === pkg);
    return hit?.appName || pkg;
  }, [apps]);

  // ---- findings -----------------------------------------------------------

  const cacheTotal = useMemo(
    () => apps.reduce((sum, a) => sum + (a.cacheBytes > 0 ? a.cacheBytes : 0), 0),
    [apps],
  );

  /** The apps a cache pass should visit: biggest caches first when the sizes
   *  are known, everything third-party when they are not. */
  const cacheTargets = useMemo(() => {
    if (usageAccess && apps.some((a) => a.cacheBytes > 0)) {
      return apps
        .filter((a) => a.cacheBytes >= CACHE_WORTH_CLEARING)
        .sort((a, b) => b.cacheBytes - a.cacheBytes)
        .slice(0, MAX_CACHE_QUEUE);
    }
    return apps.filter((a) => a.isLaunchable).slice(0, MAX_CACHE_QUEUE);
  }, [apps, usageAccess]);

  const unused = useMemo(() => {
    if (!usageAccess) return [];
    const cutoff = Date.now() - UNUSED_AFTER_DAYS * DAY;
    return apps
      .filter((a) => a.isLaunchable && (a.lastUsedAt === 0 || a.lastUsedAt < cutoff))
      // Installed in the last fortnight and not opened yet is not "unused".
      .filter((a) => a.installedAt === 0 || a.installedAt < Date.now() - 14 * DAY)
      .sort((a, b) => (b.appBytes + b.dataBytes) - (a.appBytes + a.dataBytes));
  }, [apps, usageAccess]);

  /** Apps that did not come from a store, and apps with no way to open them.
   *  Nothing here is called malware — the screen says what it can see and lets
   *  the viewer decide, which is the honest version of an "adware scan". */
  const unvetted = useMemo(
    () => apps.filter((a) => !KNOWN_STORES.has(a.installer) || !a.isLaunchable),
    [apps],
  );

  const totalReclaimable = cacheTotal + leftoverBytes
    + unused.reduce((s, a) => s + Math.max(0, a.appBytes) + Math.max(0, a.dataBytes), 0);

  // ---- cache queue progress ----------------------------------------------

  const finishRun = useCallback((lines: string[]) => {
    const summary = lines.join(' · ');
    setRun({ ...emptyRun, phase: 'done', lines });
    try {
      const stamp = `${new Date().toLocaleString()} — ${summary}`;
      localStorage.setItem(LAST_RUN_KEY, stamp);
      setLastRun(stamp);
    } catch { /* storage full or blocked */ }
    void readDevice(true);
  }, [readDevice]);

  useEffect(() => {
    if (!native) return;
    let progressHandle: { remove: () => void | Promise<void> } | null = null;
    let doneHandle: { remove: () => void | Promise<void> } | null = null;
    let cancelled = false;
    void (async () => {
      const p = await AppManager.addListener('cacheClearProgress', ({ packageName, done, total }) => {
        setRun((r) => (r.phase === 'caches'
          ? { ...r, done, total: total || r.total, current: packageName }
          : r));
      });
      const d = await AppManager.addListener('cacheClearDone', ({ done, total }) => {
        setRun((r) => {
          if (r.phase !== 'caches') return r;
          const lines = [...r.lines, `caches cleared on ${done} of ${total} apps`];
          // finishRun runs outside the reducer so the storage re-read happens once.
          setTimeout(() => finishRun(lines), 0);
          return { ...r, done, current: '' };
        });
      });
      if (cancelled) { void p.remove(); void d.remove(); return; }
      progressHandle = p; doneHandle = d;
    })();
    return () => {
      cancelled = true;
      if (progressHandle) void progressHandle.remove();
      if (doneHandle) void doneHandle.remove();
    };
  }, [native, finishRun]);

  // ---- the individual jobs ------------------------------------------------

  const clearJunk = useCallback(async (): Promise<{ freed: number; count: number }> => {
    let freed = 0; let count = 0;
    for (const file of leftovers) {
      try {
        const { deleted } = await AppManager.deleteCachedApk({ name: file.name });
        if (deleted) { freed += file.sizeBytes; count += 1; }
      } catch (e) {
        console.warn('[DeviceCleaner] leftover delete failed:', e);
      }
    }
    try {
      const { freedBytes } = await AppManager.clearOwnCache();
      freed += freedBytes || 0;
    } catch { /* nothing to clear */ }
    return { freed, count };
  }, [leftovers]);

  const closeBackground = useCallback(async (): Promise<{ asked: number; freed: number }> => {
    const res = await AppManager.closeBackgroundApps();
    if (res.freeMemoryBytes && res.totalMemoryBytes) {
      setStorage((s) => (s ? { ...s, freeMemoryBytes: res.freeMemoryBytes, totalMemoryBytes: res.totalMemoryBytes } : s));
    }
    return { asked: res.asked || 0, freed: res.freedMemoryBytes || 0 };
  }, []);

  /** Starts the cache pass. Resolves true when it is now running (or finished
   *  silently on a rooted box), false when the device cannot do it. */
  const startCachePass = useCallback(async (lines: string[]): Promise<boolean> => {
    if (fireTv) {
      finishRun([...lines, 'app caches: pick an app in the Fire TV list below to clear its cache']);
      toast({
        title: 'Caches are one app at a time on Fire TV',
        description: 'Pick an app in the list further down and choose Clear cache on the page that opens.',
      });
      return true;
    }
    const packages = cacheTargets.map((a) => a.packageName);
    if (!packages.length) {
      finishRun([...lines, 'no app caches worth clearing']);
      return true;
    }
    setRun({ phase: 'caches', total: packages.length, done: 0, current: '', lines, cancelled: false });
    try {
      const res = await AppManager.clearCacheForApps({ packages });
      if (res.method === 'root' || res.queued === 0) {
        finishRun([...lines, `caches cleared on ${res.rootCleared} apps`]);
        return true;
      }
      setRun((r) => ({ ...r, total: res.queued }));
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/ACCESSIBILITY_DISABLED/.test(msg)) {
        finishRun(lines);
        setA11y(false);
        toast({
          title: 'Turn on cache cleaning first',
          description: 'Switch on Snow Media Cache Cleaner under Accessibility. The button at the bottom of this screen opens that list.',
        });
        return false;
      }
      finishRun(lines);
      toast({ title: 'Could not clear caches', description: msg, variant: 'destructive' });
      return false;
    }
  }, [cacheTargets, finishRun, fireTv, toast]);

  // ---- the buttons --------------------------------------------------------

  const cleanEverything = useCallback(async () => {
    if (busy) return;
    const lines: string[] = [];

    setRun({ ...emptyRun, phase: 'junk' });
    const junk = await clearJunk();
    if (junk.freed > 0) lines.push(`${formatBytes(junk.freed)} of leftover files removed`);

    setRun((r) => ({ ...r, phase: 'memory', lines }));
    try {
      const mem = await closeBackground();
      lines.push(mem.freed > 0
        ? `${formatBytes(mem.freed)} of memory freed`
        : `${mem.asked} apps asked to stop background work`);
    } catch (e) {
      console.warn('[DeviceCleaner] closeBackgroundApps:', e);
    }

    await startCachePass(lines);
  }, [busy, clearJunk, closeBackground, startCachePass]);

  /** The apps the Fire TV list offers: biggest caches first when known,
   *  otherwise the apps a person actually opens. */
  const fireTargets = useMemo(() => cacheTargets.slice(0, FIRE_LIST_MAX), [cacheTargets]);

  const openManageApps = useCallback(async () => {
    try {
      const { opened } = await AppManager.openManageApps();
      if (opened) return;
    } catch { /* fall through to the single-app page */ }
    if (fireTargets[0]) {
      try {
        await AppManager.openAppSettings({ packageName: fireTargets[0].packageName, appName: fireTargets[0].appName });
        return;
      } catch { /* reported below */ }
    }
    toast({
      title: 'Could not open the app list',
      description: 'On the Fire TV home screen go to Settings → Applications → Manage Installed Applications, pick an app, then Clear cache.',
    });
  }, [fireTargets, toast]);

  const cachesOnly = useCallback(async () => {
    if (busy) return;
    if (fireTv) { await openManageApps(); return; }
    await startCachePass([]);
  }, [busy, fireTv, openManageApps, startCachePass]);

  const junkOnly = useCallback(async () => {
    if (busy) return;
    setRun({ ...emptyRun, phase: 'junk' });
    const junk = await clearJunk();
    finishRun([junk.freed > 0
      ? `${formatBytes(junk.freed)} of leftover files removed`
      : 'no leftover files to remove']);
  }, [busy, clearJunk, finishRun]);

  const memoryOnly = useCallback(async () => {
    if (busy) return;
    setRun({ ...emptyRun, phase: 'memory' });
    try {
      const mem = await closeBackground();
      finishRun([mem.freed > 0
        ? `${formatBytes(mem.freed)} of memory freed`
        : `${mem.asked} apps asked to stop background work`]);
    } catch (e) {
      setRun(emptyRun);
      toast({
        title: 'Could not close background apps',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  }, [busy, closeBackground, finishRun, toast]);

  const cancelRun = useCallback(async () => {
    try { await AppManager.cancelCacheClear(); } catch { /* nothing queued */ }
    setRun((r) => ({ ...emptyRun, phase: 'done', lines: [...r.lines, 'stopped'] }));
  }, []);

  const removeApp = useCallback(async (app: DeviceAppInfo) => {
    try {
      const res = await AppManager.uninstall({ packageName: app.packageName });
      if (res.uninstalled) {
        toast({ title: 'Removed', description: `${app.appName} is gone.` });
        setApps((list) => list.filter((a) => a.packageName !== app.packageName));
        void readDevice(true);
      } else if (res.cancelled) {
        toast({ title: 'Kept', description: `${app.appName} is still installed.` });
      }
    } catch (e) {
      toast({
        title: 'Could not remove it',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  }, [readDevice, toast]);

  const openInfo = useCallback(async (app: DeviceAppInfo) => {
    try {
      await AppManager.openAppSettings({ packageName: app.packageName, appName: app.appName });
    } catch (e) {
      toast({
        title: 'Could not open App Info',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  }, [toast]);

  const openA11y = useCallback(async () => {
    try { await AppManager.openAccessibilitySettings(); } catch {
      toast({ title: 'Open it by hand', description: 'Android Settings → Accessibility → Snow Media Cache Cleaner.' });
    }
  }, [toast]);

  const openUsage = useCallback(async () => {
    try {
      const { opened } = await AppManager.openUsageAccessSettings();
      if (!opened) {
        toast({
          title: 'This box has no usage screen',
          description: 'Cache clearing and background closing still work. Sizes and last-used dates will stay hidden.',
        });
      }
    } catch (e) {
      toast({ title: 'Could not open that screen', description: e instanceof Error ? e.message : String(e) });
    }
  }, [toast]);

  // The highlight walks rows, never the nearest thing on screen. Rows that
  // are not rendered right now (Stop while idle, the gate on Fire TV, list
  // entries past what is installed) are skipped at press time.
  const rows = useMemo<string[][]>(() => {
    const r: string[][] = [['cleaner-back', 'cleaner-refresh']];
    if (busy) {
      r.push(['cleaner-stop']);
    } else {
      r.push(['cleaner-all']);
      r.push(['cleaner-caches', 'cleaner-memory']);
      r.push(['cleaner-junk', 'cleaner-usage']);
    }
    if (fireTv) {
      r.push(['cleaner-fire-list']);
      fireTargets.forEach((_, i) => r.push([`cleaner-fire-app-${i}`]));
    } else if (!a11y) {
      r.push(['cleaner-gate-a11y']);
    }
    unused.slice(0, 12).forEach((_, i) => r.push([`cleaner-unused-info-${i}`, `cleaner-unused-remove-${i}`]));
    unvetted.slice(0, 12).forEach((_, i) => r.push([`cleaner-check-info-${i}`, `cleaner-check-remove-${i}`]));
    return r;
  }, [a11y, busy, fireTargets, fireTv, unused, unvetted]);
  const navigation = useMemo(() => gridNavigation(rows), [rows]);

  const focus = useTVFocus({
    focusableSelector: CLEANER_FOCUSABLE,
    navigation,
    initialFocusId: 'cleaner-back',
    scrollWhenStuck: true,
    onBack,
  });

  // ---- the screen ---------------------------------------------------------

  const usedBytes = storage ? Math.max(0, storage.totalBytes - storage.freeBytes) : 0;
  const usedPct = storage && storage.totalBytes > 0 ? Math.min(100, Math.round((usedBytes / storage.totalBytes) * 100)) : 0;
  const memUsedPct = storage && storage.totalMemoryBytes > 0
    ? Math.min(100, Math.round(((storage.totalMemoryBytes - storage.freeMemoryBytes) / storage.totalMemoryBytes) * 100))
    : 0;
  const storageTight = usedPct >= 90 || (storage ? storage.freeBytes < 700 * 1024 * 1024 : false);

  const phaseLabel = run.phase === 'junk' ? 'Clearing leftover files…'
    : run.phase === 'memory' ? 'Closing background apps…'
    : run.phase === 'caches' ? `Clearing app caches — ${run.done} of ${run.total}`
    : '';

  const bar = (pct: number, tight: boolean) => (
    <div className="h-3 w-full rounded-full bg-white/10 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${tight ? 'bg-rose-400' : 'bg-emerald-400'}`}
        style={{ width: `${Math.max(2, pct)}%` }}
      />
    </div>
  );

  // text-white on both: the Card primitive sets text-card-foreground, which
  // is the light theme's charcoal, and the outline Button inherits it. Every
  // title without its own colour class was charcoal on blue — unreadable on
  // a TV across the room.
  const card = 'bg-white/5 border-white/15 p-5 text-white';
  const action = 'h-16 justify-start text-left px-5 text-lg tv-ring text-white';

  return (
    <div
      ref={focus.containerRef}
      className="fixed inset-0 tv-scroll-container tv-safe text-white overflow-y-auto overscroll-contain"
    >
      <div className={BACK_ROW}>
        <BackButton
          onClick={onBack}
          label="Back to Support"
          data-tv-focus-id="cleaner-back"
          focused={focus.currentFocusId === 'cleaner-back'}
        />
      </div>

      <div className="max-w-5xl mx-auto w-full space-y-5 pb-16">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              <Sparkles className="w-8 h-8 text-brand-gold" />
              Device Cleaner
            </h1>
            <p className="text-white/70 mt-1">
              Frees space and memory on this box. Nothing you are signed into gets signed out.
            </p>
          </div>
          <Button
            onClick={() => void readDevice()}
            variant="outline"
            size="lg"
            disabled={loading || busy}
            data-tv-focus-id="cleaner-refresh"
            className="tv-ring border-white/25 bg-white/5"
          >
            {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <RefreshCw className="w-5 h-5 mr-2" />}
            Check again
          </Button>
        </div>

        {!native && (
          <Card className={card}>
            <p className="text-white/80">
              The cleaner only works inside the installed Snow Media Center app on your TV box.
            </p>
          </Card>
        )}

        {native && (
          <>
            {/* Storage and memory */}
            <Card className={card}>
              <div className="grid gap-5 md:grid-cols-2">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center gap-2 font-semibold text-lg">
                      <HardDrive className="w-5 h-5 text-cyan-300" /> Storage
                    </span>
                    <span className={storageTight ? 'text-rose-300 font-semibold' : 'text-white/70'}>
                      {storage ? `${formatBytes(storage.freeBytes)} free` : '—'}
                    </span>
                  </div>
                  {bar(usedPct, storageTight)}
                  <p className="text-sm text-white/60 mt-2">
                    {storage ? `${formatBytes(usedBytes)} of ${formatBytes(storage.totalBytes)} used` : 'Reading…'}
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center gap-2 font-semibold text-lg">
                      <Cpu className="w-5 h-5 text-violet-300" /> Memory
                    </span>
                    <span className={storage?.lowMemory ? 'text-rose-300 font-semibold' : 'text-white/70'}>
                      {storage ? `${formatBytes(storage.freeMemoryBytes)} free` : '—'}
                    </span>
                  </div>
                  {bar(memUsedPct, !!storage?.lowMemory)}
                  <p className="text-sm text-white/60 mt-2">
                    {storage?.lowMemory ? 'The box is short on memory right now.' : 'Closing background apps frees more.'}
                  </p>
                </div>
              </div>
              {storageTight && (
                <p className="mt-4 flex items-start gap-2 text-rose-200">
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                  This box is nearly full. That is what makes app updates fail with
                  &ldquo;App not installed&rdquo; and streams stutter — clean it and try again.
                </p>
              )}
            </Card>

            {/* The run */}
            <Card className={card}>
              {busy ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-lg font-semibold">
                    <Loader2 className="w-6 h-6 animate-spin text-brand-gold" />
                    {phaseLabel}
                  </div>
                  {run.phase === 'caches' && (
                    <>
                      {bar(run.total ? Math.round((run.done / run.total) * 100) : 5, false)}
                      <p className="text-white/70">
                        {run.current
                          ? `Working through ${appName(run.current)} — Settings opens and closes by itself. Leave the remote alone.`
                          : 'Settings will open by itself. Leave the remote alone until it comes back.'}
                      </p>
                    </>
                  )}
                  {run.lines.length > 0 && (
                    <ul className="text-white/70 text-sm space-y-1">
                      {run.lines.map((l) => (
                        <li key={l} className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> {l}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button
                    onClick={() => void cancelRun()}
                    variant="outline"
                    size="lg"
                    data-tv-focus-id="cleaner-stop"
                    className="tv-ring border-white/25 bg-white/5"
                  >
                    <XCircle className="w-5 h-5 mr-2" /> Stop
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {run.phase === 'done' && run.lines.length > 0 && (
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/40 p-4">
                      <p className="font-semibold flex items-center gap-2 mb-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Done
                      </p>
                      <ul className="text-white/80 space-y-1">
                        {run.lines.map((l) => <li key={l}>{l}</li>)}
                      </ul>
                    </div>
                  )}
                  <div className="grid gap-3 md:grid-cols-2">
                    <Button
                      onClick={() => void cleanEverything()}
                      size="lg"
                      data-tv-focus-id="cleaner-all"
                      className={`${action} md:col-span-2 h-20 bg-brand-gold text-black hover:brightness-110 tv-ring-contrast`}
                    >
                      <Sparkles className="w-7 h-7 mr-4 shrink-0" />
                      <span className="grid gap-0.5">
                        <span className="text-xl font-bold">Clean this box</span>
                        <span className="text-sm font-medium opacity-80">
                          Leftover files, background apps, then every app cache
                          {totalReclaimable > 0 ? ` — about ${formatBytes(totalReclaimable)} in reach` : ''}
                        </span>
                      </span>
                    </Button>
                    <Button
                      onClick={() => void cachesOnly()}
                      variant="outline"
                      size="lg"
                      data-tv-focus-id="cleaner-caches"
                      className={`${action} border-white/20 bg-white/5`}
                    >
                      <Trash2 className="w-6 h-6 mr-3 shrink-0 text-cyan-300" />
                      <span className="grid gap-0.5">
                        <span className="font-semibold">Clear app caches</span>
                        <span className="text-sm text-white/60">
                          {fireTv
                            ? 'Opens Fire TV\u2019s app list'
                            : `${cacheTargets.length} app${cacheTargets.length === 1 ? '' : 's'}${cacheTotal > 0 ? ` · ${formatBytes(cacheTotal)}` : ''}`}
                        </span>
                      </span>
                    </Button>
                    <Button
                      onClick={() => void memoryOnly()}
                      variant="outline"
                      size="lg"
                      data-tv-focus-id="cleaner-memory"
                      className={`${action} border-white/20 bg-white/5`}
                    >
                      <Cpu className="w-6 h-6 mr-3 shrink-0 text-violet-300" />
                      <span className="grid gap-0.5">
                        <span className="font-semibold">Close background apps</span>
                        <span className="text-sm text-white/60">Frees memory for the player</span>
                      </span>
                    </Button>
                    <Button
                      onClick={() => void junkOnly()}
                      variant="outline"
                      size="lg"
                      disabled={leftovers.length === 0}
                      data-tv-focus-id="cleaner-junk"
                      className={`${action} border-white/20 bg-white/5`}
                    >
                      <PackageX className="w-6 h-6 mr-3 shrink-0 text-amber-300" />
                      <span className="grid gap-0.5">
                        <span className="font-semibold">Remove leftover installers</span>
                        <span className="text-sm text-white/60">
                          {leftovers.length
                            ? `${leftovers.length} file${leftovers.length === 1 ? '' : 's'} · ${formatBytes(leftoverBytes)}`
                            : 'Nothing left behind'}
                        </span>
                      </span>
                    </Button>
                    <Button
                      onClick={() => void openUsage()}
                      variant="outline"
                      size="lg"
                      data-tv-focus-id="cleaner-usage"
                      className={`${action} border-white/20 bg-white/5`}
                    >
                      <BarChart3 className="w-6 h-6 mr-3 shrink-0 text-emerald-300" />
                      <span className="grid gap-0.5">
                        <span className="font-semibold">{usageAccess ? 'App usage is on' : 'Show app sizes'}</span>
                        <span className="text-sm text-white/60">
                          {usageAccess ? 'Sizes and last-used dates are visible' : 'Needed to find unused apps'}
                        </span>
                      </span>
                    </Button>
                  </div>
                  {lastRun && run.phase !== 'done' && (
                    <p className="text-sm text-white/50">Last clean: {lastRun}</p>
                  )}
                </div>
              )}
            </Card>

            {/* Fire TV: no switch exists, so caches go through Amazon's own app page */}
            {fireTv && (
              <Card className={`${card} border-sky-400/40 bg-sky-400/10`}>
                <p className="font-semibold text-lg flex items-center gap-2 mb-2">
                  <Settings2 className="w-6 h-6 text-sky-300" /> Fire TV clears caches one app at a time
                </p>
                <p className="text-white/80 mb-4">
                  Fire TV has no setting that lets another app empty caches for you, so the Cleaner
                  takes you to Fire TV&rsquo;s own page for each app instead. Pick an app below, choose
                  <span className="font-semibold text-white"> Clear cache </span>
                  on the page that opens, then press Back to land straight back here. Leftover
                  files and background apps are still cleared in one press.
                </p>
                <Button
                  onClick={() => void openManageApps()}
                  size="lg"
                  data-tv-focus-id="cleaner-fire-list"
                  className="h-16 px-6 text-lg bg-sky-500 text-black hover:brightness-110 tv-ring tv-ring-contrast"
                >
                  <Settings2 className="w-6 h-6 mr-3" /> Open Fire TV&rsquo;s app list
                </Button>
                {fireTargets.length > 0 && (
                  <div className="space-y-2 mt-4">
                    {fireTargets.map((app, i) => (
                      <div
                        key={app.packageName}
                        className="flex items-center gap-3 rounded-lg bg-black/25 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold truncate">{app.appName}</p>
                          <p className="text-sm text-white/60 truncate">
                            {app.cacheBytes > 0 ? `${formatBytes(app.cacheBytes)} of cache` : 'Cache size is hidden on Fire TV'}
                          </p>
                        </div>
                        <Button
                          onClick={() => void openInfo(app)}
                          variant="outline"
                          size="sm"
                          data-tv-focus-id={`cleaner-fire-app-${i}`}
                          className="tv-ring border-white/20 bg-white/5"
                        >
                          <Trash2 className="w-4 h-4 mr-2" /> Clear cache
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* Accessibility gate */}
            {!a11y && !fireTv && (
              <Card className={`${card} border-amber-400/40 bg-amber-400/10`}>
                <p className="font-semibold text-lg flex items-center gap-2 mb-2">
                  <Accessibility className="w-6 h-6 text-amber-300" /> One switch to turn on
                </p>
                <p className="text-white/80 mb-4">
                  Android will not let any app empty another app&rsquo;s cache on its own. In the list
                  that opens, find
                  <span className="font-semibold text-white"> Snow Media Cache Cleaner </span>
                  and switch it on — then come back here and press Clean. It only ever taps
                  &ldquo;Clear cache&rdquo;, never &ldquo;Clear data&rdquo;, and you can switch it off again
                  whenever you like. Everything else on this screen works without it.
                </p>
                <Button
                  onClick={() => void openA11y()}
                  size="lg"
                  data-tv-focus-id="cleaner-gate-a11y"
                  className="h-16 px-6 text-lg bg-amber-500 text-black hover:brightness-110 tv-ring tv-ring-contrast"
                >
                  <Settings2 className="w-6 h-6 mr-3" /> Open Accessibility Settings
                </Button>
              </Card>
            )}

            {/* Unused apps */}
            <Card className={card}>
              <p className="font-semibold text-lg flex items-center gap-2 mb-1">
                <PackageX className="w-6 h-6 text-orange-300" /> Apps nobody opens
              </p>
              {!usageAccess ? (
                <p className="text-white/70">
                  Turn on app usage above and this box will list what has not been opened in
                  {' '}{UNUSED_AFTER_DAYS} days, with what each one takes up.
                </p>
              ) : unused.length === 0 ? (
                <p className="text-white/70">Everything installed here gets used. Nothing to remove.</p>
              ) : (
                <div className="space-y-2 mt-3">
                  {unused.slice(0, 12).map((app, i) => (
                    <div
                      key={app.packageName}
                      className="flex items-center gap-3 rounded-lg bg-black/25 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{app.appName}</p>
                        <p className="text-sm text-white/60 truncate">
                          {formatAgo(app.lastUsedAt)}
                          {app.appBytes > 0 ? ` · ${formatBytes(app.appBytes + Math.max(0, app.dataBytes))}` : ''}
                        </p>
                      </div>
                      <Button
                        onClick={() => void openInfo(app)}
                        variant="outline"
                        size="sm"
                        data-tv-focus-id={`cleaner-unused-info-${i}`}
                        className="tv-ring border-white/20 bg-white/5"
                      >
                        Details
                      </Button>
                      <Button
                        onClick={() => void removeApp(app)}
                        variant="outline"
                        size="sm"
                        data-tv-focus-id={`cleaner-unused-remove-${i}`}
                        className="tv-ring border-rose-400/50 bg-rose-500/20 text-white"
                      >
                        <Trash2 className="w-4 h-4 mr-2" /> Remove
                      </Button>
                    </div>
                  ))}
                  {unused.length > 12 && (
                    <p className="text-sm text-white/50">
                      {unused.length - 12} more, smallest first — clean the big ones and check again.
                    </p>
                  )}
                </div>
              )}
            </Card>

            {/* Sideloads and apps with no way in */}
            <Card className={card}>
              <p className="font-semibold text-lg flex items-center gap-2 mb-1">
                <ShieldAlert className="w-6 h-6 text-rose-300" /> Worth a look
              </p>
              <p className="text-white/70">
                Apps that did not come from a store, and apps with no way to open them. Most are
                harmless — a sideload you asked for, or a helper another app installed. The ads and
                pop-ups people blame on their box are usually one of these.
              </p>
              {unvetted.length === 0 ? (
                <p className="text-white/70 mt-3">Nothing unexpected is installed.</p>
              ) : (
                <div className="space-y-2 mt-3">
                  {unvetted.slice(0, 12).map((app, i) => (
                    <div
                      key={app.packageName}
                      className="flex items-center gap-3 rounded-lg bg-black/25 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{app.appName}</p>
                        <p className="text-sm text-white/60 truncate">
                          {app.isLaunchable ? 'Installed from outside a store' : 'No way to open it'}
                          {app.appBytes > 0 ? ` · ${formatBytes(app.appBytes + Math.max(0, app.dataBytes))}` : ''}
                        </p>
                      </div>
                      <Button
                        onClick={() => void openInfo(app)}
                        variant="outline"
                        size="sm"
                        data-tv-focus-id={`cleaner-check-info-${i}`}
                        className="tv-ring border-white/20 bg-white/5"
                      >
                        Details
                      </Button>
                      <Button
                        onClick={() => void removeApp(app)}
                        variant="outline"
                        size="sm"
                        data-tv-focus-id={`cleaner-check-remove-${i}`}
                        className="tv-ring border-rose-400/50 bg-rose-500/20 text-white"
                      >
                        <Trash2 className="w-4 h-4 mr-2" /> Remove
                      </Button>
                    </div>
                  ))}
                  {unvetted.length > 12 && (
                    <p className="text-sm text-white/50">{unvetted.length - 12} more not shown.</p>
                  )}
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

export default DeviceCleaner;
