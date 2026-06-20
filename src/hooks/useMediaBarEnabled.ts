import { useEffect, useState } from 'react';
import { isFireTV } from '@/utils/platform';

const KEY = 'snow-media-bar-enabled';
const EVENT = 'snow-media-bar-enabled-changed';

// Default ON for every device EXCEPT Fire TV (2GB RAM, repeated WebMediaPlayer
// creation, tile-memory limits). On Fire TV we default OFF so the trending
// images row doesn't pre-load dozens of large posters; the user can opt in
// from Settings and that choice is honored.
export const readMediaBarEnabled = (): boolean => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return !isFireTV();
    return raw === '1' || raw === 'true';
  } catch {
    return !isFireTV();
  }
};

export const setMediaBarEnabled = (enabled: boolean) => {
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch { /* ignore */ }
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: enabled }));
  } catch { /* ignore */ }
};

export const useMediaBarEnabled = (): [boolean, (v: boolean) => void] => {
  const [enabled, setEnabledState] = useState<boolean>(readMediaBarEnabled);

  useEffect(() => {
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<boolean>;
      if (typeof ce.detail === 'boolean') setEnabledState(ce.detail);
      else setEnabledState(readMediaBarEnabled());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setEnabledState(readMediaBarEnabled());
    };
    window.addEventListener(EVENT, onChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const set = (v: boolean) => {
    setEnabledState(v);
    setMediaBarEnabled(v);
  };

  return [enabled, set];
};
