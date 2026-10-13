// A key the box itself delivered (the remote, or its on-screen keyboard) — not
// one the page made up (the phone remote's, a test's) — in the app on a
// device. Its own module so tests can stand in for a real press.
import { isFireTV, isNativePlatform } from '@/utils/platform';

export const isDeviceKey = (e: Event): boolean => !!e.isTrusted && isNativePlatform();

/** A Fire TV raises Amazon's keyboard by itself on a focused text box, and
 *  sends an Enter as Back closes it (useTVFocus). */
export const platformRaisesKeyboard = (): boolean => isFireTV();
