import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import PlayerMenuList, { MENU_VISIBLE_ROWS } from './PlayerMenuList';

const rows = (n: number, focused: number) => Array.from({ length: n }, (_, i) => (
  <div key={i} data-focused={i === focused ? 'true' : 'false'}>Track {i + 1}</div>
));

describe('player menu list', () => {
  it('a long list (24 subtitle tracks) is five rows tall and scrolls, with where you are', () => {
    const { container } = render(<PlayerMenuList focused={2} total={24}>{rows(24, 2)}</PlayerMenuList>);
    const box = container.querySelector<HTMLElement>('[data-player-menu-list]')!;
    expect(box.style.maxHeight).toBe(`${MENU_VISIBLE_ROWS * 3}rem`);
    expect(box.className).toContain('overflow-y-auto');
    expect(container.querySelector('[data-player-menu-count]')?.textContent).toBe('3 / 24');
  });

  it('a short list keeps its size and shows no count', () => {
    const { container } = render(<PlayerMenuList focused={0} total={3}>{rows(3, 0)}</PlayerMenuList>);
    expect(container.querySelector<HTMLElement>('[data-player-menu-list]')!.style.maxHeight).toBe('');
    expect(container.querySelector('[data-player-menu-count]')).toBeNull();
  });
});
