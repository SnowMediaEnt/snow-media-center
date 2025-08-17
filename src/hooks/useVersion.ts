import { useState, useEffect } from 'react';

export const useVersion = () => {
  const [version, setVersion] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const response = await fetch('/version.json');
        if (response.ok) {
          const versionData = await response.json();
          setVersion(versionData.currentVersion || '1.0.0');
        } else {
          setVersion('1.0.0');
        }
      } catch (error) {
        console.log('Could not fetch version, using default');
        setVersion('1.0.0');
      } finally {
        setIsLoading(false);
      }
    };

    fetchVersion();
  }, []);

  return { version, isLoading };
};