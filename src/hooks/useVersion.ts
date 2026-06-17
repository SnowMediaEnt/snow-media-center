import { useEffect, useState } from 'react';
import { isNativePlatform } from '@/utils/platform';
import { runWhenIdle } from '@/utils/idle';

// Module-level singleton — getAppInfo() on Android costs ~150ms and was
// running 3-4x at boot from concurrent useVersion mounts. Resolve once, share.

interface VersionSnap {
  version: string;
  versionCode: number;
  isLoading: boolean;
}

let snap: VersionSnap = { version: '1.0.0', versionCode: 0, isLoading: true };
let inflight: Promise<void> | null = null;
let hasFetched = false;
let scheduled = false;

const listeners = new Set<(s: VersionSnap) => void>();
const emit = () => { listeners.forEach((l) => l(snap)); };

const runFetch = async (): Promise<void> => {
  if (inflight) return inflight;
  if (hasFetched) return;
  inflight = (async () => {
    try {
      if (isNativePlatform()) {
        const { AppManager } = await import('@/capacitor/AppManager');
        const nativeInfo = await AppManager.getAppInfo({});
        if (nativeInfo?.versionName) {
          snap = { version: nativeInfo.versionName, versionCode: nativeInfo.versionCode || 0, isLoading: false };
          hasFetched = true;
          return;
        }
      }
      const response = await fetch('/version.json');
      if (response.ok) {
        const data = await response.json();
        snap = { ...snap, version: data.currentVersion || '1.0.0', isLoading: false };
      } else {
        snap = { ...snap, version: '1.0.0', isLoading: false };
      }
    } catch {
      snap = { ...snap, version: '1.0.0', isLoading: false };
    } finally {
      hasFetched = true;
      inflight = null;
      emit();
    }
  })();
  return inflight;
};

export const useVersion = () => {
  const [s, setS] = useState<VersionSnap>(snap);
  useEffect(() => {
    listeners.add(setS);
    setS(snap);
    if (!hasFetched && !scheduled) {
      scheduled = true;
      // Defer the (potentially native) call so it doesn't compete with first paint.
      runWhenIdle(() => { runFetch().catch(() => { /* ignore */ }); }, 500);
    }
    return () => { listeners.delete(setS); };
  }, []);
  return s;
};
