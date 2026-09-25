import { useEffect, useRef } from 'react';
import { Music2, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import { App as CapApp } from '@capacitor/app';
import { isBackKey } from './gameBack';
import { visualArrowDir } from './gameInput';
import { useGameMusic } from './gameMusic';
import './gameMusicSettings.css';

type Props = { onClose: () => void };

export function GameMusicSettings({ onClose }: Props) {
  const { enabled, volume, setEnabled, setVolume, nextTrack } = useGameMusic();
  const controls = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    controls.current[0]?.focus();
    let disposed = false;
    let listener: { remove: () => Promise<void> } | null = null;
    // Defer closing until other native Back listeners have seen aria-modal and
    // yielded; otherwise the same press could also leave the lounge.
    void CapApp.addListener('backButton', () => { window.setTimeout(onClose, 0); }).then(handle => {
      if (disposed) void handle.remove();
      else listener = handle;
    }).catch(() => undefined);
    return () => { disposed = true; if (listener) void listener.remove(); };
  }, [onClose]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (isBackKey(event.nativeEvent)) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    const direction = visualArrowDir(event.nativeEvent);
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const index = controls.current.indexOf(document.activeElement as HTMLElement);
    if (index === 1 && (direction === 'left' || direction === 'right')) {
      setVolume(volume + (direction === 'right' ? 5 : -5));
      return;
    }
    if (direction === 'down') controls.current[Math.min(3, index + 1)]?.focus();
    if (direction === 'up') controls.current[Math.max(0, index - 1)]?.focus();
    if (direction === 'right' && index === 0) controls.current[1]?.focus();
    if (direction === 'left' && index === 2) controls.current[1]?.focus();
    if (direction === 'right' && index === 2) controls.current[3]?.focus();
    if (direction === 'left' && index === 3) controls.current[2]?.focus();
  };

  return <div className="game-music-overlay" role="presentation">
    <section className="game-music-panel" role="dialog" aria-modal="true" aria-label="Game music settings" onKeyDownCapture={onKeyDown}>
      <header><Music2 aria-hidden="true" /><h2>Game Music</h2><button type="button" aria-label="Close music settings" onClick={onClose}><X /></button></header>
      <p>Music streams only while you are in the Game Lounge or a game. Sound effects have their own switch.</p>
      <button ref={element => { controls.current[0] = element; }} type="button" className="game-music-panel__toggle" aria-pressed={enabled} onClick={() => setEnabled(!enabled)}>
        {enabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
        Music {enabled ? 'On' : 'Off'}
      </button>
      <label className="game-music-panel__volume" htmlFor="game-music-volume"><span>Music volume</span><strong>{volume}%</strong></label>
      <input ref={element => { controls.current[1] = element; }} id="game-music-volume" type="range" min="0" max="100" step="5" value={volume} onChange={event => setVolume(Number(event.target.value))} aria-label="Music volume" aria-valuetext={`${volume} percent`} />
      <small>Use Left and Right on your remote to adjust.</small>
      <div className="game-music-panel__actions">
        <button ref={element => { controls.current[2] = element; }} type="button" onClick={nextTrack}><SkipForward aria-hidden="true" /> Next song</button>
        <button ref={element => { controls.current[3] = element; }} type="button" onClick={onClose}>Done</button>
      </div>
    </section>
  </div>;
}
