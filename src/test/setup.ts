import '@testing-library/react';
import { beforeEach } from 'vitest';
import i18n, { LANG_STORAGE_KEY } from '@/i18n';

/**
 * jsdom never implements offsetParent, and the TV focus hook uses it to decide
 * whether a control is on screen. Without this every managed element would look
 * hidden and no test could focus anything.
 */
Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
  configurable: true,
  get(this: HTMLElement) {
    return this.isConnected ? document.body : null;
  },
});

// scrollIntoView is called on every focus move.
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

// Every test starts in English, whatever a previous test or the box's saved choice was.
// (i18n starts synchronously under Vitest, so nothing here is async.)
try { localStorage.removeItem(LANG_STORAGE_KEY); } catch { /* ignore */ }
void i18n.changeLanguage('en');
beforeEach(() => {
  if (i18n.language !== 'en') void i18n.changeLanguage('en');
});
