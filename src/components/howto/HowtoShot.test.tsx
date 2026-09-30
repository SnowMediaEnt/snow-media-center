import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { HowtoArt } from '@/data/howtoContract';

const lang = vi.hoisted(() => ({ current: 'en' }));

// Words come back as "T:<key>", so a test can see which key a label asked for.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => 'T:' + k, i18n: { language: lang.current } }),
}));

// English and Spanish (and Arabic) have the picture; French has none. 'store' has no picture at all.
vi.mock('@/data/howtoRects.json', () => {
  const home = { bytes: 100, rects: { 'home.cardLivetv': [10, 60, 20, 25], 'home.cardPlex': [40, 60, 20, 25], 'home.cardSupport': [70, 60, 20, 25] } };
  return { default: { version: 1, width: 1024, height: 576, langs: { en: { home }, es: { home }, ar: { home } } } };
});

import HowtoShot from './HowtoShot';

const one: HowtoArt = { shot: 'home', highlights: [{ id: 'home.cardLivetv', labelKey: 'guides.howTo.labels.liveTv' }] };
const three: HowtoArt = {
  shot: 'home',
  highlights: [
    { id: 'home.cardLivetv', labelKey: 'guides.howTo.labels.liveTv' },
    { id: 'home.cardPlex', labelKey: 'guides.howTo.labels.plexVod' },
    { id: 'home.cardSupport', labelKey: 'guides.howTo.labels.help' },
  ],
};

beforeEach(() => { lang.current = 'en'; });

describe('HowtoShot', () => {
  it('shows the picture in the current language', () => {
    lang.current = 'es';
    const { container } = render(<HowtoShot art={one} />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/howto/es/home.webp');
  });

  it('understands a regional language code', () => {
    lang.current = 'es-MX';
    const { container } = render(<HowtoShot art={one} />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/howto/es/home.webp');
  });

  it('shows the English picture when the language has none', () => {
    lang.current = 'fr';
    const { container } = render(<HowtoShot art={one} />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/howto/en/home.webp');
  });

  it('shows the schematic when the shot has no picture', () => {
    const { container } = render(<HowtoShot art={{ shot: 'store', highlights: [{ id: 'store.grid', labelKey: 'guides.howTo.labels.products' }] }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('howto-schematic')).toBeTruthy();
    expect(screen.queryAllByTestId('howto-ring')).toHaveLength(0);
  });

  it('loads exactly one picture, even with three highlights', () => {
    const { container } = render(<HowtoShot art={three} />);
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('is left to right and hidden from screen readers, also in Arabic', () => {
    lang.current = 'ar';
    render(<HowtoShot art={three} />);
    const frame = screen.getByTestId('howto-frame');
    expect(frame.getAttribute('dir')).toBe('ltr');
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.querySelector('img')!.getAttribute('src')).toBe('/howto/ar/home.webp');
  });

  it('draws a ring and a label for each highlight that has a rect', () => {
    render(<HowtoShot art={{ shot: 'home', highlights: [...one.highlights!, { id: 'home.clock', labelKey: 'guides.howTo.labels.dateTime' }] }} />);
    // home.clock has no measured rect in this picture: it gets no ring and no label.
    expect(screen.getAllByTestId('howto-ring')).toHaveLength(1);
    expect(screen.getAllByTestId('howto-label')).toHaveLength(1);
    expect(screen.getByText('T:guides.howTo.labels.liveTv')).toBeTruthy();
    expect(screen.queryByText('T:guides.howTo.labels.dateTime')).toBeNull();
  });

  it('dims the rest of the picture only when something is lit', () => {
    const { rerender } = render(<HowtoShot art={one} />);
    expect(screen.getAllByTestId('howto-dim')).toHaveLength(1);
    rerender(<HowtoShot art={{ shot: 'home' }} />);
    expect(screen.queryAllByTestId('howto-dim')).toHaveLength(0);
  });

  it('numbers the labels only when there are two or more', () => {
    const { unmount } = render(<HowtoShot art={one} />);
    expect(screen.queryAllByTestId('howto-badge')).toHaveLength(0);
    unmount();
    render(<HowtoShot art={three} />);
    expect(screen.getAllByTestId('howto-badge').map((b) => b.textContent)).toEqual(['1', '2', '3']);
  });

  it('keeps every label inside the picture', () => {
    render(<HowtoShot art={three} />);
    for (const label of screen.getAllByTestId('howto-label')) {
      const left = parseFloat(label.style.left);
      const top = parseFloat(label.style.top);
      const max = parseFloat(label.style.maxWidth);
      expect(left).toBeGreaterThanOrEqual(1);
      expect(top).toBeGreaterThanOrEqual(1);
      expect(left + max).toBeLessThanOrEqual(99.01);
    }
  });

  it('shows the remote hint chip, with the picture or the schematic', () => {
    const { unmount } = render(<HowtoShot art={{ ...one, remote: 'holdOk' }} />);
    expect(screen.getByTestId('howto-remote-chip').textContent).toBe('T:guides.howTo.remote.holdOk');
    unmount();
    render(<HowtoShot art={{ shot: 'store', remote: 'ok' }} />);
    expect(screen.getByTestId('howto-remote-chip').textContent).toBe('T:guides.howTo.remote.ok');
  });

  it('shows no chip when the slide has no remote hint', () => {
    render(<HowtoShot art={one} />);
    expect(screen.queryByTestId('howto-remote-chip')).toBeNull();
  });

  it('falls back to the schematic when the picture fails to load', () => {
    const { container } = render(<HowtoShot art={{ ...one, remote: 'ok' }} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('howto-schematic')).toBeTruthy();
    expect(screen.getByTestId('howto-remote-chip')).toBeTruthy();
  });

  it('tries the picture again on the next slide after one failed', () => {
    const { container, rerender } = render(<HowtoShot art={one} />);
    fireEvent.error(container.querySelector('img')!);
    lang.current = 'es';
    rerender(<HowtoShot art={one} />);
    expect(container.querySelector('img')!.getAttribute('src')).toBe('/howto/es/home.webp');
  });

  it('draws the remote (no picture) with its rings and labels', () => {
    const { container } = render(
      <HowtoShot
        art={{
          shot: 'remote',
          highlights: [
            { id: 'remote.arrows', labelKey: 'guides.howTo.labels.move' },
            { id: 'remote.ok', labelKey: 'guides.howTo.labels.okHold' },
            { id: 'remote.back', labelKey: 'guides.howTo.labels.back' },
          ],
        }}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('howto-remote-diagram')).toBeTruthy();
    expect(screen.getAllByTestId('howto-ring')).toHaveLength(3);
    expect(screen.getAllByTestId('howto-label')).toHaveLength(3);
    expect(screen.getByText('T:guides.howTo.labels.okHold')).toBeTruthy();
  });

  it('pulses the ring, except on low-memory boxes', () => {
    const { unmount } = render(<HowtoShot art={one} />);
    expect(screen.getByTestId('howto-ring').className).toContain('animate-pulse');
    unmount();
    document.documentElement.classList.add('native-low-memory');
    try {
      render(<HowtoShot art={one} />);
      expect(screen.getByTestId('howto-ring').className).not.toContain('animate-pulse');
    } finally {
      document.documentElement.classList.remove('native-low-memory');
    }
  });

  it('uses a 16:9 frame with a padding-top fallback (Chrome 66 has no aspect-ratio)', () => {
    render(<HowtoShot art={one} />);
    expect(screen.getByTestId('howto-frame').style.paddingTop).toBe('56.25%');
  });
});
