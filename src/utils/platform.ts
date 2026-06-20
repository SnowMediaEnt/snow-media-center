// Platform detection utilities - safe for both web and native
// This module handles platform detection without breaking web builds

let _isNative: boolean | null = null;

/**
 * True when running on an Amazon Fire TV / Firestick / Fire TV Cube.
 * Detected via the WebView User-Agent (AFTxx model codes, "Fire TV", "FireOS").
 * Used to apply Amazon-WebView-specific workarounds in the video player
 * (mpegts.js for live, conservative hls.js config, stall watchdogs).
 * Returns false on regular Android TV boxes — they keep the default path.
 */
export const isFireTV = (): boolean =>
  typeof navigator !== 'undefined' &&
  /\bAFT[A-Z0-9]+\b|Fire ?TV|FireOS/i.test(navigator.userAgent || '');

export const isNativePlatform = (): boolean => {
  if (_isNative !== null) return _isNative;
  
  try {
    // Check if Capacitor is available and we're on a native platform
    const win = window as any;
    _isNative = !!(win.Capacitor && win.Capacitor.isNativePlatform && win.Capacitor.isNativePlatform());
  } catch {
    _isNative = false;
  }
  
  return _isNative;
};

export const getPlatform = (): 'android' | 'ios' | 'web' => {
  try {
    const win = window as any;
    if (win.Capacitor && win.Capacitor.getPlatform) {
      return win.Capacitor.getPlatform();
    }
  } catch {
    // Fallback to web
  }
  return 'web';
};

// Safe wrapper for native-only operations
export const runOnNative = async <T>(
  nativeCallback: () => Promise<T>,
  webFallback: () => T | Promise<T>
): Promise<T> => {
  if (isNativePlatform()) {
    try {
      return await nativeCallback();
    } catch (error) {
      console.warn('Native operation failed, using fallback:', error);
      return await webFallback();
    }
  }
  return await webFallback();
};
