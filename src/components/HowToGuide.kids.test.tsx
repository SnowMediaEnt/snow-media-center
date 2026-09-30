import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { setKidsLevel } from '@/lib/kidsFilter';

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/components/howto/HowtoShot', () => ({ default: () => <div>art</div> }));

import HowToGuide from './HowToGuide';
import { TUTORIAL_CHAPTERS } from '@/data/tutorialContent';

// The remote's OK arrives as Enter, keyCode 13.
const press = (key: string) => act(() => { fireEvent.keyDown(window, { key, keyCode: key === 'Enter' ? 13 : undefined }); });
const openChapter = (id: string) => {
  const idx = TUTORIAL_CHAPTERS.findIndex((c) => c.id === id);
  expect(idx).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < idx; i++) press('ArrowDown');
  press('Enter');
};
const flush = () => act(() => { vi.runAllTimers(); });
/** Opens a chapter and moves to one of its slides. */
const openSlide = (chapter: string, slideId: string) => {
  openChapter(chapter);
  const idx = TUTORIAL_CHAPTERS.find((c) => c.id === chapter)!.slides.findIndex((sl) => sl.id === slideId);
  expect(idx).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < idx; i++) press('ArrowRight');
};

afterEach(() => { setKidsLevel(null); vi.useRealTimers(); });

describe('How to use SMC on a Kids profile', () => {
  it.each(['apps', 'account'])('offers no jump into the %s chapter\'s grown-up screen', (chapter) => {
    vi.useFakeTimers();
    setKidsLevel('kids');
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<HowToGuide onClose={onClose} onNavigate={onNavigate} />);
    openChapter(chapter);
    const ch = TUTORIAL_CHAPTERS.find((c) => c.id === chapter)!;
    // Walk every slide: Up (where the link would be) then OK.
    for (let i = 0; i < ch.slides.length - 1; i++) {
      expect(screen.queryByText('Take me there')).toBeNull();
      press('ArrowUp');
      press('Enter'); // lands on Next, not a link
      flush();
    }
    expect(onNavigate).not.toHaveBeenCalledWith('apps');
    expect(onNavigate).not.toHaveBeenCalledWith('user');
    expect(onNavigate).not.toHaveBeenCalledWith('store');
    expect(onNavigate).not.toHaveBeenCalledWith('credits');
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each([['apps', 'store'], ['account', 'buyGems']])('shows the %s chapter\'s %s slide without a link to the Store or Snow Gems', (chapter, slideId) => {
    vi.useFakeTimers();
    setKidsLevel('kids');
    const onNavigate = vi.fn();
    render(<HowToGuide onClose={vi.fn()} onNavigate={onNavigate} />);
    openSlide(chapter, slideId);
    expect(screen.queryByText('Take me there')).toBeNull();
    press('ArrowUp');
    press('Enter');
    flush();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('keeps the tickets, cleaner and posts links out of the Support chapter, and the Buffering Guide in', () => {
    setKidsLevel('little');
    render(<HowToGuide onClose={vi.fn()} onNavigate={vi.fn()} />);
    openChapter('support');
    const labels: string[] = [];
    const slides = TUTORIAL_CHAPTERS.find((c) => c.id === 'support')!.slides;
    for (let i = 0; i < slides.length; i++) {
      for (const b of screen.getAllByRole('button')) labels.push(b.textContent ?? '');
      if (i < slides.length - 1) press('ArrowRight');
    }
    expect(labels).toContain('Open it');
    expect(labels).not.toContain('Open tickets');
    expect(labels).not.toContain('Open the cleaner');
    expect(labels).not.toContain('Open Posts');
  });

  it('still takes a child to Live TV', () => {
    vi.useFakeTimers();
    setKidsLevel('kids');
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    render(<HowToGuide onClose={onClose} onNavigate={onNavigate} />);
    openChapter('livetv');
    expect(screen.getByText('Take me there')).toBeTruthy();
    press('ArrowUp');
    press('Enter');
    flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('livetv');
  });
});

describe('How to use SMC on a grown-up profile', () => {
  it('Main Apps still has its Take me there', () => {
    vi.useFakeTimers();
    const onNavigate = vi.fn();
    render(<HowToGuide onClose={vi.fn()} onNavigate={onNavigate} />);
    openChapter('apps');
    expect(screen.getByText('Take me there')).toBeTruthy();
    press('ArrowUp');
    press('Enter');
    flush();
    expect(onNavigate).toHaveBeenCalledWith('apps');
  });

  it.each([['apps', 'store', 'store'], ['account', 'buyGems', 'credits'], ['extras', 'language', 'settings']])('%s / %s takes you to %s', (chapter, slideId, view) => {
    vi.useFakeTimers();
    const onNavigate = vi.fn();
    render(<HowToGuide onClose={vi.fn()} onNavigate={onNavigate} />);
    openSlide(chapter, slideId);
    expect(screen.getByText('Take me there')).toBeTruthy();
    press('ArrowUp');
    press('Enter');
    flush();
    expect(onNavigate).toHaveBeenCalledWith(view);
  });

  it('shows the Language slide\'s picture and words', () => {
    render(<HowToGuide onClose={vi.fn()} onNavigate={vi.fn()} />);
    openSlide('extras', 'language');
    expect(screen.getByText('Change the language: Settings → UI → Language.')).toBeTruthy();
    expect(screen.getByText(/Channel and programme names come from the provider/)).toBeTruthy();
  });
});
