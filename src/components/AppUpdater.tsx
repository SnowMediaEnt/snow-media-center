
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Download, RefreshCw, CheckCircle, AlertCircle, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Capacitor } from '@capacitor/core';
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
  const [currentVersion, setCurrentVersion] = useState('1.0.2'); // Fixed starting version to match home screen
  const [focusedElement, setFocusedElement] = useState(0); // 0: check button, 1: download button
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
      // Try multiple update sources
      let data: UpdateInfo | null = null;
      
      // Try multiple CORS proxies since direct IP is blocked by Cloudflare
      const corsProxies = [
        'https://cors-anywhere.herokuapp.com/',
        'https://api.codetabs.com/v1/proxy?quest=',
        'https://cors.bridged.cc/',
        'https://api.allorigins.win/get?url='
      ];
      
      for (const proxy of corsProxies) {
        try {
          console.log(`Trying proxy: ${proxy}`);
          let url = proxy + encodeURIComponent('https://snowmediaapps.com/smc/update.json');
          
          // Handle different proxy response formats
          const isAllOrigins = proxy.includes('allorigins.win');
          
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              ...(proxy.includes('cors-anywhere') && {
                'X-Requested-With': 'XMLHttpRequest'
              })
            },
            signal: AbortSignal.timeout(10000)
          });
          
          if (response.ok) {
            const text = await response.text();
            console.log(`Response from ${proxy}:`, text);
            
            if (isAllOrigins) {
              // allorigins.win wraps response in JSON
              try {
                const wrapped = JSON.parse(text);
                if (wrapped.contents) {
                  data = JSON.parse(wrapped.contents);
                  break;
                }
              } catch (e) {
                console.log('Failed to parse allorigins response');
                continue;
              }
            } else {
              // Other proxies return raw content
              if (text.trim().startsWith('{') && text.trim().endsWith('}')) {
                try {
                  data = JSON.parse(text);
                  break;
                } catch (e) {
                  console.log('Failed to parse JSON from proxy');
                  continue;
                }
              }
            }
          }
        } catch (error) {
          console.log(`Proxy ${proxy} failed:`, error);
          continue;
        }
      }
      
      // If all proxies failed, throw error
      if (!data) {
        throw new Error('All update servers are currently unavailable. The server may be experiencing high traffic or maintenance.');
      }
      
      if (!data || !data.version || !data.downloadUrl) {
        throw new Error('Invalid update information received');
      }
      
      // Compare versions
      if (data.version !== currentVersion && isVersionNewer(data.version, currentVersion)) {
        setUpdateInfo(data);
        setUpdateAvailable(true);
        
        if (autoCheck) {
          toast({
            title: "Update Available",
            description: `Version ${data.version} is available for download`,
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      if (!autoCheck) {
        toast({
          title: "Update Check Failed",
          description: errorMessage,
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
      if (Capacitor.isNativePlatform()) {
        // Download the APK update
        const response = await fetch(updateInfo.downloadUrl);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        
        // Save to device
        const fileName = `snow_media_center_${updateInfo.version}.apk`;
        await Filesystem.writeFile({
          path: `Downloads/${fileName}`,
          data: base64,
          directory: Directory.External
        });
        
        toast({
          title: "Update Downloaded",
          description: `Version ${updateInfo.version} saved to Downloads. Tap to install.`,
        });
        
        // Update current version after successful download
        setCurrentVersion(updateInfo.version);
        setUpdateAvailable(false);
        setUpdateInfo(null);
        
        // Try to open the APK for installation
        const installIntent = `intent:#Intent;action=android.intent.action.VIEW;data=file:///storage/emulated/0/Download/${fileName};type=application/vnd.android.package-archive;flags=0x10000000;end`;
        
        setTimeout(() => {
          if (window.open) {
            window.open(installIntent, '_system');
          } else {
            window.location.href = installIntent;
          }
        }, 1000);
        
      } else {
        // Web fallback - direct download
        const link = document.createElement('a');
        link.href = updateInfo.downloadUrl;
        link.download = `snow_media_center_${updateInfo.version}.apk`;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        toast({
          title: "Download Started",
          description: `Version ${updateInfo.version} download initiated`,
        });
        
        // Update current version after successful download
        setCurrentVersion(updateInfo.version);
        setUpdateAvailable(false);
        setUpdateInfo(null);
      }
      
    } catch (error) {
      console.error('Download failed:', error);
      toast({
        title: "Download Failed",
        description: "Failed to download update. Please try again.",
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

  // Auto-check for updates on component mount and every few minutes
  useEffect(() => {
    if (autoCheck) {
      checkForUpdates();
      
      // Set up interval to check every 3 minutes (180000ms)
      const interval = setInterval(() => {
        checkForUpdates();
      }, 180000);
      
      // Cleanup interval on unmount
      return () => clearInterval(interval);
    }
  }, [autoCheck]);

  if (!updateAvailable && autoCheck) {
    return null; // Don't render anything if no update and auto-checking
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
                <span className="text-blue-200">Current Version:</span>
                <span className="text-white font-semibold">{currentVersion}</span>
              </div>
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
              {isDownloading ? `Downloading... ${downloadProgress}%` : 'Download Update'}
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
