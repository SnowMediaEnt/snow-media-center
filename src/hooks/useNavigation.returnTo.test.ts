import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useNavigation } from './useNavigation';

describe('navigateTo a screen already on the way back', () => {
  it('returns to it instead of stacking it again', () => {
    const { result } = renderHook(() => useNavigation('home'));
    act(() => result.current.navigateTo('livetv'));
    act(() => result.current.navigateTo('support'));
    // Support's "Back to Player" for the Buffering Guide.
    act(() => result.current.navigateTo('livetv'));
    expect(result.current.currentView).toBe('livetv');
    // Back from the Player is Home, not Support and a second Player.
    act(() => result.current.goBack());
    expect(result.current.currentView).toBe('home');
  });

  it('Home from anywhere is just Home', () => {
    const { result } = renderHook(() => useNavigation('home'));
    act(() => result.current.navigateTo('user'));
    act(() => result.current.navigateTo('settings'));
    act(() => result.current.navigateTo('home'));
    expect(result.current.currentView).toBe('home');
    expect(result.current.canGoBack).toBe(false);
  });

  it('a new screen still stacks', () => {
    const { result } = renderHook(() => useNavigation('home'));
    act(() => result.current.navigateTo('store'));
    act(() => result.current.navigateTo('support'));
    act(() => result.current.goBack());
    expect(result.current.currentView).toBe('store');
  });
});
