import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { X, Download, Package, Play, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Capacitor } from '@capacitor/core';
import { downloadApkToCache, generateFileName } from '@/utils/downloadApk';
import { AppManager } from '@/capacitor/AppManager';

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
}

type DownloadState = 'downloading' | 'complete' | 'installing' | 'installed' | 'error';

const DownloadProgress = ({ app, onClose, onComplete }: DownloadProgressProps) => {
  const [progress, setProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState('0 KB/s');
  const [downloaded, setDownloaded] = useState('0 MB');
  const [state, setState] = useState<DownloadState>('downloading');
  const [errorMessage, setErrorMessage] = useState('');
  const [filePath, setFilePath] = useState('');
  const { toast } = useToast();
  
  // Track download speed
  const lastBytesRef = useRef(0);
  const lastTimeRef = useRef(Date.now());

  useEffect(() => {
    const startDownload = async () => {
      if (!Capacitor.isNativePlatform()) {
        setErrorMessage('Downloads only work on Android devices');
        setState('error');
        return;
      }

      try {
        // Ensure URL has proper protocol
        let url = app.downloadUrl;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = `https://${url}`;
        }

        console.log('Starting in-app download:', url);
        
        const filename = generateFileName(app.name, app.version);
        
        // Parse total size from app.size (e.g., "25MB" -> 25)
        const totalMB = parseFloat(app.size?.replace(/[^0-9.]/g, '') || '0') || 25;
        
        const savedPath = await downloadApkToCache(url, filename, (progressPercent) => {
          setProgress(progressPercent);
          
          // Calculate download speed
          const now = Date.now();
          const timeDiff = (now - lastTimeRef.current) / 1000; // seconds
          const downloadedMB = (progressPercent / 100) * totalMB;
          const bytesDiff = downloadedMB - lastBytesRef.current;
          
          if (timeDiff > 0.5) {
            const speed = bytesDiff / timeDiff;
            setDownloadSpeed(speed > 1 ? `${speed.toFixed(1)} MB/s` : `${(speed * 1024).toFixed(0)} KB/s`);
            lastBytesRef.current = downloadedMB;
            lastTimeRef.current = now;
          }
          
          setDownloaded(`${downloadedMB.toFixed(1)} MB`);
        });

        console.log('Download complete, saved to:', savedPath);
        setFilePath(savedPath);
        setState('complete');
        
      } catch (error) {
        console.error('Download error:', error);
        setErrorMessage(error instanceof Error ? error.message : 'Download failed');
        setState('error');
      }
    };

    startDownload();
  }, [app]);

  const handleInstall = async () => {
    if (!filePath) {
      toast({
        title: "Install Error",
        description: "No file path available",
        variant: "destructive",
      });
      return;
    }

    try {
      setState('installing');
      console.log('Installing APK from:', filePath);
      
      await AppManager.installApk({ filePath });
      
      setState('installed');
      toast({
        title: "Installation Started",
        description: `${app.name} installer opened`,
      });
      
      // Give time for install dialog, then complete
      setTimeout(() => {
        onComplete();
      }, 2000);
      
    } catch (error) {
      console.error('Install error:', error);
      toast({
        title: "Install Failed",
        description: error instanceof Error ? error.message : 'Could not install APK',
        variant: "destructive",
      });
      setState('complete'); // Go back to complete state so they can retry
    }
  };

  const handleOpenApp = async () => {
    try {
      const packageName = app.packageName || `com.${app.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.app`;
      await AppManager.launch({ packageName });
      onClose();
    } catch (error) {
      toast({
        title: "Launch Failed",
        description: "Could not open the app",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-600 p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white">{app.name}</h3>
          <Button 
            onClick={onClose}
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        {state === 'downloading' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Download className="w-5 h-5 text-blue-400 animate-pulse" />
              </div>
              <div>
                <span className="text-white font-medium">Downloading...</span>
                <p className="text-sm text-slate-400">Please wait</p>
              </div>
            </div>
            
            <Progress value={progress} className="h-3" />
            
            <div className="flex justify-between text-sm">
              <span className="text-slate-300">{downloaded} / {app.size || '25MB'}</span>
              <span className="text-green-400 font-medium">{downloadSpeed}</span>
            </div>
            
            <div className="text-center">
              <span className="text-2xl font-bold text-white">{progress.toFixed(0)}%</span>
            </div>
          </div>
        )}

        {state === 'complete' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <Package className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <span className="text-green-400 font-medium">Download Complete!</span>
                <p className="text-sm text-slate-400">{app.size || '25MB'} downloaded</p>
              </div>
            </div>
            
            <Button 
              onClick={handleInstall}
              className="w-full bg-green-600 hover:bg-green-700 text-white py-6 text-lg"
            >
              <Package className="w-5 h-5 mr-2" />
              Install Now
            </Button>
            
            <Button 
              onClick={onClose}
              variant="outline"
              className="w-full border-slate-600 text-slate-300 hover:bg-slate-700"
            >
              Install Later
            </Button>
          </div>
        )}

        {state === 'installing' && (
          <div className="space-y-4 text-center py-4">
            <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center mx-auto">
              <Package className="w-8 h-8 text-blue-400 animate-bounce" />
            </div>
            <div>
              <span className="text-white font-medium text-lg">Installing...</span>
              <p className="text-sm text-slate-400 mt-1">Follow the prompts on your device</p>
            </div>
          </div>
        )}

        {state === 'installed' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <Package className="w-5 h-5 text-green-400" />
              </div>
              <div>
                <span className="text-green-400 font-medium">Installation Started!</span>
                <p className="text-sm text-slate-400">Check your screen for install prompt</p>
              </div>
            </div>
            
            <Button 
              onClick={handleOpenApp}
              className="w-full bg-primary hover:bg-primary/80 text-primary-foreground py-6 text-lg"
            >
              <Play className="w-5 h-5 mr-2" />
              Open App
            </Button>
            
            <Button 
              onClick={onClose}
              variant="outline"
              className="w-full border-slate-600 text-slate-300 hover:bg-slate-700"
            >
              Close
            </Button>
          </div>
        )}

        {state === 'error' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <span className="text-red-400 font-medium">Download Failed</span>
                <p className="text-sm text-slate-400">{errorMessage}</p>
              </div>
            </div>
            
            <Button 
              onClick={onClose}
              variant="outline"
              className="w-full border-slate-600 text-slate-300 hover:bg-slate-700"
            >
              Close
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
};

export default DownloadProgress;