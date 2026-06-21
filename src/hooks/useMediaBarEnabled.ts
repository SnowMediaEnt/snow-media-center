import { useEffect, useState } from 'react';
import { isFireTV } from '@/utils/platform';
import { useTenant } from '@/contexts/TenantContext';

const KEY = 'snow-media-bar-enabled';
const EVENT = 'snow-media-bar-enabled-changed';

// Returns whether the user has an explicit saved preference. Tenants without
// a saved value fall back to their tenant `content_bar_default` setting.
const hasSavedPref = (): boolean => {
  try { return localStorage.getItem(KEY) !== null; } catch { return false; }
};

const readSavedPref = (): boolean => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === '1' || raw === 'true';
  } catch {
    return false;
  }
};

// Default ON for every device EXCEPT Fire TV (2GB RAM, repeated WebMediaPlayer
// creation, tile-memory limits). Used only as the last-resort fallback when
// the tenant config has not provided a `content_bar_default`.
const deviceDefault = (): boolean => {
  try { return !isFireTV(); } catch { return true; }
};

const resolveInitial = (tenantDefault: boolean | undefined): boolean => {
  if (hasSavedPref()) return readSavedPref();
  if (typeof tenantDefault === 'boolean') return tenantDefault;
  return deviceDefault();
};

export const readMediaBarEnabled = (): boolean => {
  // Legacy export used by code paths outside React. Uses device default when
  // no preference exists — tenant default is honored via the hook below.
  if (hasSavedPref()) return readSavedPref();
  return deviceDefault();
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
  const { settings } = useTenant();
  const tenantDefault = settings.content_bar_default;
  const [enabled, setEnabledState] = useState<boolean>(() => resolveInitial(tenantDefault));

  // If the tenant default changes (e.g. config arrives after first render) and
  // the user has no explicit saved preference, follow the tenant default.
  useEffect(() => {
    if (!hasSavedPref() && typeof tenantDefault === 'boolean') {
      setEnabledState(tenantDefault);
    }
  }, [tenantDefault]);

  useEffect(() => {
    const onChange = (e: Event) => {
      const ce = e as CustomEvent<boolean>;
      if (typeof ce.detail === 'boolean') setEnabledState(ce.detail);
      else setEnabledState(resolveInitial(tenantDefault));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setEnabledState(resolveInitial(tenantDefault));
    };
    window.addEventListener(EVENT, onChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [tenantDefault]);

  const set = (v: boolean) => {
    setEnabledState(v);
    setMediaBarEnabled(v);
  };

  return [enabled, set];
};
