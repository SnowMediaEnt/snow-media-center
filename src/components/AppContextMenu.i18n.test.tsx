import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import i18n from '@/i18n';
import AppContextMenu from './AppContextMenu';

const app = { id: 'a', name: 'Kodi', icon: '', packageName: 'org.xbmc.kodi' } as never;
const show = (isPinned: boolean, canPinMore = true) =>
  render(<AppContextMenu app={app} isPinned={isPinned} canPinMore={canPinMore} position={{ x: 10, y: 10 }} onPin={vi.fn()} onUnpin={vi.fn()} onClose={vi.fn()} />);

describe('AppContextMenu language', () => {
  it('is English by default', () => {
    show(false);
    expect(screen.getByText('Pin App')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
  });

  it('follows the chosen language, and leaves the app name alone', async () => {
    await i18n.changeLanguage('es');
    show(true);
    expect(screen.getByText('Quitar fijado')).toBeTruthy();
    expect(screen.getByText('Cancelar')).toBeTruthy();
    expect(screen.getByText('Kodi')).toBeTruthy();
  });

  it('says why a pin is not possible', async () => {
    await i18n.changeLanguage('de');
    show(false, false);
    expect(screen.getByText('Max. 4 angeheftet')).toBeTruthy();
  });
});
