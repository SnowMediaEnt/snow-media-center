import { describe, expect, it } from 'vitest';
import { tmdbSized } from './tmdbImage';

describe('tmdbSized', () => {
  it('shrinks original and oversized TMDB posters', () => {
    expect(tmdbSized('https://image.tmdb.org/t/p/original/a.jpg')).toBe('https://image.tmdb.org/t/p/w342/a.jpg');
    expect(tmdbSized('https://image.tmdb.org/t/p/w1280/a.jpg')).toBe('https://image.tmdb.org/t/p/w342/a.jpg');
    expect(tmdbSized('https://image.tmdb.org/t/p/w500/a.jpg', 'w185')).toBe('https://image.tmdb.org/t/p/w185/a.jpg');
  });
  it('never enlarges and leaves other hosts alone', () => {
    expect(tmdbSized('https://image.tmdb.org/t/p/w185/a.jpg')).toBe('https://image.tmdb.org/t/p/w185/a.jpg');
    expect(tmdbSized('http://panel.example/icons/a.png')).toBe('http://panel.example/icons/a.png');
    expect(tmdbSized(undefined)).toBeUndefined();
    expect(tmdbSized('')).toBeUndefined();
  });
});
