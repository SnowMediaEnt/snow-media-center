import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  session: null as null | { user: { email: string } },
  setSession: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: auth.session } }),
      setSession: auth.setSession,
      verifyOtp: auth.verifyOtp,
    },
  },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));

import SsoConsume from './SsoConsume';
import { readSignInLink } from '@/lib/ssoLink';

const open = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/sso" element={<SsoConsume />} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );

/** Past the moment in which an OK is taken as the press that opened the link. */
const later = () => { const t = Date.now() + 1000; vi.spyOn(Date, 'now').mockReturnValue(t); };

beforeEach(() => {
  auth.session = null;
  auth.setSession.mockReset().mockResolvedValue({ data: { user: { email: 'them@example.com' }, session: {} }, error: null });
  auth.verifyOtp.mockReset().mockResolvedValue({ data: { user: { email: 'new@example.com' }, session: {} }, error: null });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ email: 'them@example.com' }), { status: 200 })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('readSignInLink', () => {
  it('reads both shapes Supabase sends, and nothing else', () => {
    expect(readSignInLink('', '#access_token=a&refresh_token=r&type=magiclink')).toEqual({ kind: 'session', accessToken: 'a', refreshToken: 'r' });
    expect(readSignInLink('?token_hash=h&type=signup', '')).toEqual({ kind: 'otp', tokenHash: 'h', type: 'signup' });
    expect(readSignInLink('?token=h&type=bogus', '')).toEqual({ kind: 'otp', tokenHash: 'h', type: 'magiclink' });
    expect(readSignInLink('', '#access_token=a')).toBeNull();
    expect(readSignInLink('?x=1', '')).toBeNull();
  });
});

describe('SsoConsume', () => {
  it('asks before a link signs the box in, naming the account the server says it is for', async () => {
    auth.session = { user: { email: 'me@example.com' } };
    open('/sso#access_token=acc&refresh_token=ref');
    expect(await screen.findByText('them@example.com')).toBeTruthy();
    expect(screen.getByText('me@example.com')).toBeTruthy();
    expect(auth.setSession).not.toHaveBeenCalled();
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://project.supabase.co/auth/v1/user');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer acc');

    later();
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'acc', refresh_token: 'ref' }));
    expect(await screen.findByText(/Signed in as them@example.com/)).toBeTruthy();
  });

  it('Back leaves the box as it was', async () => {
    auth.session = { user: { email: 'me@example.com' } };
    open('/sso#access_token=acc&refresh_token=ref');
    await screen.findByText('them@example.com');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByText('HOME')).toBeTruthy();
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it('Cancel is one press to the right', async () => {
    open('/sso#access_token=acc&refresh_token=ref');
    await screen.findByText('them@example.com');
    later();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(await screen.findByText('HOME')).toBeTruthy();
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it('ignores the OK that opened the link and a held OK', async () => {
    open('/sso#access_token=acc&refresh_token=ref');
    await screen.findByText('them@example.com');
    fireEvent.keyDown(window, { key: 'Enter' });
    later();
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    await act(async () => { await Promise.resolve(); });
    expect(auth.setSession).not.toHaveBeenCalled();
  });

  it('a token_hash link is verified only after OK', async () => {
    open('/sso?token_hash=h1&type=magiclink');
    expect(await screen.findByText('Sign in with this link?')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    later();
    fireEvent.click(screen.getByText('Sign in'));
    await waitFor(() => expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'h1', type: 'magiclink' }));
  });

  it('offers a link whose token the server no longer knows without a name', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    open('/sso#access_token=old&refresh_token=ref');
    expect(await screen.findByText('Sign in with this link?')).toBeTruthy();
  });
});
