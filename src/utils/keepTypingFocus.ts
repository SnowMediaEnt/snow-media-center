import type { MouseEvent } from 'react';

// A tap on a button while a text box has the keyboard up: the button must not
// take focus. Taking it blurred the box, the phone's keyboard went away and the
// form jumped back down under the finger, so the tap's click landed where the
// button had been: Sign in took 2 or 3 presses (Tronix aa7b541). The click
// still reaches the button. The remote (no mouse events) is unaffected.
export function keepTypingFocus(e: MouseEvent<HTMLElement>): void {
  const target = e.target as HTMLElement | null;
  const active = document.activeElement as HTMLElement | null;
  const typing = !!active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  if (typing && target?.closest?.('button')) e.preventDefault();
}
