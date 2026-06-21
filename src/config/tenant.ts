// Tenant code resolution. Defaults to 'snowmedia' so the existing production
// build is unchanged when no tenant code is configured.
export const TENANT_CODE = (
  (import.meta.env.VITE_TENANT_CODE as string) ||
  (typeof window !== 'undefined' ? (window as any).__TENANT_CODE : '') ||
  'snowmedia'
).trim();
