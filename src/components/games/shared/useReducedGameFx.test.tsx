import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useReducedGameFx } from './useReducedGameFx';
afterEach(() => { document.documentElement.classList.remove('native-low-memory'); localStorage.clear(); });
it('defaults a low-memory device to Low but allows Full and remembers the choice', () => {
  localStorage.clear();
  document.documentElement.classList.add('native-low-memory');
  const hook = renderHook(useReducedGameFx);
  expect(hook.result.current.reducedFx).toBe(true);
  act(() => hook.result.current.toggleReducedFx());
  expect(hook.result.current.reducedFx).toBe(false);
  expect(document.documentElement.getAttribute('data-game-fx')).toBe('full');
  hook.unmount();
  const restored = renderHook(useReducedGameFx);
  expect(restored.result.current.reducedFx).toBe(false);
  act(() => restored.result.current.toggleReducedFx());
  expect(restored.result.current.reducedFx).toBe(true);
});
