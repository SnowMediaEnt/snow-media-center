import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Trash2, RefreshCw, Package, FileWarning, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { isNativePlatform } from '@/utils/platform';
import { AppManager, type CachedApkInfo } from '@/capacitor/AppManager';

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
};

const formatDate = (ms: number): string => {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '';
  }
};

const ApkCacheViewer = () => {
  const { toast } = useToast();
  const [files, setFiles] = useState<CachedApkInfo[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await AppManager.listCachedApks();
      setFiles(result.files || []);
      setTotalBytes(result.totalBytes || 0);
    } catch (e) {
      console.error('[ApkCacheViewer] list failed:', e);
      toast({
        title: 'Could not list APKs',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const deleteOne = async (name: string) => {
    setBusyName(name);
    try {
      const { deleted } = await AppManager.deleteCachedApk({ name });
      toast({
        title: deleted ? 'Deleted' : 'Already gone',
        description: name,
      });
      await refresh();
    } catch (e) {
      toast({
        title: 'Delete failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setBusyName(null);
    }
  };

  const installOne = async (file: CachedApkInfo) => {
    setBusyName(file.name);
    try {
      await AppManager.installApk({ filePath: file.path });
      toast({
        title: 'Opening installer',
        description: `Tap Install on the system prompt for ${file.name}.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      const isPerm = /install permission|unknown app sources|unknown sources/i.test(msg);
      toast({
        title: isPerm ? 'Allow install from this source' : 'Install failed',
        description: isPerm
          ? "Enable 'Install unknown apps' for Snow Media Center, then tap Install again."
          : msg,
        variant: 'destructive',
      });
    } finally {
      setBusyName(null);
    }
  };


  const deleteAll = async () => {
    if (files.length === 0) return;
    setLoading(true);
    try {
      for (const f of files) {
        await AppManager.deleteCachedApk({ name: f.name });
      }
      toast({
        title: 'Cache cleared',
        description: `Deleted ${files.length} APK file${files.length === 1 ? '' : 's'}.`,
      });
      await refresh();
    } catch (e) {
      toast({
        title: 'Could not clear cache',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isNativePlatform()) {
    return (
      <Card className="bg-gradient-to-br from-slate-700 to-slate-800 border-slate-600 p-6">
        <h3 className="text-lg font-bold text-white mb-1">Download cache</h3>
        <p className="text-sm text-slate-300">
          The APK download cache only exists in the installed Android app.
        </p>
      </Card>
    );
  }

  const focusByAttr = (sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  return (
    <Card data-apk-cache-root className="bg-gradient-to-br from-slate-700 to-slate-800 border-slate-600 p-6">
      <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-bold text-white mb-1">Downloaded APKs</h3>
          <p className="text-sm text-slate-300">
            {files.length === 0
              ? 'No cached APK files. Nothing taking up space.'
              : `${files.length} file${files.length === 1 ? '' : 's'} • ${formatBytes(totalBytes)} total`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={refresh}
            disabled={loading}
            variant="outline"
            size="sm"
            data-apk-cache-first
            onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' && files.length > 0) {
                e.preventDefault();
                focusByAttr('[data-apk-clear-all]');
              } else if (e.key === 'ArrowDown' && files.length > 0) {
                e.preventDefault();
                focusByAttr('[data-apk-row-install="0"]');
              }
            }}
            className="bg-blue-600/20 border-blue-500/50 text-blue-200 hover:bg-blue-600/30 focus:ring-4 focus:ring-brand-gold focus:scale-110 focus:outline-none transition-all"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {files.length > 0 && (
            <Button
              onClick={deleteAll}
              disabled={loading}
              variant="outline"
              size="sm"
              data-apk-clear-all
              onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  focusByAttr('[data-apk-cache-first]');
                } else if (e.key === 'ArrowDown' && files.length > 0) {
                  e.preventDefault();
                  focusByAttr('[data-apk-row-install="0"]');
                }
              }}
              className="bg-red-600/20 border-red-500/50 text-red-200 hover:bg-red-600/30 focus:ring-4 focus:ring-red-300 focus:scale-110 focus:outline-none transition-all"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear all
            </Button>
          )}
        </div>
      </div>

      {files.length > 0 && (
        <ul className="divide-y divide-slate-600/60 mt-3 rounded-lg overflow-hidden border border-slate-600/40">
          {files.map((f, idx) => (
            <li
              key={f.name}
              className="flex items-center gap-3 p-3 bg-slate-800/40"
            >
              <div className="w-9 h-9 rounded-lg bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                <Package className="w-5 h-5 text-orange-300" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium truncate" title={f.name}>{f.name}</p>
                <p className="text-xs text-slate-400">
                  {formatBytes(f.sizeBytes)}
                  {f.modifiedAt ? ` • ${formatDate(f.modifiedAt)}` : ''}
                </p>
              </div>
              <Button
                data-apk-row-install={idx}
                onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    focusByAttr(`[data-apk-row-delete="${idx}"]`);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (idx + 1 < files.length) focusByAttr(`[data-apk-row-install="${idx + 1}"]`);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (idx === 0) focusByAttr('[data-apk-cache-first]');
                    else focusByAttr(`[data-apk-row-install="${idx - 1}"]`);
                  }
                }}
                onClick={() => installOne(f)}
                disabled={busyName === f.name}
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white focus:outline-none focus:ring-4 focus:ring-brand-gold focus:scale-110 transition-all"
                title="Install this APK"
              >
                <Download className="w-4 h-4 mr-1" />
                Install
              </Button>
              <Button
                data-apk-row-delete={idx}
                onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    focusByAttr(`[data-apk-row-install="${idx}"]`);
                  } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (idx + 1 < files.length) focusByAttr(`[data-apk-row-delete="${idx + 1}"]`);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (idx === 0) focusByAttr('[data-apk-clear-all]');
                    else focusByAttr(`[data-apk-row-delete="${idx - 1}"]`);
                  }
                }}
                onClick={() => deleteOne(f.name)}
                disabled={busyName === f.name}
                variant="outline"
                size="sm"
                className="bg-red-600/20 border-red-500/50 text-red-200 hover:bg-red-600/30 focus:outline-none focus:ring-4 focus:ring-red-300 focus:scale-110 transition-all"
                title="Delete this APK"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {files.length === 0 && !loading && (
        <div className="mt-4 flex items-center gap-2 text-sm text-slate-400">
          <FileWarning className="w-4 h-4" />
          Files appear here after you download an app and before it's installed.
        </div>
      )}
    </Card>
  );
};

export default ApkCacheViewer;
