import { useEffect, useState } from 'react';
import { isNativePlatform } from '@/utils/platform';

const KEY = 'snow-media-bar-enabled';
const EVENT = 'snow-media-bar-enabled-changed';
const isLikelyLowMemoryAndroid = () => {
  if (!isNativePlatform()) return false;
  const ua = navigator.userAgent || '';
  return /Android [6-9]\b|AFT|X96|T95|TX3|TV BOX|Fire TV|Amlogic/i.test(ua);
};

export const readMediaBarEnabled = (): boolean => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return !isLikelyLowMemoryAndroid();
    return raw === '1' || raw === 'true';
  } catch {
    return !isLikelyLowMemoryAndroid();
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
