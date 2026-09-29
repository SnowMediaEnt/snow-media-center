// The remote's media buttons (Play/Pause, Fast-forward, Rewind, Next,
// Previous, and CH+ / CH- where the remote has them). Android's WebView does
// not pass these keys to the page, so
// MainActivity catches them and raises MEDIA_KEY_EVENT with one of the names
// below. Browsers and WebViews that do deliver them as keydown are covered
// too, so a player only has to call onMediaKey().

export type MediaKey = 'playpause' | 'play' | 'pause' | 'ff' | 'rw' | 'next' | 'prev' | 'chup' | 'chdown';

export const MEDIA_KEY_EVENT = 'smc:mediakey';

const KEY_NAMES: Record<string, MediaKey> = {
  MediaPlayPause: 'playpause',
  MediaPlay: 'play',
  MediaPause: 'pause',
  MediaFastForward: 'ff',
  MediaRewind: 'rw',
  MediaTrackNext: 'next',
  MediaTrackPrevious: 'prev',
  ChannelUp: 'chup',
  ChannelDown: 'chdown',
};

const isMediaKey = (v: unknown): v is MediaKey =>
  v === 'playpause' || v === 'play' || v === 'pause' || v === 'ff' || v === 'rw' || v === 'next' || v === 'prev'
  || v === 'chup' || v === 'chdown';

/** Listen for the remote's media buttons. Returns the unsubscribe. */
export function onMediaKey(fn: (key: MediaKey) => void): () => void {
  const onCustom = (e: Event) => {
    const k = (e as CustomEvent).detail;
    if (isMediaKey(k)) fn(k);
  };
  const onKey = (e: KeyboardEvent) => {
    const k = KEY_NAMES[e.key];
    if (!k) return;
    e.preventDefault();
    fn(k);
  };
  window.addEventListener(MEDIA_KEY_EVENT, onCustom);
  window.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener(MEDIA_KEY_EVENT, onCustom);
    window.removeEventListener('keydown', onKey);
  };
}
