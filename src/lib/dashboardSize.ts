// How big the Dashboard draws. Compact fits a 1080p TV without scrolling;
// Large is the roomier original for anyone who finds the compact text small.
// Chosen under Settings → UI and remembered on the device.
import { useEffect, useState } from 'react';

export type DashboardSize = 'compact' | 'large';

export const DASHBOARD_SIZE_EVENT = 'dashboard:size';
const KEY = 'snow-dashboard-size';

export const loadDashboardSize = (): DashboardSize => {
  try { if (localStorage.getItem(KEY) === 'large') return 'large'; } catch { /* private mode */ }
  return 'compact';
};

export const saveDashboardSize = (size: DashboardSize): void => {
  try { localStorage.setItem(KEY, size); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(DASHBOARD_SIZE_EVENT, { detail: size })); } catch { /* ignore */ }
};

export function useDashboardSize(): DashboardSize {
  const [size, setSize] = useState<DashboardSize>(() => loadDashboardSize());
  useEffect(() => {
    const on = () => setSize(loadDashboardSize());
    window.addEventListener(DASHBOARD_SIZE_EVENT, on);
    return () => window.removeEventListener(DASHBOARD_SIZE_EVENT, on);
  }, []);
  return size;
}
