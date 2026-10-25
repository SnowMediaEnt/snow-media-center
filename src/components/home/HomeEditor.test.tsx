// Hold OK on a Home tile: its menu, Move, Change shortcut, Reset — with the
// remote (and the latch: the held OK never runs on into the menu), and with
// a finger. The content bar's menu and Customize too.
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import HomeEditorLayer, { MovingTileMark } from './HomeEditor';
import { useHomeEditor } from './useHomeEditor';
import { arrangeTiles, loadSavedTiles, saveTiles, useSavedTiles, type TileContext } from '@/lib/homeTiles';
import { loadBarPrefs, useBarPrefs } from '@/lib/homeBar';
import { readMediaBarEnabled, setMediaBarEnabled } from '@/hooks/useMediaBarEnabled';

const CTX: TileContext = { kidsLevel: null, playerEnabled: true, recorder: false };

/** Home's row and the editor, as Index wires them. */
function Harness({ ctx = CTX }: { ctx?: TileContext }) {
  const saved = useSavedTiles();
  const row = arrangeTiles(saved, ctx);
  const bar = useBarPrefs();
  const [focused, setFocused] = useState(0);
  const editor = useHomeEditor({ row, ctx, barSource: bar.source, barShow: bar.show, onFocusTile: setFocused });
  const shown = editor.previewRow ?? row;
  return (
    <div>
      <div data-row={shown.join(',')} data-focus={focused} />
      {shown.map((id, i) => (
        <div key={id} data-home-card={i} data-id={id} style={{ position: 'relative' }}>
          {editor.movingSlot === i && <MovingTileMark editor={editor} touch />}
        </div>
      ))}
      <button type="button" data-open-tile onClick={() => editor.openTileMenu(focused, true)} />
      <button type="button" data-open-bar onClick={() => editor.openBarMenu(true)} />
      <HomeEditorLayer editor={editor} />
    </div>
  );
}

const down = (key: string, init: KeyboardEventInit = {}) => act(() => { fireEvent.keyDown(window, { key, ...init }); });
const up = (key: string) => act(() => { fireEvent.keyUp(window, { key }); });
/** A full press: down and let go. */
const press = (key: string) => { down(key); up(key); };
const row = (c: HTMLElement) => c.querySelector('[data-row]')!.getAttribute('data-row');
const menuFocus = () => document.querySelector('[data-home-edit-menu] [data-focused="true"]')?.getAttribute('data-menu-row');
/** The tile menu, opened by a held OK (still down). */
const holdOpen = () => act(() => { (document.querySelector('[data-open-tile]') as HTMLElement).click(); });

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); setMediaBarEnabled(true); });

