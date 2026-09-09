import '@testing-library/react';

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
