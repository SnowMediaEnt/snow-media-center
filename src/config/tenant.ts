// Tenant code resolution. Defaults to 'snowmedia' so the existing production
// build is unchanged when no tenant code is configured.
//
// Resolution priority (build-time always wins so reseller APKs can't be overridden):
// 1. import.meta.env.VITE_TENANT_CODE
// 2. ?tenant=<code> URL query param (persisted to localStorage for reloads)
// 3. localStorage smc-tenant-override
// 4. window.__TENANT_CODE
// 5. 'snowmedia'

function resolveTenantCode(): string {
  const buildTime = (import.meta.env.VITE_TENANT_CODE as string)?.trim();
  if (buildTime) return buildTime;

  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('tenant')?.trim();
    if (fromQuery) {
      try {
        localStorage.setItem('smc-tenant-override', fromQuery);
      } catch {
        // ignore storage errors
      }
      return fromQuery;
    }

    try {
      const fromStorage = localStorage.getItem('smc-tenant-override')?.trim();
      if (fromStorage) return fromStorage;
    } catch {
      // ignore storage errors
    }

    const fromWindow = (window as any).__TENANT_CODE?.trim();
    if (fromWindow) return fromWindow;
  }

  return 'snowmedia';
}

export const TENANT_CODE = resolveTenantCode();
