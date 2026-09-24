import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { channel: vi.fn(), removeChannel: vi.fn(), functions: { invoke: vi.fn() } } }));
vi.mock('@/lib/analytics', () => ({ getDeviceId: () => 'device-12345678', trackEvent: vi.fn() }));

// A stand-in for the real host: the same ways in, counted.
const hostMounts = vi.fn();
vi.mock('@/components/voice/VoiceCommandHost', async () => {
  const { OPEN_VOICE_EVENT } = await import('@/lib/voiceUi');
  const { REMOTE_VOICE_EVENT } = await import('@/lib/phoneRemote');
  const Host = () => {
    const [opens, setOpens] = useState(0);
    const [heard, setHeard] = useState('');
    useEffect(() => {
      hostMounts();
      const onOpen = () => setOpens((n) => n + 1);
      const onPhone = (e: Event) => setHeard(String((e as CustomEvent<string>).detail));
      window.addEventListener(OPEN_VOICE_EVENT, onOpen);
      window.addEventListener(REMOTE_VOICE_EVENT, onPhone);
      return () => { window.removeEventListener(OPEN_VOICE_EVENT, onOpen); window.removeEventListener(REMOTE_VOICE_EVENT, onPhone); };
    }, []);
    return <div>{`opens:${opens} heard:${heard}`}</div>;
  };
  return { default: Host };
});

import LazyVoiceCommandHost from './LazyVoiceCommandHost';
import { openVoice } from '@/lib/voiceUi';
import { MEDIA_KEY_EVENT } from '@/lib/mediaKeys';
import { REMOTE_VOICE_EVENT } from '@/lib/phoneRemote';

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });

afterEach(() => { hostMounts.mockClear(); });

describe('LazyVoiceCommandHost', () => {
  it('does not load the voice host with Home', async () => {
    render(<LazyVoiceCommandHost navigate={vi.fn()} />);
    await flush();
    expect(hostMounts).not.toHaveBeenCalled();
  });

  it('the mic button opens voice on the first press, and later presses reach the host once each', async () => {
    render(<LazyVoiceCommandHost navigate={vi.fn()} />);
    act(() => openVoice());
    await flush();
    expect(hostMounts).toHaveBeenCalledTimes(1);
    expect(screen.getByText('opens:1 heard:')).toBeTruthy();
    act(() => openVoice());
    await flush();
    expect(screen.getByText('opens:2 heard:')).toBeTruthy();
  });

  it("the remote's Search key opens voice (as a key or as the 'search' media key), typing a 't' does not", async () => {
    render(<LazyVoiceCommandHost navigate={vi.fn()} />);
    const t = fireEvent.keyDown(window, { key: 't', keyCode: 84 });
    expect(t).toBe(true);
    // The remote's OK is Enter (keyCode 13): nothing to do with voice.
    fireEvent.keyDown(window, { key: 'Enter', keyCode: 13 });
    await flush();
    expect(hostMounts).not.toHaveBeenCalled();

    const search = fireEvent.keyDown(window, { key: 'BrowserSearch', keyCode: 170 });
    expect(search).toBe(false); // swallowed, like the host does
    await flush();
    expect(screen.getByText('opens:1 heard:')).toBeTruthy();
  });

  it("opens from the Search media key", async () => {
    render(<LazyVoiceCommandHost navigate={vi.fn()} />);
    act(() => { window.dispatchEvent(new CustomEvent(MEDIA_KEY_EVENT, { detail: 'search' })); });
    await flush();
    expect(screen.getByText('opens:1 heard:')).toBeTruthy();
  });

  it("hands the phone remote's first voice command to the host", async () => {
    render(<LazyVoiceCommandHost navigate={vi.fn()} />);
    act(() => { window.dispatchEvent(new CustomEvent(REMOTE_VOICE_EVENT, { detail: 'put on ESPN' })); });
    await flush();
    expect(screen.getByText('opens:0 heard:put on ESPN')).toBeTruthy();
  });

  it("stays unloaded while \"Who's watching?\" blocks voice", async () => {
    render(<LazyVoiceCommandHost navigate={vi.fn()} blocked />);
    act(() => openVoice());
    await flush();
    expect(hostMounts).not.toHaveBeenCalled();
  });
});
