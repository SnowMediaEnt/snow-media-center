import { useState, useEffect } from 'react';
import { useMediaAssets } from './useMediaAssets';

export const useDynamicBackground = (section: string = 'home') => {
  const { getActiveAssets, getAssetUrl } = useMediaAssets();
  const [currentBackground, setCurrentBackground] = useState<string | null>(null);
  const [rotationIndex, setRotationIndex] = useState(0);

  useEffect(() => {
    const updateBackground = () => {
      const backgrounds = getActiveAssets('background', section)
        .sort((a, b) => a.rotation_order - b.rotation_order);
      
      if (backgrounds.length > 0) {
        const selectedBackground = backgrounds[rotationIndex % backgrounds.length];
        setCurrentBackground(getAssetUrl(selectedBackground.file_path));
        
        // Set up rotation if multiple backgrounds
        if (backgrounds.length > 1) {
          const interval = setInterval(() => {
            setRotationIndex(prev => prev + 1);
          }, 30000); // Change every 30 seconds
          
          return () => clearInterval(interval);
        }
      } else {
        setCurrentBackground(null);
      }
    };

    updateBackground();

    // Check for new backgrounds every 3 seconds
    const refreshInterval = setInterval(updateBackground, 3000);

    return () => clearInterval(refreshInterval);
  }, [section, getActiveAssets, getAssetUrl, rotationIndex]);

  return {
    backgroundUrl: currentBackground,
    hasBackground: currentBackground !== null
  };
};