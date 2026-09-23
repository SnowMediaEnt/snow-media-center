import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let said = 'open settings';
vi.mock('@/components/VoiceInput', () => ({
  default: ({ onTranscription }: { onTranscription: (t: string, c: unknown) => void }) => {
    return <button type="button" onClick={() => onTranscription(said, { setVoiceState() {}, restoreFocus() {}, cleanupAudio() {} })}>Voice</button>;
  },
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    functions: { invoke: async () => ({ data: { response: 'Try DreamStreams → NBA Zone.' }, error: null }) },
    rpc: async () => ({}),
  },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove() {} }) } }));

const speak = async (text: string) => {
  said = text;
  await act(async () => { (await import('@/lib/voiceUi')).openVoice(); });
  await act(async () => { screen.getByText('Voice').click(); await Promise.resolve(); });
};

afterEach(async () => { (await import('@/lib/kidsFilter')).setKidsLevel(null); sessionStorage.clear(); });

describe('VoiceCommandHost', () => {
  it('opens a screen said out loud', async () => {
    const { default: Host } = await import('./VoiceCommandHost');
    const navigate = vi.fn();
    render(<Host navigate={navigate} />);
    await speak('open settings');
    expect(navigate).toHaveBeenCalledWith('settings');
    expect(screen.getByText('Opening Settings…')).toBeTruthy();
  });

  it('plays a channel through the Player', async () => {
    const { default: Host } = await import('./VoiceCommandHost');
    const navigate = vi.fn();
    render(<Host navigate={navigate} />);
    await speak('put on ESPN');
    expect(navigate).toHaveBeenCalledWith('livetv');
    expect(JSON.parse(sessionStorage.getItem('smc-player-intent') || '{}')).toEqual({ section: 'live', play: 'espn' });
  });

  it('keeps a Kids profile out of grown-up screens', async () => {
    (await import('@/lib/kidsFilter')).setKidsLevel('kids');
    const { default: Host } = await import('./VoiceCommandHost');
    const navigate = vi.fn();
    render(<Host navigate={navigate} />);
    await speak('open the game lounge');
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText(/needs a grown-up/)).toBeTruthy();
  });

  it('asks the assistant anything else and shows the answer', async () => {
    const { default: Host } = await import('./VoiceCommandHost');
    render(<Host navigate={vi.fn()} />);
    await speak('where is the Lakers game');
    expect(await screen.findByText('Try DreamStreams → NBA Zone.')).toBeTruthy();
  });
});
