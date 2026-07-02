import { useEffect, useState } from 'react';
import { readTheme, setTheme as persistTheme, THEME_EVENT, THEME_KEY, type ThemeSettings } from '@/lib/theme';

export const useTheme = (): [ThemeSettings, (patch: Partial<ThemeSettings>) => void] => {
  const [theme, setLocal] = useState<ThemeSettings>(readTheme);

  useEffect(() => {
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<ThemeSettings>;
      setLocal(ce.detail ?? readTheme());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) setLocal(readTheme());
    };
    window.addEventListener(THEME_EVENT, onChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(THEME_EVENT, onChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const update = (patch: Partial<ThemeSettings>) => {
    setLocal(prev => ({ ...prev, ...patch }));
    persistTheme(patch);
  };

  return [theme, update];
};
