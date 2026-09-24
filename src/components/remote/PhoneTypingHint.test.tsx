import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { channel: vi.fn(), removeChannel: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/analytics', () => ({ getDeviceId: () => 'device-12345678', trackEvent: vi.fn() }));
vi.mock('@/components/remote/PairingQR', () => ({ default: () => <div>pairing QR</div> }));

import PhoneTypingHint from './PhoneTypingHint';

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
});
