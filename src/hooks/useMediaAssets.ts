import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface MediaAsset {
  id: string;
  name: string;
  file_path: string;
  asset_type: 'background' | 'icon' | 'logo' | 'other';
  section: string;
  is_active: boolean;
  rotation_order: number;
  description?: string;
  created_at: string;
  updated_at: string;
}

export const useMediaAssets = () => {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAssets = async () => {
    console.log('[MediaAssets] Starting asset fetch...');
    try {
      setLoading(true);
      setError(null);

      // Use AbortController for proper timeout handling - 20s timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      const { data, error: fetchError } = await supabase
        .from('media_assets')
        .select('*')
        .order('created_at', { ascending: false })
        .abortSignal(controller.signal);

      clearTimeout(timeoutId);

      if (fetchError) {
        console.error('[MediaAssets] Fetch error:', fetchError);
        throw fetchError;
      }
      
      console.log(`[MediaAssets] Loaded ${data?.length || 0} assets`);
      setAssets(data || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch assets';
      setError(errorMessage);
      console.error('[MediaAssets] Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const uploadAsset = async (file: File, assetType: MediaAsset['asset_type'], section: string, description?: string) => {
    try {
      // Check authentication FIRST before any operations
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Please sign in to upload assets');
      }
      const user = session.user;

      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
      const filePath = `${assetType}/${section}/${fileName}`;

      // Upload file to storage
      const { error: uploadError } = await supabase.storage
        .from('media-assets')
        .upload(filePath, file);

      if (uploadError) {
        throw uploadError;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('media-assets')
        .getPublicUrl(filePath);

      // Insert record into database
      const { data, error: insertError } = await supabase
        .from('media_assets')
        .insert({
          name: file.name,
          file_path: filePath,
          asset_type: assetType,
          section: section,
          description: description,
          is_active: false,
          rotation_order: 0,
          uploaded_by: user.id
        })
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }

      await fetchAssets();
      return { asset: data, publicUrl };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upload asset';
      setError(errorMessage);
      throw err;
    }
  };

  const toggleAssetActive = async (id: string, isActive: boolean) => {
    try {
      // If activating an asset, first deactivate all other assets of the same type and section
      if (isActive) {
        const currentAsset = assets.find(asset => asset.id === id);
        if (currentAsset) {
          await supabase
            .from('media_assets')
            .update({ is_active: false })
            .eq('asset_type', currentAsset.asset_type)
            .eq('section', currentAsset.section)
            .neq('id', id);
        }
      }

      const { error: updateError } = await supabase
        .from('media_assets')
        .update({ is_active: isActive })
        .eq('id', id);

      if (updateError) throw updateError;
      await fetchAssets();
      
      // Dispatch event for instant background refresh
      window.dispatchEvent(new CustomEvent('backgroundRefresh'));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update asset';
      setError(errorMessage);
      throw err;
    }
  };

  const deleteAsset = async (id: string, filePath: string) => {
    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('media-assets')
        .remove([filePath]);

      if (storageError) throw storageError;

      // Delete from database
      const { error: deleteError } = await supabase
        .from('media_assets')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;
      await fetchAssets();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete asset';
      setError(errorMessage);
      throw err;
    }
  };

  const getActiveAssets = (assetType?: MediaAsset['asset_type'], section?: string) => {
    return assets.filter(asset => {
      if (!asset.is_active) return false;
      if (assetType && asset.asset_type !== assetType) return false;
      if (section && asset.section !== section) return false;
      return true;
    });
  };

  const getAssetUrl = (filePath: string) => {
    const { data: { publicUrl } } = supabase.storage
      .from('media-assets')
      .getPublicUrl(filePath);
    return publicUrl;
  };

  useEffect(() => {
    console.log('[MediaAssets] useEffect mounting, calling fetchAssets...');
    fetchAssets();
    
    // Safety fallback: if loading takes too long, stop spinner
    const safetyTimeout = setTimeout(() => {
      setLoading(prev => {
        if (prev) {
          console.warn('[MediaAssets] Safety timeout - loading took too long');
          setError('Loading timed out. Please try again.');
          return false;
        }
        return prev;
      });
    }, 25000);
    
    return () => clearTimeout(safetyTimeout);
  }, []);

  return {
    assets,
    loading,
    error,
    fetchAssets,
    uploadAsset,
    toggleAssetActive,
    deleteAsset,
    getActiveAssets,
    getAssetUrl
  };
};
