import { afterEach, describe, expect, it } from 'vitest';
import { overlayAboveOwnsBack } from './overlayBack';
import { noteVoiceOverlay } from './voiceUi';

type W = { __overlayHandledBackAt?: number };
const popup = (parent: Element, attrs: Record<string, string>) => {
  const el = document.createElement('div');
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent.appendChild(el);
  return el;
};

afterEach(() => {
  document.body.innerHTML = '';
  (window as W).__overlayHandledBackAt = 0;
  noteVoiceOverlay(false, 1);
});

describe('overlayAboveOwnsBack', () => {
  it('nothing on top: the press is the screen\'s', () => {
    expect(overlayAboveOwnsBack()).toBe(false);
  });

  it('an open popup outside the screen takes it; one inside the screen is the screen\'s own', () => {
    const own = popup(document.body, {});
    popup(own, { role: 'dialog', 'aria-modal': 'true' }); // e.g. the guide's Speed Test
    expect(overlayAboveOwnsBack(own)).toBe(false);
    popup(document.body, { role: 'alertdialog', 'data-state': 'open' });
    expect(overlayAboveOwnsBack(own)).toBe(true);
  });

  it('a boot notice takes it', () => {
    popup(document.body, { role: 'dialog', 'data-notice-layer': 'open' });
    expect(overlayAboveOwnsBack()).toBe(true);
  });

  it('the voice overlay takes it while up, and just after Back closed it', () => {
    noteVoiceOverlay(true);
    expect(overlayAboveOwnsBack()).toBe(true);
    noteVoiceOverlay(false, Date.now());
    expect(overlayAboveOwnsBack()).toBe(true);
  });

  it('a press another popup has just answered is not the screen\'s; its own mark and an old one are', () => {
    const now = Date.now();
    (window as W).__overlayHandledBackAt = now;
    expect(overlayAboveOwnsBack(null, 0)).toBe(true);
    expect(overlayAboveOwnsBack(null, now)).toBe(false);
    (window as W).__overlayHandledBackAt = now - 1000;
    expect(overlayAboveOwnsBack(null, 0)).toBe(false);
  });
});
