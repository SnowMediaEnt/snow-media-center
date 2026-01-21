import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Upload, Trash2, Eye, EyeOff, Loader2, Monitor } from 'lucide-react';
import { useMediaAssets, MediaAsset } from '@/hooks/useMediaAssets';
import { useAuth } from '@/hooks/useAuth';
import { useUserProfile } from '@/hooks/useUserProfile';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface MediaManagerProps {
  onBack: () => void;
  embedded?: boolean; // When true, hides the "Back to Home" button (used in Settings)
  isActive?: boolean; // When true and embedded, MediaManager handles its own navigation
}

// Focus element types for TV navigation
type FocusElement = 
  | 'back' 
  | 'prompt-input' 
  | 'generate-btn' 
  | 'asset-type' 
  | 'file-input' 
  | `asset-toggle-${string}` 
  | `asset-delete-${string}`;

const MediaManager = ({ onBack, embedded = false, isActive = true }: MediaManagerProps) => {
  const { assets, loading, uploadAsset, toggleAssetActive, deleteAsset, getAssetUrl } = useMediaAssets();
  const { user } = useAuth();
  const { profile, checkCredits, deductCredits } = useUserProfile();
  const { toast } = useToast();
  
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [screenInfo, setScreenInfo] = useState({ width: 1920, height: 1080, ratio: '16:9' });
  const [uploadForm, setUploadForm] = useState({
    assetType: 'background' as MediaAsset['asset_type'],
    section: 'home',
    description: ''
  });
  const [focusedElement, setFocusedElement] = useState<FocusElement>(embedded ? 'prompt-input' : 'back');
  
  const promptInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to get focus ring class - use rounded ring for inputs
  const getFocusClass = (id: FocusElement, isRounded = false) => 
    focusedElement === id 
      ? `ring-4 ring-brand-ice scale-105 ${isRounded ? 'rounded-md' : ''}` 
      : '';

  // TV Navigation - D-pad support (only when active)
  useEffect(() => {
    if (!isActive) return; // Don't handle navigation when not active
    
    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        if (event.key === 'Escape' || (event.key === 'Backspace' && !(event.target as HTMLInputElement).value)) {
          event.preventDefault();
          setFocusedElement('prompt-input');
          (event.target as HTMLElement).blur();
        }
        return;
      }
      
      // Handle Android back button
      if (event.key === 'Escape' || event.key === 'Backspace' || 
          event.keyCode === 4 || event.which === 4) {
        event.preventDefault();
        onBack();
        return;
      }
      
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
      }
      
      switch (event.key) {
        case 'ArrowDown':
          if (focusedElement === 'back' && !embedded) {
            setFocusedElement('prompt-input');
          } else if (focusedElement === 'prompt-input') {
            setFocusedElement('asset-type');
          } else if (focusedElement === 'generate-btn') {
            setFocusedElement('asset-type');
          } else if (focusedElement === 'asset-type') {
            setFocusedElement('file-input');
          } else if (focusedElement === 'file-input') {
            if (assets.length > 0) {
              setFocusedElement(`asset-toggle-${assets[0].id}`);
            }
          } else if (focusedElement.startsWith('asset-toggle-') || focusedElement.startsWith('asset-delete-')) {
            const assetId = focusedElement.split('-').slice(2).join('-');
            const assetIndex = assets.findIndex(a => a.id === assetId);
            if (assetIndex < assets.length - 1) {
              setFocusedElement(`asset-toggle-${assets[assetIndex + 1].id}`);
            }
          }
          break;
          
        case 'ArrowUp':
          if (focusedElement === 'prompt-input' || focusedElement === 'generate-btn') {
            if (!embedded) setFocusedElement('back');
            // If embedded, stay on prompt-input
          } else if (focusedElement === 'asset-type') {
            setFocusedElement('prompt-input');
          } else if (focusedElement === 'file-input') {
            setFocusedElement('asset-type');
          } else if (focusedElement.startsWith('asset-toggle-') || focusedElement.startsWith('asset-delete-')) {
            const assetId = focusedElement.split('-').slice(2).join('-');
            const assetIndex = assets.findIndex(a => a.id === assetId);
            if (assetIndex === 0) {
              setFocusedElement('file-input');
            } else {
              setFocusedElement(`asset-toggle-${assets[assetIndex - 1].id}`);
            }
          }
          break;
          
        case 'ArrowRight':
          if (focusedElement === 'prompt-input') {
            setFocusedElement('generate-btn');
          } else if (focusedElement.startsWith('asset-toggle-')) {
            const assetId = focusedElement.replace('asset-toggle-', '');
            setFocusedElement(`asset-delete-${assetId}`);
          }
          break;
          
        case 'ArrowLeft':
          if (focusedElement === 'generate-btn') {
            setFocusedElement('prompt-input');
          } else if (focusedElement.startsWith('asset-delete-')) {
            const assetId = focusedElement.replace('asset-delete-', '');
            setFocusedElement(`asset-toggle-${assetId}`);
          }
          break;
          
        case 'Enter':
        case ' ':
          if (focusedElement === 'back' && !embedded) {
            onBack();
          } else if (focusedElement === 'prompt-input') {
            promptInputRef.current?.focus();
          } else if (focusedElement === 'generate-btn') {
            // Will trigger generate
          } else if (focusedElement === 'file-input') {
            fileInputRef.current?.click();
          } else if (focusedElement.startsWith('asset-toggle-')) {
            const assetId = focusedElement.replace('asset-toggle-', '');
            const asset = assets.find(a => a.id === assetId);
            if (asset) handleToggleActive(asset.id, asset.is_active);
          } else if (focusedElement.startsWith('asset-delete-')) {
            const assetId = focusedElement.replace('asset-delete-', '');
            const asset = assets.find(a => a.id === assetId);
            if (asset) handleDelete(asset.id, asset.file_path, asset.name);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedElement, assets, onBack, isActive]);

  // Scroll focused element into view
  useEffect(() => {
    const el = document.querySelector(`[data-focus-id="${focusedElement}"]`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedElement]);

  // Detect screen resolution and optimal image size
  useEffect(() => {
    const updateScreenInfo = () => {
      const width = window.screen.width;
      const height = window.screen.height;
      const aspectRatio = width / height;
      
      let ratio = '16:9';
      if (Math.abs(aspectRatio - (4/3)) < 0.1) {
        ratio = '4:3';
      } else if (Math.abs(aspectRatio - (21/9)) < 0.1) {
        ratio = '21:9';
      } else if (Math.abs(aspectRatio - (16/10)) < 0.1) {
        ratio = '16:10';
      }
      
      setScreenInfo({ width, height, ratio });
    };
    
    updateScreenInfo();
    window.addEventListener('resize', updateScreenInfo);
    return () => window.removeEventListener('resize', updateScreenInfo);
  }, []);

  // Use highest resolution available for best quality that can be stretched
  const getOptimalImageConfig = () => {
    return {
      size: '1792x1024',
      credits: 12,
      description: 'High resolution (1792x1024) - highest quality available'
    };
  };

  const imageConfig = getOptimalImageConfig();

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    console.log('Attempting to upload file:', file.name, 'Type:', file.type, 'Size:', file.size);

    try {
      setUploading(true);
      await uploadAsset(file, uploadForm.assetType, uploadForm.section, uploadForm.description);
      
      toast({
        title: "Upload successful",
        description: `${file.name} has been uploaded successfully.`,
      });
      
      // Reset form
      setUploadForm({ assetType: 'background', section: 'home', description: '' });
      event.target.value = '';
    } catch (error) {
      console.error('Upload error details:', error);
      toast({
        title: "Upload failed",
        description: `Failed to upload ${file.name}. Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      await toggleAssetActive(id, !currentStatus);
      toast({
        title: currentStatus ? "Asset deactivated" : "Asset activated",
        description: `Asset is now ${!currentStatus ? 'active' : 'inactive'}.`,
      });
      
      // Force immediate background refresh by dispatching a custom event
      window.dispatchEvent(new CustomEvent('backgroundRefresh'));
    } catch (error) {
      toast({
        title: "Failed to update",
        description: "Could not update asset status.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string, filePath: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;
    
    try {
      await deleteAsset(id, filePath);
      toast({
        title: "Asset deleted",
        description: `${name} has been deleted successfully.`,
      });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: "Failed to delete asset. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleGenerateImage = async () => {
    if (!generatePrompt.trim()) {
      toast({
        title: "Prompt required",
        description: "Please enter a description for the image you want to generate.",
        variant: "destructive",
      });
      return;
    }

    // Content filter for inappropriate content
    const inappropriateWords = [
      'naked', 'nude', 'boobs', 'boobies', 'breast', 'penis', 'vagina', 'ass', 'butt', 'nsfw',
      'sex', 'sexual', 'porn', 'adult', 'explicit', 'erotic', 'intimate', 'underwear', 'bikini',
      'lingerie', 'topless', 'bottomless', 'revealing', 'suggestive', 'seductive'
    ];
    
    const promptLower = generatePrompt.toLowerCase();
    const foundInappropriate = inappropriateWords.find(word => promptLower.includes(word));
    
    if (foundInappropriate) {
      toast({
        title: "Content Policy Violation",
        description: "Your request contains inappropriate content and cannot be processed. Please create family-friendly wallpaper descriptions only.",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Login required",
        description: "Please sign in to generate AI images.",
        variant: "destructive",
      });
      return;
    }

    const imageCost = imageConfig.credits * 0.01; // Convert credits to dollars
    if (!checkCredits(imageCost)) {
      toast({
        title: "Insufficient credits",
        description: `You need ${imageCost.toFixed(2)} credits to generate an image. Your balance: ${profile?.credits?.toFixed(2) || '0.00'}`,
        variant: "destructive",
      });
      return;
    }

    try {
      setGenerating(true);
      
      // Enhance prompt for wallpaper/background generation with safety filters
      const enhancedPrompt = `High quality wallpaper background image: ${generatePrompt}. Ultra detailed, professional wallpaper quality, suitable for desktop background. Safe for work, family-friendly, no NSFW content.`;
      
      // Get the user's session token for authentication
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Please sign in to generate images');
      }

      // Calculate optimal dimensions based on screen resolution (capped at 1536)
      const maxDim = 1536;
      const targetWidth = Math.min(screenInfo.width, maxDim);
      const targetHeight = Math.min(screenInfo.height, maxDim);
      
      // Ensure dimensions are multiples of 64 for best results
      const width = Math.round(targetWidth / 64) * 64;
      const height = Math.round(targetHeight / 64) * 64;

      toast({
        title: "Generating high-quality image",
        description: `Using FLUX.1-dev at ${width}x${height}. This may take 15-30 seconds...`,
      });

      // Call our Hugging Face edge function with user's auth token and screen dimensions
      const response = await fetch(`https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/generate-hf-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          prompt: enhancedPrompt,
          width,
          height
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate image');
      }

      const result = await response.json();
      
      if (!result.image) {
        throw new Error(result.error || 'Generation failed');
      }

      // Convert base64 to blob
      const base64Response = await fetch(result.image);
      const blob = await base64Response.blob();
      
      // Create file from blob
      const fileName = `ai-generated-${Date.now()}.jpg`;
      const file = new File([blob], fileName, { type: 'image/jpeg' });

      // Upload the generated image
      await uploadAsset(file, 'background', uploadForm.section, `AI Generated: ${generatePrompt}`);

      // Deduct credits after successful generation
      const creditDeducted = await deductCredits(imageCost, `AI Image Generation - ${generatePrompt}`);
      
      if (!creditDeducted) {
        toast({
          title: "Credit deduction failed",
          description: "Image generated but couldn't deduct credits. Contact support.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Image generated successfully",
          description: `Your AI-generated background has been created. ${imageCost.toFixed(2)} credits deducted.`,
        });
      }
      
      setGeneratePrompt('');
    } catch (error) {
      console.error('Generate image error:', error);
      toast({
        title: "Generation failed",
        description: `Failed to generate image: ${error.message}`,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const groupedAssets = assets.reduce((acc, asset) => {
    const key = `${asset.asset_type}-${asset.section}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(asset);
    return acc;
  }, {} as Record<string, MediaAsset[]>);

  if (loading) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-400 mx-auto mb-4" />
          <p className="text-xl text-blue-200">Loading media assets...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={embedded ? '' : 'min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-8'}>
      <div className={embedded ? '' : 'max-w-6xl mx-auto'}>
        {!embedded && (
          <div className="flex items-center mb-8">
            <Button 
              onClick={onBack}
              variant="outline" 
              size="lg"
              data-focus-id="back"
              className={`mr-6 bg-brand-gold text-brand-charcoal hover:bg-brand-gold/80 transition-all ${getFocusClass('back')}`}
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              Back to Home
            </Button>
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">Media Manager</h1>
              <p className="text-xl text-blue-200">Upload and manage backgrounds, icons, and assets</p>
            </div>
          </div>
        )}

        {/* AI Generation Section */}
        <Card className="bg-gradient-to-br from-purple-600 to-purple-800 border-purple-500 p-6 mb-6">
          <h2 className="text-2xl font-bold text-white mb-4">Generate Background with AI</h2>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="text-white">
                <div className="flex items-center gap-2 mb-2">
                  <Monitor className="w-4 h-4" />
                  <span className="text-sm text-purple-200">
                    Detected: {screenInfo.width}x{screenInfo.height} ({screenInfo.ratio})
                  </span>
                </div>
                <p className="text-sm text-purple-200">
                  Cost: {(imageConfig.credits * 0.01).toFixed(2)} credits - {imageConfig.description}
                </p>
                {user && profile && (
                  <p className="text-sm text-purple-200">
                    Your balance: {profile.credits.toFixed(2)} credits
                  </p>
                )}
              </div>
              {!user && (
                <p className="text-sm text-purple-200 italic">Sign in to generate images</p>
              )}
            </div>
            <div className="flex gap-4">
              <div className="flex-1" data-focus-id="prompt-input">
                <Label htmlFor="generate-prompt" className="text-white mb-2 block">Describe the background you want</Label>
                <Input
                  id="generate-prompt"
                  ref={promptInputRef}
                  value={generatePrompt}
                  onChange={(e) => setGeneratePrompt(e.target.value)}
                  placeholder="e.g., A serene mountain landscape at sunset with purple sky"
                  className={`bg-white/10 border-white/20 text-white placeholder:text-white/60 transition-all ${focusedElement === 'prompt-input' ? 'ring-4 ring-brand-ice' : ''}`}
                  disabled={generating || !user}
                />
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleGenerateImage}
                  disabled={generating || !generatePrompt.trim() || !user || (profile && profile.credits < (imageConfig.credits * 0.01))}
                  data-focus-id="generate-btn"
                  className={`bg-white/20 border-white/30 text-white hover:bg-white/30 transition-all ${getFocusClass('generate-btn')}`}
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    'Generate'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Upload Section */}
        <Card className="bg-gradient-to-br from-blue-600 to-blue-800 border-blue-500 p-6 mb-8">
          <h2 className="text-2xl font-bold text-white mb-4">Upload New Asset</h2>
          <div className="grid grid-cols-1 md:grid-cols-1 gap-4 mb-4">
            <div data-focus-id="asset-type" className={`transition-all ${getFocusClass('asset-type')}`}>
              <Label htmlFor="asset-type" className="text-white mb-2 block">Asset Type</Label>
              <Select value={uploadForm.assetType} onValueChange={(value) => setUploadForm({...uploadForm, assetType: value as MediaAsset['asset_type']})}>
                <SelectTrigger className="bg-white/10 border-white/20 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="background">Background</SelectItem>
                  <SelectItem value="icon">Icon</SelectItem>
                  <SelectItem value="logo">Logo</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="flex items-center gap-4" data-focus-id="file-input">
            <Input
              type="file"
              ref={fileInputRef}
              accept=".jpg,.jpeg,.png,.gif,.svg,.webp,.bmp,.tiff"
              onChange={handleFileUpload}
              disabled={uploading}
              className={`bg-white/10 border-white/20 text-white file:bg-primary file:text-primary-foreground file:border-0 file:rounded file:px-4 file:py-2 transition-all ${getFocusClass('file-input')}`}
            />
            {uploading && <Loader2 className="w-5 h-5 animate-spin text-white" />}
          </div>
        </Card>

        {/* Assets Grid */}
        <div className="space-y-8">
          {Object.entries(groupedAssets).map(([key, groupAssets]) => {
            const [type, section] = key.split('-');
            return (
              <div key={key}>
                <h3 className="text-2xl font-bold text-white mb-4 capitalize">
                  {type} - {section}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {groupAssets.map((asset) => (
                    <Card key={asset.id} className={`bg-gradient-to-br from-muted to-background border-border p-4 ${asset.is_active ? 'ring-2 ring-green-500' : ''}`}>
                      <div className="aspect-video bg-muted rounded mb-3 overflow-hidden">
                        <img 
                          src={getAssetUrl(asset.file_path)} 
                          alt={asset.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                      
                      <h4 className="text-lg font-bold text-foreground mb-2 truncate">{asset.name}</h4>
                      
                      <div className="flex items-center justify-between">
                        <div 
                          data-focus-id={`asset-toggle-${asset.id}`}
                          className={`flex items-center space-x-2 p-1 rounded transition-all ${getFocusClass(`asset-toggle-${asset.id}`)}`}
                        >
                          <Switch
                            checked={asset.is_active}
                            onCheckedChange={() => handleToggleActive(asset.id, asset.is_active)}
                          />
                          <span className="text-sm text-muted-foreground">
                            {asset.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        
                        <Button
                          size="sm"
                          variant="destructive"
                          data-focus-id={`asset-delete-${asset.id}`}
                          onClick={() => handleDelete(asset.id, asset.file_path, asset.name)}
                          className={`transition-all ${getFocusClass(`asset-delete-${asset.id}`)}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {assets.length === 0 && (
          <div className="text-center py-12">
            <Upload className="w-16 h-16 text-slate-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-slate-300 mb-2">No assets uploaded yet</h3>
            <p className="text-slate-400">Upload your first image to get started</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MediaManager;