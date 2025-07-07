import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { Switch } from '@/components/ui/switch';
import { ArrowLeft, Upload, Trash2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useMediaAssets, MediaAsset } from '@/hooks/useMediaAssets';
import { useToast } from '@/hooks/use-toast';

interface MediaManagerProps {
  onBack: () => void;
}

const MediaManager = ({ onBack }: MediaManagerProps) => {
  const { assets, loading, uploadAsset, toggleAssetActive, deleteAsset, getAssetUrl } = useMediaAssets();
  const { toast } = useToast();
  
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [uploadForm, setUploadForm] = useState({
    assetType: 'background' as MediaAsset['asset_type'],
    section: 'home',
    description: ''
  });

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

    try {
      setGenerating(true);
      
      // Call our OpenAI edge function
      const response = await fetch(`https://falmwzhvxoefvkfsiylp.supabase.co/functions/v1/generate-ai-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbG13emh2eG9lZnZrZnNpeWxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE4MjIwNDMsImV4cCI6MjA2NzM5ODA0M30.I-YfvZxAuOvhehrdoZOgrANirZv0-ucGUKbW9gOfQak`
        },
        body: JSON.stringify({
          prompt: generatePrompt
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate image');
      }

      const result = await response.json();
      
      if (!result.success) {
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
      
      toast({
        title: "Image generated successfully",
        description: "Your AI-generated background has been created and uploaded.",
      });
      
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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center mb-8">
          <Button 
            onClick={onBack}
            variant="outline" 
            size="lg"
            className="mr-6 bg-blue-600 border-blue-500 text-white hover:bg-blue-700"
          >
            <ArrowLeft className="w-5 h-5 mr-2" />
            Back to Home
          </Button>
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Media Manager</h1>
            <p className="text-xl text-blue-200">Upload and manage backgrounds, icons, and assets</p>
          </div>
        </div>

        {/* AI Generation Section */}
        <Card className="bg-gradient-to-br from-purple-600 to-purple-800 border-purple-500 p-6 mb-6">
          <h2 className="text-2xl font-bold text-white mb-4">Generate Background with AI</h2>
          <div className="flex gap-4">
            <div className="flex-1">
              <Label htmlFor="generate-prompt" className="text-white mb-2 block">Describe the background you want</Label>
              <Input
                id="generate-prompt"
                value={generatePrompt}
                onChange={(e) => setGeneratePrompt(e.target.value)}
                placeholder="e.g., A serene mountain landscape at sunset with purple sky"
                className="bg-white/10 border-white/20 text-white placeholder:text-white/60"
                disabled={generating}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleGenerateImage}
                disabled={generating || !generatePrompt.trim()}
                className="bg-white/20 border-white/30 text-white hover:bg-white/30"
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
        </Card>

        {/* Upload Section */}
        <Card className="bg-gradient-to-br from-blue-600 to-blue-800 border-blue-500 p-6 mb-8">
          <h2 className="text-2xl font-bold text-white mb-4">Upload New Asset</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
            <div>
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
            
            <div>
              <Label htmlFor="section" className="text-white mb-2 block">Section</Label>
              <Select value={uploadForm.section} onValueChange={(value) => setUploadForm({...uploadForm, section: value})}>
                <SelectTrigger className="bg-white/10 border-white/20 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home">Home</SelectItem>
                  <SelectItem value="apps">Apps</SelectItem>
                  <SelectItem value="media-store">Media Store</SelectItem>
                  <SelectItem value="videos">Videos</SelectItem>
                  <SelectItem value="chat">Chat</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="md:col-span-2">
              <Label htmlFor="description" className="text-white mb-2 block">Description (Optional)</Label>
              <Input
                id="description"
                value={uploadForm.description}
                onChange={(e) => setUploadForm({...uploadForm, description: e.target.value})}
                placeholder="Brief description of the asset"
                className="bg-white/10 border-white/20 text-white placeholder:text-white/60"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Input
              type="file"
              accept=".jpg,.jpeg,.png,.gif,.svg,.webp,.bmp,.tiff"
              onChange={handleFileUpload}
              disabled={uploading}
              className="bg-white/10 border-white/20 text-white file:bg-blue-600 file:text-white file:border-0 file:rounded file:px-4 file:py-2"
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
                    <Card key={asset.id} className={`bg-gradient-to-br from-slate-800 to-slate-900 border-slate-700 p-4 ${asset.is_active ? 'ring-2 ring-green-400' : ''}`}>
                      <div className="aspect-video bg-slate-700 rounded mb-3 overflow-hidden">
                        <img 
                          src={getAssetUrl(asset.file_path)} 
                          alt={asset.name}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </div>
                      
                      <h4 className="text-lg font-bold text-white mb-2 truncate">{asset.name}</h4>
                      {asset.description && (
                        <p className="text-slate-400 text-sm mb-3 line-clamp-2">{asset.description}</p>
                      )}
                      
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Switch
                            checked={asset.is_active}
                            onCheckedChange={() => handleToggleActive(asset.id, asset.is_active)}
                          />
                          <span className="text-sm text-slate-400">
                            {asset.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDelete(asset.id, asset.file_path, asset.name)}
                          className="bg-red-600 border-red-500 text-white hover:bg-red-700"
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