import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { X, Download, Package, Trash2, Database, HardDrive } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface DownloadProgressProps {
  app: {
    id: string;
    name: string;
    size: string;
    packageName: string;
  };
  onClose: () => void;
  onComplete: () => void;
}

const DownloadProgress = ({ app, onClose, onComplete }: DownloadProgressProps) => {
  const [progress, setProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState('0 KB/s');
  const [downloaded, setDownloaded] = useState('0 MB');
  const [isComplete, setIsComplete] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          setIsComplete(true);
          clearInterval(interval);
          // Auto-close after download completes
          setTimeout(() => {
            onComplete();
            onClose();
          }, 1500);
          return 100;
        }
        
        const newProgress = prev + Math.random() * 10;
        const finalProgress = Math.min(newProgress, 100);
        
        // Simulate download speed and size
        const sizeString = app.size || '25MB';
        const totalMB = parseFloat(sizeString.replace('MB', ''));
        const downloadedMB = (finalProgress / 100) * totalMB;
        const speed = Math.random() * 5 + 1; // 1-6 MB/s
        
        setDownloaded(`${downloadedMB.toFixed(1)} MB`);
        setDownloadSpeed(`${speed.toFixed(1)} MB/s`);
        
        return finalProgress;
      });
    }, 500);

    return () => clearInterval(interval);
  }, [app.size, onComplete, onClose]);

  const handleInstall = () => {
    // Simulate installation
    setIsInstalled(true);
    onComplete();
  };

  const handleUninstall = () => {
    // Android uninstall intent
    const uninstallIntent = `intent://uninstall?package=${app.packageName}#Intent;scheme=package;action=android.intent.action.DELETE;end`;
    
    try {
      window.location.href = uninstallIntent;
      setIsInstalled(false);
      toast({
        title: "Uninstalling App",
        description: `${app.name} is being uninstalled...`,
        variant: "destructive",
      });
    } catch (error) {
      toast({
        title: "Uninstall Failed",
        description: "Could not uninstall the app. Please try manually.",
        variant: "destructive",
      });
    }
  };

  const handleClearData = () => {
    // Android clear data intent
    const clearDataIntent = `intent://${app.packageName}#Intent;scheme=package;action=android.settings.APPLICATION_DETAILS_SETTINGS;end`;
    
    try {
      window.location.href = clearDataIntent;
      toast({
        title: "Clearing App Data",
        description: `Opening settings to clear ${app.name} data...`,
      });
    } catch (error) {
      toast({
        title: "Clear Data Failed",
        description: "Could not clear app data. Please try manually.",
        variant: "destructive",
      });
    }
  };

  const handleClearCache = () => {
    // Android clear cache intent
    const clearCacheIntent = `intent://${app.packageName}#Intent;scheme=package;action=android.settings.APPLICATION_DETAILS_SETTINGS;end`;
    
    try {
      window.location.href = clearCacheIntent;
      toast({
        title: "Clearing App Cache",
        description: `Opening settings to clear ${app.name} cache...`,
      });
    } catch (error) {
      toast({
        title: "Clear Cache Failed",
        description: "Could not clear app cache. Please try manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-white">{app.name}</h3>
          <Button 
            onClick={onClose}
            variant="ghost"
            size="sm"
            className="text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {!isComplete ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Download className="w-5 h-5 text-blue-400" />
              <span className="text-white font-medium">Downloading...</span>
            </div>
            
            <Progress value={progress} className="h-2" />
            
            <div className="flex justify-between text-sm text-slate-300">
              <span>{downloaded} / {app.size}</span>
              <span>{downloadSpeed}</span>
            </div>
            
            <div className="text-center text-slate-400">
              {progress.toFixed(0)}% Complete
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-400">
              <Package className="w-5 h-5" />
              <span className="font-medium">Download Complete!</span>
            </div>
            
            <div className="text-center text-slate-300">
              <p>File downloaded successfully!</p>
              <p className="text-sm mt-1">Use the Install button from the main menu to install.</p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default DownloadProgress;