describe('Home tile menu (remote)', () => {
  it('takes no OK until the OK that opened it is let go (repeats and all)', () => {
    render(<Harness />);
    holdOpen();
    expect(screen.getByRole('dialog').getAttribute('data-home-edit-menu')).toBe('tile');
    expect(menuFocus()).toBe('move');
    // The held OK keeps repeating — some boxes don't flag it as a repeat.
    down('Enter', { repeat: true });
    down('Enter');
    expect(document.querySelector('[data-tile-moving]')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    up('Enter');
    down('ArrowDown');
    expect(menuFocus()).toBe('change');
    press('Enter');
    expect(document.querySelector('[data-home-edit-picker]')).toBeTruthy();
  });

  it('Move: ◀ ▶ carry the tile, OK puts it down and saves (the held OK does not drop it)', () => {
    const { container } = render(<Harness />);
    holdOpen();
    up('Enter');
    down('Enter'); // Move — this OK is now down
    expect(document.querySelector('[data-tile-moving]')).toBeTruthy();
    down('ArrowRight');
    down('ArrowRight');
    expect(row(container)).toBe('plex,support,livetv,store');
    down('Enter', { repeat: true }); // still the OK that picked Move
    expect(document.querySelector('[data-tile-moving]')).toBeTruthy();
    up('Enter');
    press('Enter');
    expect(document.querySelector('[data-tile-moving]')).toBeNull();
    expect(loadSavedTiles()).toEqual(['plex', 'support', 'livetv', 'store']);
    expect(container.querySelector('[data-focus]')!.getAttribute('data-focus')).toBe('2');
  });

  it('Move: Back puts the tile back where it was, nothing saved', () => {
    const { container } = render(<Harness />);
    holdOpen(); up('Enter');
    press('Enter');
    down('ArrowRight');
    expect(row(container)).toBe('plex,livetv,support,store');
    press('Escape');
    expect(row(container)).toBe('livetv,plex,support,store');
    expect(loadSavedTiles()).toBeNull();
    expect(container.querySelector('[data-focus]')!.getAttribute('data-focus')).toBe('0');
  });

  it('Change shortcut: pick a place; one already on Home swaps; Back is one level', () => {
    const { container } = render(<Harness />);
    holdOpen(); up('Enter');
    down('ArrowDown'); press('Enter'); // Change shortcut
    // Starts on this tile's own place.
    expect(document.querySelector('[data-home-edit-picker] [data-focused="true"]')!.getAttribute('data-pick')).toBe('livetv');
    // Back: the menu again, on Change shortcut.
    press('Escape');
    expect(menuFocus()).toBe('change');
    press('Enter');
    // Livetv(0) → Guide: in a 5-wide grid, Guide is the 5th (index 4) for a grown-up.
    for (let i = 0; i < 4; i += 1) down('ArrowRight');
    expect(document.querySelector('[data-home-edit-picker] [data-focused="true"]')!.getAttribute('data-pick')).toBe('guide');
    press('Enter');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(loadSavedTiles()).toEqual(['guide', 'plex', 'support', 'store']);
    // A place already on Home swaps with this tile.
    holdOpen(); up('Enter');
    down('ArrowDown'); press('Enter');
    act(() => { (document.querySelector('[data-pick="store"]') as HTMLElement).click(); });
    expect(row(container)).toBe('store,plex,support,guide');
  });

  it('Reset to default and Cancel', () => {
    saveTiles(['guide', 'multi', 'support', 'store']);
    const { container } = render(<Harness />);
    expect(row(container)).toBe('guide,multi,support,store');
    holdOpen(); up('Enter');
    down('ArrowDown'); down('ArrowDown');
    expect(menuFocus()).toBe('reset');
    press('Enter');
    expect(loadSavedTiles()).toBeNull();
    expect(row(container)).toBe('livetv,plex,support,store');
    holdOpen(); up('Enter');
    down('ArrowDown'); down('ArrowDown'); down('ArrowDown'); down('ArrowDown'); // held at the end
    expect(menuFocus()).toBe('cancel');
    press('Enter');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('a Kids profile is offered only its own places', () => {
    render(<Harness ctx={{ kidsLevel: 'kids', playerEnabled: true, recorder: true }} />);
    holdOpen(); up('Enter');
    down('ArrowDown'); press('Enter');
    const picks = [...document.querySelectorAll('[data-pick]')].map((e) => e.getAttribute('data-pick'));
    expect(picks).toContain('kids-games');
    expect(picks).not.toContain('store');
    expect(picks).not.toContain('recordings');
  });
});

describe('Home tile menu (touch)', () => {
  it('taps pick, and the lifted tile has tap arrows and Done', () => {
    const { container } = render(<Harness />);
    act(() => { (document.querySelector('[data-open-tile]') as HTMLElement).click(); });
    act(() => { (document.querySelector('[data-menu-row="move"]') as HTMLElement).click(); });
    const mark = document.querySelector('[data-tile-moving]')!;
    act(() => { (mark.querySelector('[aria-label="Move right"]') as HTMLElement).click(); });
    expect(row(container)).toBe('plex,livetv,support,store');
    act(() => { screen.getByText('Done').click(); });
    expect(loadSavedTiles()).toEqual(['plex', 'livetv', 'support', 'store']);
  });
});

describe('content bar menu and Customize', () => {
  it('Customize sets Source and Show; Off hides the bar; Back closes', () => {
    render(<Harness />);
    act(() => { (document.querySelector('[data-open-bar]') as HTMLElement).click(); });
    expect(document.querySelector('[data-home-edit-menu="bar"]')).toBeTruthy();
    up('Enter');
    press('Enter'); // Customize
    const focusedSpot = () => document.querySelector('[data-home-edit-customize] [data-focused="true"]');
    expect(focusedSpot()!.getAttribute('data-bar-source')).toBe('both');
    down('ArrowDown'); press('Enter'); // Live TV only
    expect(loadBarPrefs().source).toBe('live');
    down('ArrowRight'); // Show, on the same row: Continue watching
    down('ArrowDown'); // → Favorites
    expect(focusedSpot()!.getAttribute('data-bar-show')).toBe('favorites');
    press('Enter');
    expect(loadBarPrefs()).toEqual({ source: 'live', show: 'favorites' });
    expect(document.querySelector('[data-bar-show="favorites"]')!.querySelector('svg')).toBeTruthy();
    down('ArrowLeft'); press('Enter'); // back across, same row: Plex only
    expect(loadBarPrefs().source).toBe('plex');
    down('ArrowDown'); press('Enter'); // Off
    expect(focusedSpot()!.getAttribute('data-bar-source')).toBe('off');
    expect(readMediaBarEnabled()).toBe(false);
    press('Escape');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Hide content bar switches it off', () => {
    render(<Harness />);
    act(() => { (document.querySelector('[data-open-bar]') as HTMLElement).click(); });
    up('Enter');
    down('ArrowDown');
    press('Enter');
    expect(readMediaBarEnabled()).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

// Not a vi.fn left over: the hardware Back (Capacitor) is not native here.
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: () => {} }) } }));
