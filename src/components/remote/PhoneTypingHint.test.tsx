import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { channel: vi.fn(), removeChannel: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/analytics', () => ({ getDeviceId: () => 'device-12345678', trackEvent: vi.fn() }));
vi.mock('@/components/remote/PairingQR', () => ({ default: () => <div>pairing QR</div> }));

import PhoneTypingHint from './PhoneTypingHint';
import { typingHintEnabled } from '@/lib/phoneRemote';

const focusBox = async () => {
  const input = document.createElement('input');
  document.body.appendChild(input);
  await act(async () => { input.focus(); await new Promise((r) => setTimeout(r, 200)); });
  return async () => {
    await act(async () => { input.blur(); await new Promise((r) => setTimeout(r, 200)); });
    input.remove();
  };
};

beforeEach(() => { localStorage.clear(); });

describe('PhoneTypingHint', () => {
  it('shows the pairing QR (loaded on demand) while a text box has focus', async () => {
    render(<PhoneTypingHint />);
    expect(screen.queryByText('Type on your phone')).toBeNull();
    const input = document.createElement('input');
    document.body.appendChild(input);
    await act(async () => { input.focus(); await new Promise((r) => setTimeout(r, 200)); });
    expect(screen.getByText('Type on your phone')).toBeTruthy();
    expect(await screen.findByText('pairing QR')).toBeTruthy();
    await act(async () => { input.blur(); await new Promise((r) => setTimeout(r, 200)); });
    expect(screen.queryByText('Type on your phone')).toBeNull();
    input.remove();
  });

  it('shows three times, then stays off until Settings turns it back on', async () => {
    render(<PhoneTypingHint />);
    for (const note of [/Shows 2 more times/, /Shows 1 more time\./, /This was the last time/]) {
      const leave = await focusBox();
      expect(screen.getByText('Type on your phone')).toBeTruthy();
      expect(screen.getByText(note)).toBeTruthy();
      await leave();
    }
    expect(typingHintEnabled()).toBe(false);
    const leave = await focusBox();
    expect(screen.queryByText('Type on your phone')).toBeNull();
    await leave();
  });

  it('"Don\'t show again" turns it off at once and keeps the text box focused', async () => {
    render(<PhoneTypingHint />);
    const leave = await focusBox();
    const box = document.activeElement;
    const button = screen.getByRole('button', { name: "Don't show again" });
    fireEvent.mouseDown(button);
    fireEvent.click(button);
    expect(screen.queryByText('Type on your phone')).toBeNull();
    expect(typingHintEnabled()).toBe(false);
    expect(document.activeElement).toBe(box);
    await leave();
  });
});
