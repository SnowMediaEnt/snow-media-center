import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import { formatNumber } from '@/i18n/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { X, Download, Package, Play, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Capacitor } from '@capacitor/core';
import { Filesystem } from '@capacitor/filesystem';
import { downloadApkToCache, generateFileName, cleanupOldApks } from '@/utils/downloadApk';
import { AppManager, isWebUnsupportedError, webUnsupportedMsg } from '@/capacitor/AppManager';
import { trackAppLaunch, trackEvent } from '@/lib/analytics';

interface DownloadProgressProps {
  app: {
    id: string;
    name: string;
    size: string;
    version?: string;
    downloadUrl: string;
    packageName?: string;
  };
  onClose: () => void;
  onComplete: () => void;
  /** If provided, skip downloading and jump straight to the install prompt
   *  using this already-downloaded APK URI. Used for resume-after-100%. */
  prefetchedPath?: string;
}

// Sizes and speeds are kept as numbers and written when drawn, in the viewer's number format.
const one = (n: number) => formatNumber(Math.round(n * 10) / 10);
const FALLBACK_SIZE = '25MB';
// Unit symbols are the same in every language.
const UNIT = { mb: 'MB', mbPerSec: 'MB/s', kbPerSec: 'KB/s' };

type DownloadState = 'downloading' | 'complete' | 'installing' | 'installed' | 'error';
type FocusedButton = 'install' | 'later' | 'open' | 'close';

