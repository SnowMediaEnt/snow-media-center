import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { TENANT_CODE } from '@/config/tenant';
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

const CACHE_KEY = `canvas-tenant-config:${TENANT_CODE}`;

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

// Deep-merge an incoming (possibly partial) config over DEFAULTS so missing
// sub-fields gracefully fall back to Snow Media defaults.
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
};

const TenantContext = createContext<TenantContextValue | null>(null);

const readCache = (): TenantConfig | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return mergeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeCache = (cfg: TenantConfig) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
};

export const TenantProvider = ({ children }: { children: ReactNode }) => {
  const initial = readCache() ?? DEFAULTS;
  const [config, setConfig] = useState<TenantConfig>(initial);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Apply branding to document: CSS vars + title. Snow Media's defaults
    // already match the current hard-coded values, so no visible change.
    try {
      const root = document.documentElement;
      root.style.setProperty('--brand-gold', config.branding.primary_color);
      root.style.setProperty('--brand-ice', config.branding.accent_color);
      document.title = config.branding.app_display_name;
    } catch { /* noop */ }
  }, [config.branding.primary_color, config.branding.accent_color, config.branding.app_display_name]);

  useEffect(() => {
    let cancelled = false;
    const cancelIdle = runWhenIdle(async () => {
      try {
        const { data, error } = await supabase.rpc('get_tenant_config', {
          p_code: TENANT_CODE,
        });
        if (cancelled) return;
        if (error) {
          console.warn('[tenant] get_tenant_config error:', error.message);
          return;
        }
        if (data && typeof data === 'object') {
          const merged = mergeConfig(data);
          setConfig(merged);
          writeCache(merged);
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
  }, []);

  const value: TenantContextValue = {
    code: TENANT_CODE,
    config,
    branding: config.branding,
    settings: config.settings,
    features: config.features,
    isFeatureEnabled: (key: string) =>
      config.features[key] ?? DEFAULTS.features[key] ?? false,
    isLoading,
  };

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
};

export const useTenant = (): TenantContextValue => {
  const ctx = useContext(TenantContext);
  if (ctx) return ctx;
  // Safe fallback — never crash if used outside provider.
  return {
    code: TENANT_CODE,
    config: DEFAULTS,
    branding: DEFAULTS.branding,
    settings: DEFAULTS.settings,
    features: DEFAULTS.features,
    isFeatureEnabled: (key: string) => DEFAULTS.features[key] ?? false,
    isLoading: false,
  };
};
