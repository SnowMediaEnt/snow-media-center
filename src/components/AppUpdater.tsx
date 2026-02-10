import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download, RefreshCw, CheckCircle, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { isNativePlatform } from '@/utils/platform';
import { robustFetch } from '@/utils/network';
import { Filesystem, Directory } from '@capacitor/filesystem';

interface UpdateInfo {
  version: string;
  downloadUrl: string;
  changelog: string;
  releaseDate: string;
  releaseNotes?: string;
  size?: string;
}

interface AppUpdaterProps {
  onClose?: () => void;
  autoCheck?: boolean;
}

const AppUpdater = ({ onClose, autoCheck = false }: AppUpdaterProps) => {
  const [currentVersion, setCurrentVersion] = useState('1.0.0');
  const [focusedElement, setFocusedElement] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const { toast } = useToast();

  const checkForUpdates = async () => {
    if (isChecking) return;
    
    setIsChecking(true);
    try {
      const updateUrl = 'https://snowmediaapps.com/smc/update.json';
      const timestamp = Date.now();
      const isNative = isNativePlatform();
      
      console.log(`Checking for updates (native: ${isNative})...`);
      
      const response = await robustFetch(`${updateUrl}?ts=${timestamp}`, {
        timeout: 15000,
        retries: 3,
        useCorsProxy: !isNative,
        headers: { 'Accept': 'application/json' },
      });
      
      const text = await response.text();
      console.log('Update response:', text.substring(0, 200));
      
      // Handle wrapped responses from CORS proxies
      let data: UpdateInfo;
      try {
        const parsed = JSON.parse(text);
        if (parsed.contents) {
          data = JSON.parse(parsed.contents);
        } else {
          data = parsed;
        }
      } catch {
        throw new Error('Invalid update data received');
      }
      
      if (!data?.version || !data?.downloadUrl) {
        throw new Error('Invalid update information');
      }
      
      // Compare versions
      if (data.version !== currentVersion && isVersionNewer(data.version, currentVersion)) {
        setUpdateInfo(data);
        setUpdateAvailable(true);
        
        if (autoCheck) {
          toast({
            title: "Update Available",
            description: `Version ${data.version} is available`,
          });
        }
      } else {
        setUpdateAvailable(false);
        if (!autoCheck) {
          toast({
            title: "No Updates",
            description: "You're running the latest version",
          });
        }
      }
    } catch (error) {
      console.error('Update check failed:', error);
      if (!autoCheck) {
        toast({
          title: "Update Check Failed",
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: "destructive",
        });
      }
    } finally {
      setIsChecking(false);
    }
  };

  const isVersionNewer = (newVersion: string, currentVersion: string): boolean => {
    const newParts = newVersion.split('.').map(Number);
    const currentParts = currentVersion.split('.').map(Number);
    
    for (let i = 0; i < Math.max(newParts.length, currentParts.length); i++) {
      const newPart = newParts[i] || 0;
      const currentPart = currentParts[i] || 0;
      
      if (newPart > currentPart) return true;
      if (newPart < currentPart) return false;
    }
    
    return false;
  };

  const downloadUpdate = async () => {
    if (!updateInfo) return;
    
    setIsDownloading(true);
    setDownloadProgress(0);
    
    try {
      if (isNativePlatform()) {
        // Native download with progress
        const response = await fetch(updateInfo.downloadUrl);
        
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }
        
        const contentLength = response.headers.get('content-length');
        const totalSize = contentLength ? parseInt(contentLength, 10) : 0;
        
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Failed to get reader');
        
        const chunks: Uint8Array[] = [];
        let receivedLength = 0;
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          chunks.push(value);
          receivedLength += value.length;
          
          if (totalSize > 0) {
            setDownloadProgress(Math.round((receivedLength / totalSize) * 100));
          }
        }
        
        // Combine chunks
        const allChunks = new Uint8Array(receivedLength);
        let position = 0;
        for (const chunk of chunks) {
          allChunks.set(chunk, position);
          position += chunk.length;
        }
        
        // Convert to base64 in chunks
        const chunkSize = 32768;
        let base64 = '';
        for (let i = 0; i < allChunks.length; i += chunkSize) {
          const chunk = allChunks.subarray(i, Math.min(i + chunkSize, allChunks.length));
          base64 += btoa(String.fromCharCode.apply(null, Array.from(chunk)));
        }
        
        const fileName = `snow_media_center_${updateInfo.version}.apk`;
        
        await Filesystem.writeFile({
          path: `Downloads/${fileName}`,
          data: base64,
          directory: Directory.External
        });
        
        toast({
          title: "Update Downloaded",
          description: `Version ${updateInfo.version} saved to Downloads`,
        });
        
        setCurrentVersion(updateInfo.version);
        setUpdateAvailable(false);
        setUpdateInfo(null);
        
      } else {
        // Web fallback - direct download
        const link = document.createElement('a');
        link.href = updateInfo.downloadUrl;
        link.download = `snow_media_center_${updateInfo.version}.apk`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        toast({
          title: "Download Started",
          description: `Version ${updateInfo.version} download initiated`,
        });
        
        setCurrentVersion(updateInfo.version);
        setUpdateAvailable(false);
        setUpdateInfo(null);
      }
      
    } catch (error) {
      console.error('Download failed:', error);
      toast({
        title: "Download Failed",
        description: "Please try again",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  };

  // TV remote navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }
      
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
          if (focusedElement === 1 && updateAvailable) setFocusedElement(0);
          break;
          
        case 'ArrowRight':
        case 'ArrowDown':
          if (focusedElement === 0 && updateAvailable) setFocusedElement(1);
          break;
          
        case 'Enter':
        case ' ':
          if (focusedElement === 0) checkForUpdates();
          else if (focusedElement === 1 && updateAvailable) downloadUpdate();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedElement, updateAvailable]);

  // Auto-check on mount and periodically
  useEffect(() => {
    if (autoCheck) {
      checkForUpdates();
      const interval = setInterval(checkForUpdates, 180000);
      return () => clearInterval(interval);
    }
  }, [autoCheck]);

  if (!updateAvailable && autoCheck) {
    return null;
  }

  return (
    <Card className="bg-gradient-to-br from-blue-600 to-blue-800 border-blue-500 p-6 relative">
      {onClose && (
        <Button
          onClick={onClose}
          variant="outline"
          size="sm"
          className="absolute top-4 right-4 bg-transparent border-white/30 text-white hover:bg-white/10"
        >
          <X className="w-4 h-4" />
        </Button>
      )}
      
      <div className="flex items-center gap-3 mb-4">
        <RefreshCw className="w-6 h-6 text-blue-200" />
        <h2 className="text-2xl font-bold text-white">App Updates</h2>
      </div>
      
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-blue-200">Current Version:</span>
          <span className="text-white font-semibold">{currentVersion}</span>
        </div>
        
        {updateAvailable && updateInfo && (
          <div className="bg-green-600/20 border border-green-500/50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <span className="text-green-400 font-semibold">Update Available</span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-blue-200">Available Version:</span>
                <span className="text-green-400 font-semibold">{updateInfo.version}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-blue-200">Release Date:</span>
                <span className="text-white">{updateInfo.releaseDate}</span>
              </div>
              {updateInfo.changelog && (
                <div>
                  <span className="text-blue-200 block mb-1">Changes:</span>
                  <p className="text-white text-sm bg-black/20 rounded p-2">{updateInfo.changelog}</p>
                </div>
              )}
            </div>
          </div>
        )}
        
        <div className="flex gap-3">
          <Button
            onClick={checkForUpdates}
            disabled={isChecking}
            variant="outline"
            className={`flex-1 bg-white/10 border-white/30 text-white hover:bg-white/20 transition-all duration-200 ${
              focusedElement === 0 ? 'ring-4 ring-white/60 scale-105' : ''
            }`}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isChecking ? 'animate-spin' : ''}`} />
            {isChecking ? 'Checking...' : 'Check for Updates'}
          </Button>
          
          {updateAvailable && updateInfo && (
            <Button
              onClick={downloadUpdate}
              disabled={isDownloading}
              className={`flex-1 bg-green-600 hover:bg-green-700 text-white transition-all duration-200 ${
                focusedElement === 1 ? 'ring-4 ring-white/60 scale-105' : ''
              }`}
            >
              <Download className="w-4 h-4 mr-2" />
              {isDownloading ? `${downloadProgress}%` : 'Download'}
            </Button>
          )}
        </div>
        
        {isDownloading && (
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div 
              className="bg-green-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
        )}
      </div>
    </Card>
  );
};

export default AppUpdater;
