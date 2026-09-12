/**
 * The native tiles render BEHIND the WebView. Every DOM ancestor of an
 * occupied tile must therefore be transparent, or the video is painted over —
 * black picture, audio underneath. The grid root gained bg-black on
 * 2026-07-06 and nothing cleared it. This pins the source: the grid-mode root
 * carries no background class, and an occupied tile carries none either.
 */
import { describe, expect, it } from 'vitest';
// Vite's ?raw gives the source text; the assertions are about the markup, not
// the rendered component, because the thing being pinned is a class name.
import src from './MultiScreenSection.tsx?raw';

describe('Multi-Screen grid transparency', () => {
  it('the grid-mode root has no background class', () => {
    const gridMode = src.slice(src.indexOf('// Grid mode'));
    const rootTag = gridMode.match(/<div className="([^"]*)">\s*\{\/\* Transparent grid/);
    expect(rootTag, 'grid root not found where expected').toBeTruthy();
    expect(rootTag![1]).not.toMatch(/\bbg-/);
    expect(rootTag![1]).not.toMatch(/backdrop-/);
  });

  it('an occupied tile paints no background of its own', () => {
    // Empty tiles are black on purpose; occupied ones must be see-through.
    expect(src).toMatch(/occupied \? '' : 'bg-black'/);
  });
});