const DownloadProgress = ({ app, onClose, onComplete, prefetchedPath }: DownloadProgressProps) => {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(prefetchedPath ? 100 : 0);
  const [speedMBs, setSpeedMBs] = useState(0); // megabytes per second
  const [downloadedMB, setDownloadedMB] = useState(0);
  const [state, setState] = useState<DownloadState>(prefetchedPath ? 'complete' : 'downloading');
  const [errorMessage, setErrorMessage] = useState('');
  const inState = (name: DownloadState) => state === name;
  const [filePath, setFilePath] = useState(prefetchedPath || '');
  const [focusedButton, setFocusedButton] = useState<FocusedButton>('install');
  const { toast } = useToast();
  
  // Track download speed and force re-renders
  const lastBytesRef = useRef(0);
  const lastTimeRef = useRef(Date.now());
  const progressRef = useRef(0);
  const [, forceUpdate] = useState(0);

  // D-pad navigation for popup buttons
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Prevent default for navigation keys
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }

      // Handle Android back button - close popup (and clean up cached APK)
      if (event.key === 'Escape' || event.keyCode === 4) {
        event.preventDefault();
        handleCloseAndCleanup();
        return;
      }

      switch (event.key) {
        case 'ArrowUp':
        case 'ArrowDown':
          // Toggle between buttons based on state
          if (state === 'complete') {
            setFocusedButton(prev => prev === 'install' ? 'later' : 'install');
          } else if (state === 'installed') {
            setFocusedButton(prev => prev === 'open' ? 'close' : 'open');
          }
          break;
          
        case 'Enter':
        case ' ':
          // Execute focused button action
          if (state === 'complete') {
            if (focusedButton === 'install') {
              handleInstall();
            } else {
              handleCloseAndCleanup();
            }
          } else if (state === 'installed') {
            if (focusedButton === 'open') {
              handleOpenApp();
            } else {
              handleCloseAndCleanup();
            }
          } else if (state === 'error') {
            handleCloseAndCleanup();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, focusedButton]);

  // Reset focus when state changes
  useEffect(() => {
    if (state === 'complete') {
      setFocusedButton('install');
    } else if (state === 'installed') {
      setFocusedButton('open');
    }
  }, [state]);

  useEffect(() => {
    // If we already have a finished APK on disk, skip the network entirely.
    if (prefetchedPath) return;
    let isMounted = true;
    let progressListener: any = null;
    
    const startDownload = async () => {
      // The iPhone build cannot take an APK either: the same "Android only" answer.
      if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() === 'ios') {
        if (isMounted) {
          setErrorMessage(i18n.t('updater.download.webOnly'));
          setState('error');
        }
        return;
      }

      try {
        // Ensure URL has proper protocol
        let url = app.downloadUrl;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${url}`;
        }

        console.log('[DownloadProgress] Starting download:', url);
        
        const filename = generateFileName(app.name, app.version);
        
        // Parse total size from app.size (e.g., "25MB" -> 25)
        const totalMB = parseFloat(app.size?.replace(/[^0-9.]/g, '') || '0') || 30;
        
        // Listen for native download progress events
        try {
          progressListener = await Filesystem.addListener('progress', (progressEvent) => {
            if (!isMounted) return;
            const percent = Math.round((progressEvent.bytes / progressEvent.contentLength) * 100);
            console.log(`[DownloadProgress] Native progress: ${percent}% (${progressEvent.bytes}/${progressEvent.contentLength})`);
            setProgress(percent > 95 ? 95 : percent);
            
            const mbNow = (progressEvent.bytes / (1024 * 1024));
            setDownloadedMB(mbNow);
            
            // Calculate speed
            const now = Date.now();
            const timeDiff = (now - lastTimeRef.current) / 1000;
            if (timeDiff > 0.5) {
              const bytesDiff = (mbNow - lastBytesRef.current);
              const speed = bytesDiff / timeDiff;
              setSpeedMBs(speed);
              lastBytesRef.current = mbNow;
              lastTimeRef.current = now;
            }
          });
        } catch (e) {
          console.log('[DownloadProgress] Progress listener not available, using callback');
        }
        
        const savedPath = await downloadApkToCache(url, filename, (progressPercent) => {
          if (!isMounted) return;
          setProgress(progressPercent);
        });

        if (!isMounted) return;
        
        console.log('[DownloadProgress] Download complete, saved to:', savedPath);
        setFilePath(savedPath);
        setState('complete');
        
      } catch (error) {
        console.error('[DownloadProgress] Download error:', error);
        if (isMounted) {
          setErrorMessage(error instanceof Error ? error.message : i18n.t('updater.download.genericFail'));
          setState('error');
        }
      }
    };

    startDownload();
    
    return () => {
      isMounted = false;
      if (progressListener) {
        try { progressListener.remove(); } catch (e) { /* ignore */ }
      }
    };
  }, [app]);

  // Wipe the cached APK so failed/cancelled downloads don't pile up.
  const purgeCachedApk = useCallback(async () => {
    try {
      await cleanupOldApks();
      console.log('[DownloadProgress] Purged cached APKs');
    } catch (e) {
      console.log('[DownloadProgress] Purge skipped:', e);
    }
  }, []);

  // Wrap onClose so closing the dialog cleans up the APK from cache
  // — UNLESS the download already finished. In that case we keep the
  // file so the user can resume install on next open without re-downloading.
  const handleCloseAndCleanup = useCallback(() => {
    if (state !== 'installing' && state !== 'installed' && state !== 'complete') {
      purgeCachedApk();
    }
    onClose();
  }, [state, purgeCachedApk, onClose]);

  const handleInstall = useCallback(async () => {
    if (!filePath) {
      toast({
        title: t('updater.download.installErrorTitle'),
        description: t('updater.download.noFilePath'),
        variant: "destructive",
      });
      return;
    }

    try {
      setState('installing');
      console.log('Installing APK from:', filePath);
      
      await AppManager.installApk({ filePath });
      
      setState('installed');
      try { trackEvent('install', 'apps', { app: app.name }); } catch { void 0; }
      toast({
        title: t('updater.download.startedTitle'),
        description: t('updater.download.installerOpened', { name: app.name }),
      });
      
      // Clean up the APK file after install is triggered
      setTimeout(async () => {
        await purgeCachedApk();
        onComplete();
      }, 2000);
      
    } catch (error) {
      console.error('Install error:', error);
      const rawMsg = error instanceof Error ? error.message : String(error ?? '');
      const friendly = isWebUnsupportedError(error)
        ? webUnsupportedMsg()
        : (rawMsg || t('updater.download.installGenericFail'));

      // Detect "needs permission" rejection from the native plugin.
      // In that case the user is being sent to Settings and will come back
      // to tap Install again — so we MUST keep the APK on disk.
      const isPermissionIssue = /install permission|unknown app sources|unknown sources/i.test(rawMsg);

      toast({
        title: isPermissionIssue ? t('updater.download.permissionTitle') : t('updater.download.installFailedTitle'),
        description: isPermissionIssue
          ? t('updater.download.permissionDesc')
          : friendly,
        variant: "destructive",
      });

      // Only wipe the APK on a real failure — NOT when we're just waiting
      // on the user to grant the install-unknown-apps permission.
      if (!isPermissionIssue) {
        await purgeCachedApk();
      }
      setState('complete');
    }
  }, [filePath, app.name, toast, onComplete, purgeCachedApk, t]);

  const handleOpenApp = useCallback(async () => {
    try {
      const packageName = app.packageName || `com.${app.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.app`;
      try { trackAppLaunch(app.name); } catch { void 0; }
      await AppManager.launch({ packageName });
      onClose();
    } catch (error) {
      toast({
        title: t('updater.download.launchFailedTitle'),
        description: t('updater.download.launchFailedDesc'),
        variant: "destructive",
      });
    }
  }, [app.packageName, app.name, toast, onClose, t]);

  const getFocusStyle = (button: FocusedButton) => 
    focusedButton === button 
      ? 'ring-4 ring-brand-ice ring-offset-2 ring-offset-slate-800 scale-105' 
      : '';

  return (
    <div data-download-progress="true" className="fixed inset-0 bg-black/80 flex items-center justify-center z-[200] p-4">
      <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-600 p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white">{app.name}</h3>
          <Button 
            onClick={handleCloseAndCleanup}
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {inState('downloading') && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Download className="w-5 h-5 text-blue-400 animate-pulse" />
              </div>
              <div>
                <span className="text-white font-medium">{t('updater.download.downloading')}</span>
                <p className="text-sm text-slate-400">{t('updater.download.pleaseWait')}</p>
              </div>
            </div>
            
            <Progress value={progress} className="h-3" />
            
            <div className="flex justify-between text-sm">
              <span className="text-slate-300">{`${one(downloadedMB)} ${UNIT.mb}`} / {app.size || FALLBACK_SIZE}</span>
              <span className="text-green-400 font-medium">{speedMBs > 1 ? `${one(speedMBs)} ${UNIT.mbPerSec}` : `${formatNumber(Math.round(speedMBs * 1024))} ${UNIT.kbPerSec}`}</span>
            </div>
            
            <div className="text-center">
              <span className="text-2xl font-bold text-white">{progress.toFixed(0)}%</span>
            </div>
          </div>
        )}

        {inState('complete') && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <Package className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <span className="text-green-400 font-medium">{t('updater.download.complete')}</span>
                <p className="text-sm text-slate-400">{t('updater.download.sizeDownloaded', { size: app.size || FALLBACK_SIZE })}</p>
              </div>
            </div>
            
            <p className="text-xs text-slate-500 text-center">{t('updater.download.navHint')}</p>
            
            <Button 
              onClick={handleInstall}
              className={`w-full bg-green-600 hover:bg-green-700 text-white py-6 text-lg transition-all ${getFocusStyle('install')}`}
            >
              <Package className="w-5 h-5 mr-2 shrink-0" />
              <span className="min-w-0 truncate">{t('updater.download.installNowBtn')}</span>
            </Button>
            
            <Button 
              onClick={handleCloseAndCleanup}
              variant="outline"
              className={`w-full border-slate-600 text-slate-300 hover:bg-slate-700 transition-all ${getFocusStyle('later')}`}
            >
              <span className="min-w-0 truncate">{t('updater.download.installLaterBtn')}</span>
            </Button>
          </div>
        )}

        {inState('installing') && (
          <div className="space-y-4 text-center py-4">
            <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto">
              <Package className="w-8 h-8 text-blue-400 animate-bounce" />
            </div>
            <div>
              <span className="text-white font-medium text-lg">{t('updater.download.installing')}</span>
              <p className="text-sm text-slate-400 mt-1">{t('updater.download.followPrompts')}</p>
            </div>
          </div>
        )}

        {inState('installed') && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <Package className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <span className="text-green-400 font-medium">{t('updater.download.started')}</span>
                <p className="text-sm text-slate-400">{t('updater.download.checkScreen')}</p>
              </div>
            </div>
            
            <p className="text-xs text-slate-500 text-center">{t('updater.download.navHint')}</p>
            
            <Button 
              onClick={handleOpenApp}
              className={`w-full bg-primary hover:bg-primary/80 text-primary-foreground py-6 text-lg transition-all ${getFocusStyle('open')}`}
            >
              <Play className="w-5 h-5 mr-2 shrink-0" />
              <span className="min-w-0 truncate">{t('updater.download.openAppBtn')}</span>
            </Button>
            
            <Button 
              onClick={handleCloseAndCleanup}
              variant="outline"
              className={`w-full border-slate-600 text-slate-300 hover:bg-slate-700 transition-all ${getFocusStyle('close')}`}
            >
              {t('common.close')}
            </Button>
          </div>
        )}

        {inState('error') && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <span className="text-red-400 font-medium">{t('updater.download.failed')}</span>
                <p className="text-sm text-slate-400">{errorMessage}</p>
              </div>
            </div>
            
            <Button 
              onClick={handleCloseAndCleanup}
              variant="outline"
              className="w-full border-slate-600 text-slate-300 hover:bg-slate-700 ring-4 ring-brand-ice ring-offset-2 ring-offset-slate-800"
            >
              {t('common.close')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};

export default DownloadProgress;