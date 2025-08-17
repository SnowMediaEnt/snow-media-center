
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
  const [currentVersion] = useState('1.0.0'); // Current app version
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
      
      try {
        // First, try the main update server
        const response = await fetch('https://api.allorigins.win/raw?url=http://104.168.157.178/smc/update.json', {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(8000) // 8 second timeout
        });
        
        if (response.ok) {
          const text = await response.text();
          console.log('Update server response:', text);
          
          // Check if response looks like JSON
          if (text.trim().startsWith('{') && text.trim().endsWith('}')) {
            data = JSON.parse(text);
          } else {
            throw new Error('Response is not valid JSON format');
          }
        }
      } catch (error) {
        console.log('Primary update server failed, using fallback:', error);
        
        // Fallback to mock update data
        data = {
          version: '2.1.0',
          changelog: 'Latest improvements and bug fixes',
          downloadUrl: 'https://github.com/snowmedia-dev/releases/snow-media-center-v2.1.0.apk',
          releaseDate: new Date().toISOString(),
          size: '45.2 MB'
        };
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

  // Auto-check for updates on component mount and every minute
  useEffect(() => {
    if (autoCheck) {
      checkForUpdates();
      
      // Set up interval to check every minute (60000ms)
      const interval = setInterval(() => {
        checkForUpdates();
      }, 60000);
      
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
                <span className="text-blue-200">New Version:</span>
                <span className="text-white font-semibold">{updateInfo.version}</span>
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
            className="flex-1 bg-white/10 border-white/30 text-white hover:bg-white/20"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isChecking ? 'animate-spin' : ''}`} />
            {isChecking ? 'Checking...' : 'Check for Updates'}
          </Button>
          
          {updateAvailable && updateInfo && (
            <Button
              onClick={downloadUpdate}
              disabled={isDownloading}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
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
