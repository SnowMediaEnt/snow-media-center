/**
 * Owner, 2026-10-29: "Mad confusing in plex, the white is highlighted the ring
 * and then the other is gold like it's highlighted, which one is selected".
 * His photo: Play focused (white face, gold ring), Resume a solid gold pill at
 * rest, and the chosen version a filled gold chip — three things that all
 * looked selected.
 *
 * The rule (plex.css, "Pills and chips"): focus is the ONLY white face + gold
 * ring; nothing at rest is filled gold or white; a chosen-but-unfocused thing
 * gets a gold check / outline, no fill, and keeps its check when focused.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./PlexImage', () => ({ default: () => null }));
vi.mock('@/lib/plexProgress', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plexProgress')>();
  // 13 minutes in: the title page offers Resume next to Play.
  return { ...actual, resumeSeconds: (rk: string) => (rk === '101' ? 13 * 60 : undefined) };
});
vi.mock('@/lib/plex', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plex')>();
  return {
    ...actual,
    getPlexMetadata: vi.fn(async (_b: string, _t: string, rk: string) => ({
      ratingKey: rk, title: 'The Film', type: 'movie', genres: [], cast: [], directors: [],
      guid: 'plex://movie/abc',
      partKey: '/library/parts/1/file.mkv',
      versions: actual.mediaVersions({
        Media: [
          { videoResolution: '1080', bitrate: 10000, Part: [{ key: '/library/parts/1/file.mkv' }] },
          { videoResolution: '4k', bitrate: 48000, Part: [{ key: '/library/parts/2/file.mkv' }] },
        ],
      }, rk),
    })),
    findPlexCopies: vi.fn(async () => []),
  };
});

import PlexDetail from './PlexDetail';
import { setPlexKeyOwner } from './plexKeyOwner';
import { _resetPlexSpeedCache, _setPlexSpeed } from '@/lib/plexVersions';

const BASE = 'http://srv:32400';
const press = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });

// Anything that would paint a gold or white face on a control at rest.
const FILLS = ['plex-pill--gold', 'plex-pill--white', 'tv-ring-contrast', 'bg-brand-gold', 'bg-white '];
const hasFill = (el: Element) => {
  const cls = `${el.className} `;
  return FILLS.some((f) => cls.includes(f));
};
const pill = (label: RegExp) => screen.getByText(label).closest('button') as HTMLButtonElement;
const chip = (label: string) => screen.getAllByText(label).map((n) => n.closest('button')).find((b) => b?.classList.contains('plex-chip')) as HTMLButtonElement;

describe('the Plex title page has one highlight', () => {
  beforeEach(() => { setPlexKeyOwner('detail'); _resetPlexSpeedCache(); _setPlexSpeed(BASE, 100000); });
  afterEach(() => { _resetPlexSpeedCache(); });

  it('Play focused: Resume is glass, not gold; the chosen version has a check and no fill', async () => {
    render(<PlexDetail isActive base={BASE} token="tok" item={{ ratingKey: '101', title: 'The Film', type: 'movie', videoResolution: '1080' }} onPlay={vi.fn()} onPlayEpisode={vi.fn()} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Play 1080p')).toBeTruthy(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByText(/^Resume/)).toBeTruthy(), { timeout: 5000 });

    const play = pill(/^Play 1080p$/);
    const resume = pill(/^Resume/);
    expect(play.getAttribute('data-focused')).toBe('true');
    expect(play.className).toContain('plex-pill');
    expect(play.className).toContain('tv-ring');

    // Resume: not focused, the way in — brighter glass, never a gold/white fill.
    expect(resume.getAttribute('data-focused')).toBe('false');
    expect(hasFill(resume)).toBe(false);
    expect(resume.className).toContain('plex-pill--primary');
    // No control on the page carries a gold/white fill class.
    for (const b of Array.from(document.querySelectorAll('button'))) expect(hasFill(b)).toBe(false);

    // The chosen version (1080p): a check and the gold outline, no fill.
    const chosen = chip('1080p');
    const other = chip('4K');
    expect(chosen.getAttribute('data-focused')).toBe('false');
    expect(chosen.className).toContain('plex-chip--set');
    expect(chosen.querySelector('.plex-check')).not.toBeNull();
    expect(hasFill(chosen)).toBe(false);
    expect(other.className).not.toContain('plex-chip--set');
    expect(other.querySelector('.plex-check')).toBeNull();
  });

  it('the chosen version focused: the focus look, with the check still there', async () => {
    render(<PlexDetail isActive base={BASE} token="tok" item={{ ratingKey: '101', title: 'The Film', type: 'movie', videoResolution: '1080' }} onPlay={vi.fn()} onPlayEpisode={vi.fn()} onBack={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Play 1080p')).toBeTruthy(), { timeout: 5000 });
    // ▼ to the versions: they open on the one in effect (1080p).
    press('ArrowDown');
    await waitFor(() => expect(chip('1080p').getAttribute('data-focused')).toBe('true'));
    const chosen = chip('1080p');
    // Focus look: the chip's white face + gold ring (plex.css keys both on
    // .plex-chip.tv-ring[data-focused="true"]) — and no other control is focused.
    expect(chosen.className).toContain('plex-chip');
    expect(chosen.className).toContain('tv-ring');
    expect(chosen.querySelector('.plex-check')).not.toBeNull();
    expect(document.querySelectorAll('button[data-focused="true"]')).toHaveLength(1);
    expect(pill(/^Play 1080p$/).getAttribute('data-focused')).toBe('false');
    // ◀ to 4K: the focus moves, 1080p is still the chosen one (check, outline).
    press('ArrowLeft');
    await waitFor(() => expect(chip('4K').getAttribute('data-focused')).toBe('true'));
    expect(chip('1080p').className).toContain('plex-chip--set');
    expect(chip('1080p').querySelector('.plex-check')).not.toBeNull();
    expect(chip('4K').querySelector('.plex-check')).toBeNull();
  });
});

describe('plex.css carries the rule', () => {
  it('no gold or white pill fills at rest; focus is the white face; chosen is an outline', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const css = fs.readFileSync(path.resolve(__dirname, '../../styles/plex.css'), 'utf8');
    expect(css).not.toMatch(/\.plex-pill--gold\s*\{/);
    expect(css).not.toMatch(/\.plex-pill--white\s*\{/);
    const block = (sel: string) => {
      const i = css.indexOf(`${sel} {`);
      expect(i).toBeGreaterThanOrEqual(0);
      return css.slice(i, css.indexOf('}', i));
    };
    expect(block('.plex-pill[data-focused="true"]')).toContain('background-color: #fff');
    expect(block('.plex-chip[data-focused="true"]')).toContain('background-color: #fff');
    const set = block('.plex-chip--set');
    expect(set).not.toContain('background');
    expect(set).toContain('box-shadow');
    expect(block('.plex-menu-item--sel')).not.toContain('background');
  });
});
