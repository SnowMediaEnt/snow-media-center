// Tenant code resolution.
//
// Resolution priority (build-time always wins so reseller APKs can't be overridden):
// 1. import.meta.env.VITE_TENANT_CODE (when not the literal 'ask')
// 2. ?tenant=<code> URL query param (persisted to localStorage for reloads)
// 3. localStorage smc-tenant-override
// 4. window.__TENANT_CODE
// 5. If build-time code is 'ask' → return 'ask' sentinel (universal build, prompts user)
// 6. else 'snowmedia'

export const STORAGE_KEY = 'smc-tenant-override';

const RAW_BUILD_TIME = (import.meta.env.VITE_TENANT_CODE as string | undefined)?.trim();
export const BUILD_TIME_TENANT_CODE: string | null = RAW_BUILD_TIME && RAW_BUILD_TIME.length > 0
  ? RAW_BUILD_TIME
  : null;

// "Universal" build — the APK was built without a baked tenant and must ask the
// end user for a reseller code on first launch.
export const IS_UNIVERSAL_BUILD = BUILD_TIME_TENANT_CODE === 'ask';

export function getStoredTenantCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('tenant')?.trim();
    if (fromQuery) {
      try { localStorage.setItem(STORAGE_KEY, fromQuery); } catch { /* ignore */ }
      return fromQuery;
    }
  } catch { /* ignore */ }
  try {
    const fromStorage = localStorage.getItem(STORAGE_KEY)?.trim();
    if (fromStorage) return fromStorage;
  } catch { /* ignore */ }
  try {
    const fromWindow = (window as any).__TENANT_CODE?.trim();
    if (fromWindow) return fromWindow;
  } catch { /* ignore */ }
  return null;
}

export function setStoredTenantCode(code: string): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, code.trim()); } catch { /* ignore */ }
}

export function clearStoredTenantCode(): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

function resolveTenantCode(): string {
  // Baked, non-universal build always wins.
  if (BUILD_TIME_TENANT_CODE && BUILD_TIME_TENANT_CODE !== 'ask') {
    return BUILD_TIME_TENANT_CODE;
  }
  const stored = getStoredTenantCode();
  if (stored) return stored;
  // Universal build with nothing stored → sentinel; TenantContext will prompt.
  if (IS_UNIVERSAL_BUILD) return 'ask';
  return 'snowmedia';
}

export const TENANT_CODE = resolveTenantCode();
