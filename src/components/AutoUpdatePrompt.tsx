import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download, X, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { isNativePlatform } from '@/utils/platform';
import { robustFetch } from '@/utils/network';
import { useVersion } from '@/hooks/useVersion';

interface UpdateInfo {
  version: string;
  versionCode?: number;
  downloadUrl: string;
  changelog?: string;
  releaseDate?: string;
  size?: string;
}

const AUTO_UPDATE_KEY = 'smc-auto-update-enabled';
const SNOOZE_KEY = 'smc-auto-update-snooze-version';

const isVersionNewer = (a: string, b: string): boolean => {
  const ap = a.split('.').map(Number);
  const bp = b.split('.').map(Number);
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const x = ap[i] || 0;
    const y = bp[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
};

/**
 * Background auto-update checker. On app launch (and again every hour) it
 * checks update.json. If a newer version exists and the user hasn't snoozed
 * that exact version, a small popup asks "Install now / Later".
 *
 * Auto-update is ON by default. Users can disable it via Settings → Updates
 * (key: smc-auto-update-enabled = "false").
 */
const AutoUpdatePrompt = () => {
  const { version: currentVersion, versionCode: currentVersionCode, isLoading } = useVersion();
  const { toast } = useToast();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (isLoading) return;
    const enabled = localStorage.getItem(AUTO_UPDATE_KEY);
    if (enabled === 'false') return; // user opted out
    if (!isNativePlatform()) return; // only meaningful inside the installed app

    let cancelled = false;
    const check = async () => {
      try {
        const url = `https://snowmediaapps.com/smc/update.json?ts=${Date.now()}`;
        const res = await robustFetch(url, {
          timeout: 15000,
          retries: 2,
          useCorsProxy: false,
          headers: { Accept: 'application/json' },
        });
        const text = await res.text();
        let data: UpdateInfo;
        try {
          const parsed = JSON.parse(text);
          data = parsed.contents ? JSON.parse(parsed.contents) : parsed;
        } catch {
          return;
        }
        if (!data?.version || !data?.downloadUrl) return;

        const newerByCode =
          !!data.versionCode && !!currentVersionCode && data.versionCode > currentVersionCode;
        const newerByName = data.version !== currentVersion && isVersionNewer(data.version, currentVersion);
        if (!newerByCode && !newerByName) return;

        const snoozed = localStorage.getItem(SNOOZE_KEY);
        if (snoozed === data.version) return; // user said "Later" for this exact version

        if (cancelled) return;
        setInfo(data);
        setOpen(true);
      } catch (err) {
        console.log('[AutoUpdatePrompt] check failed', err);
      }
    };

    // Run shortly after launch, then hourly
    const t = setTimeout(check, 4000);
    const interval = setInterval(check, 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearInterval(interval);
    };
  }, [currentVersion, currentVersionCode, isLoading]);

  // Auto-focus primary button
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-autoupdate-primary="true"]');
      btn?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [open]);

  const snooze = () => {
    if (info?.version) {
      try {
        localStorage.setItem(SNOOZE_KEY, info.version);
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
  };

  const installNow = async () => {
    if (!info || installing) return;
    setInstalling(true);
    setProgress(0);
    try {
      const fileName = `snow_media_center_${info.version}.apk`;
      const { downloadApkToCache } = await import('@/utils/downloadApk');
      const { AppManager } = await import('@/capacitor/AppManager');

      const filePath = await downloadApkToCache(info.downloadUrl, fileName, (pct) =>
        setProgress(pct),
      );

      // Verify the APK matches the advertised version before launching the installer
      const apkInfo = await AppManager.getApkInfo({ filePath });
      if (apkInfo.versionName && apkInfo.versionName !== info.version) {
        throw new Error(
          `Downloaded APK is v${apkInfo.versionName}, but update lists v${info.version}`,
        );
      }

      toast({
        title: 'Update downloaded',
        description: `Opening Android installer for v${info.version}…`,
      });

      await AppManager.installApk({ filePath });

      // Clear snooze so next launch (after the user finishes the system installer)
      // doesn't immediately re-prompt for the same version.
      try {
        localStorage.removeItem(SNOOZE_KEY);
      } catch {
        /* ignore */
      }
      setOpen(false);
    } catch (err) {
      console.error('[AutoUpdatePrompt] install failed', err);
      toast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Please try again later',
        variant: 'destructive',
      });
    } finally {
      setInstalling(false);
      setProgress(0);
    }
  };

  if (!open || !info) return null;

  return (
    <div
      className="fixed inset-0 z-[125] bg-black/85 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <Card className="w-full max-w-md bg-gradient-to-br from-blue-900 to-slate-900 border-blue-500/40 p-6 relative shadow-2xl">
        <Button
          onClick={snooze}
          variant="outline"
          size="sm"
          tabIndex={-1}
          className="absolute top-3 right-3 bg-white/5 border-white/20 text-white hover:bg-white/10"
          disabled={installing}
        >
          <X className="w-4 h-4" />
        </Button>

        <div className="flex items-center gap-2 mb-2">
          <RefreshCw className="w-6 h-6 text-cyan-300" />
          <h2 className="text-xl font-bold text-white">Update available</h2>
        </div>
        <p className="text-sm text-white/80 mb-3">
          Snow Media Center <strong>v{info.version}</strong> is ready to install.
          {info.size ? ` (${info.size})` : ''}
        </p>

        {info.changelog && (
          <div className="bg-black/30 border border-white/10 rounded-md p-3 mb-4">
            <p className="text-xs uppercase tracking-wider text-cyan-300/80 mb-1">What's new</p>
            <p className="text-sm text-white/90 whitespace-pre-line">{info.changelog}</p>
          </div>
        )}

        {installing && (
          <div className="mb-4">
            <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-cyan-400 to-blue-500 h-2 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-white/70 mt-1 text-center">Downloading… {progress}%</p>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <Button
            onClick={snooze}
            variant="outline"
            disabled={installing}
            className="bg-white/5 border-white/20 text-white hover:bg-white/10"
          >
            Later
          </Button>
          <Button
            data-autoupdate-primary="true"
            onClick={installNow}
            disabled={installing}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-5 focus:ring-4 focus:ring-yellow-300 focus:scale-105 transition-all"
          >
            <Download className="w-4 h-4 mr-2" />
            {installing ? 'Installing…' : 'Install now'}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default AutoUpdatePrompt;
