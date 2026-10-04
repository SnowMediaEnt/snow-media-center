/**
 * Low-memory boxes (`native-low-memory` on the page): every non-essential
 * animation is cut to an instant. An infinite one at 0.001ms still restarted
 * every frame; it now runs once and stops. The exemptions (the news ticker,
 * spinners, the loader's parts) stay as they are.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const css = fs.readFileSync(path.resolve(__dirname, 'index.css'), 'utf8');

describe('index.css — the low-memory animation rule', () => {
  it('runs an animation once, not forever, and keeps its exemptions', () => {
    const at = css.indexOf('.native-low-memory *:not(.news-ticker)');
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toContain('animation-duration: 0.001ms !important;');
    expect(rule).toContain('animation-iteration-count: 1 !important;');
    for (const keep of ['.news-ticker-track', '.animate-spin', '.smc-loader-track', '.smc-loader-ball-wrap']) expect(rule).toContain(`:not(${keep})`);
  });
});
