import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  TENANT_CODE,
  IS_UNIVERSAL_BUILD,
  setStoredTenantCode,
  clearStoredTenantCode,
} from '@/config/tenant';
import { runWhenIdle } from '@/utils/idle';

export type TenantConfig = {
  tenant: { code: string; name: string };
  branding: {
    app_display_name: string;
    in_app_logo_url: string | null;
    background_style: string;
    tagline: string;
    primary_color: string;
    accent_color: string;
    splash_bg: string;
    background_image_url: string | null;
    background_manifest_url: string | null;
    attribution: string | null;
  };
  settings: {
    support_email: string | null;
    apps_source_url: string | null;
    content_bar_default: boolean;
    plex_autoconnect: boolean;
    rss_url: string | null;
    community_enabled: boolean;
  };
  features: Record<string, boolean>;
};

// Full Snow Media defaults — if the RPC fails or returns a partial object,
// every missing field falls back to today's production behavior.
export const DEFAULTS: TenantConfig = {
  tenant: { code: 'snowmedia', name: 'Snow Media Center' },
  branding: {
    app_display_name: 'Snow Media Center',
    in_app_logo_url: null,
    background_style: 'snow',
    tagline: 'Stay Streamin — Stay Dreamin',
    primary_color: '#c3aa72',
    accent_color: '#a1d5dc',
    splash_bg: '#092145',
    background_image_url: null,
    background_manifest_url: null,
    attribution: null,
  },
  settings: {
    support_email: 'support@snowmediaent.com',
    apps_source_url: 'https://snowmediaapps.com/apps/apps.json.php',
    content_bar_default: false,
    plex_autoconnect: true,
    rss_url: 'https://snowmediaapps.com/smc/newsfeed.xml',
    community_enabled: true,
  },
  features: {
    support_videos: true,
    games: true,
    ai: true,
    wix_store: true,
    community: true,
    customer_dashboard: true,
    content_bar: true,
  },
};

const cacheKeyFor = (code: string) => `canvas-tenant-config:${code}`;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const mergeConfig = (incoming: unknown): TenantConfig => {
  if (!isObj(incoming)) return DEFAULTS;
  const inc = incoming as Partial<TenantConfig>;
  return {
    tenant: { ...DEFAULTS.tenant, ...(isObj(inc.tenant) ? inc.tenant : {}) },
    branding: { ...DEFAULTS.branding, ...(isObj(inc.branding) ? inc.branding : {}) },
    settings: { ...DEFAULTS.settings, ...(isObj(inc.settings) ? inc.settings : {}) },
    features: { ...DEFAULTS.features, ...(isObj(inc.features) ? inc.features : {}) },
  };
};

type TenantContextValue = {
  code: string;
  config: TenantConfig;
  branding: TenantConfig['branding'];
  settings: TenantConfig['settings'];
  features: TenantConfig['features'];
  isFeatureEnabled: (key: string) => boolean;
  isLoading: boolean;
  isUniversalBuild: boolean;
  needsTenantCode: boolean;
  setTenantCode: (code: string) => Promise<boolean>;
  clearTenantCode: () => void;
};

const TenantContext = createContext<TenantContextValue | null>(null);

const readCache = (code: string): TenantConfig | null => {
  try {
    const raw = localStorage.getItem(cacheKeyFor(code));
    if (!raw) return null;
    return mergeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeCache = (code: string, cfg: TenantConfig) => {
  try {
    localStorage.setItem(cacheKeyFor(code), JSON.stringify(cfg));
  } catch { /* ignore */ }
};

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  const [activeCode, setActiveCode] = useState<string>(TENANT_CODE);
  const initialConfig = activeCode === 'ask' ? DEFAULTS : (readCache(activeCode) ?? DEFAULTS);
  const [config, setConfig] = useState<TenantConfig>(initialConfig);
  const [isLoading, setIsLoading] = useState(activeCode !== 'ask');

  const needsTenantCode = IS_UNIVERSAL_BUILD && activeCode === 'ask';

  useEffect(() => {
    try {
      const root = document.documentElement;
      root.style.setProperty('--brand-gold', config.branding.primary_color);
      root.style.setProperty('--brand-ice', config.branding.accent_color);
      document.title = config.branding.app_display_name;
    } catch { /* noop */ }
  }, [config.branding.primary_color, config.branding.accent_color, config.branding.app_display_name]);

  // Fetch config whenever the active code changes — skips the 'ask' sentinel.
  useEffect(() => {
    if (activeCode === 'ask') {
      setIsLoading(false);
      return;
    }
    // Seed from cache for the new code immediately.
    const cached = readCache(activeCode);
    if (cached) setConfig(cached);

    let cancelled = false;
    setIsLoading(true);
    const cancelIdle = runWhenIdle(async () => {
      try {
        const { data, error } = await supabase.rpc('get_tenant_config', {
          p_code: activeCode,
        });
        if (cancelled) return;
        if (error) {
          console.warn('[tenant] get_tenant_config error:', error.message);
          return;
        }
        if (data && typeof data === 'object') {
          const merged = mergeConfig(data);
          setConfig(merged);
          writeCache(activeCode, merged);
        }
      } catch (e) {
        console.warn('[tenant] get_tenant_config threw:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }, 1500);

    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [activeCode]);

  // Validate + persist a tenant code. Returns true if accepted.
  const setTenantCode = useCallback(async (code: string): Promise<boolean> => {
    const trimmed = code.trim();
    if (!trimmed) return false;
    try {
      const { data, error } = await supabase.rpc('get_tenant_config', { p_code: trimmed });
      if (error || !data) return false;
      const merged = mergeConfig(data);
      setStoredTenantCode(trimmed);
      writeCache(trimmed, merged);
      setConfig(merged);
      setActiveCode(trimmed);
      return true;
    } catch {
      return false;
    }
  }, []);

  const clearTenantCode = useCallback(() => {
    clearStoredTenantCode();
    if (IS_UNIVERSAL_BUILD) setActiveCode('ask');
  }, []);

  const value: TenantContextValue = {
    code: activeCode,
    config,
    branding: config.branding,
    settings: config.settings,
    features: config.features,
    isFeatureEnabled: (key: string) =>
      config.features[key] ?? DEFAULTS.features[key] ?? false,
    isLoading,
    isUniversalBuild: IS_UNIVERSAL_BUILD,
    needsTenantCode,
    setTenantCode,
    clearTenantCode,
  };

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
};

export const useTenant = (): TenantContextValue => {
  const ctx = useContext(TenantContext);
  if (ctx) return ctx;
  return {
    code: TENANT_CODE,
    config: DEFAULTS,
    branding: DEFAULTS.branding,
    settings: DEFAULTS.settings,
    features: DEFAULTS.features,
    isFeatureEnabled: (key: string) => DEFAULTS.features[key] ?? false,
    isLoading: false,
    isUniversalBuild: IS_UNIVERSAL_BUILD,
    needsTenantCode: false,
    setTenantCode: async () => false,
    clearTenantCode: () => { /* noop */ },
  };
};
