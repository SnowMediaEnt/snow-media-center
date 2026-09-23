// Saves where this viewer is in the Plex title on screen (see plexProgress:
// the viewer's own resume points, not the shared Plex account's). Renders
// nothing. Every fifteen seconds it reads the playhead and saves it on the
// box; when the title changes or the player closes it saves the last
// position it saw as final, which also copies it to the viewer's account.
import { memo, useEffect, useRef } from 'react';
import type { PlexPlayInfo } from '@/lib/plex';
import { saveProgress, type PlexProgress } from '@/lib/plexProgress';

interface Props {
  active: boolean;
  ratingKey: string | null;
  /** What is playing, from EpisodeAutoplay; nothing is saved until it is known. */
  info: PlexPlayInfo | null;
  getPosition: () => Promise<{ position: number; duration: number; playing: boolean }>;
}

const EVERY_MS = 15_000;

type Snapshot = Omit<PlexProgress, 't' | 'done'>;

const snapshot = (info: PlexPlayInfo, at: number, dur: number): Snapshot => ({
  ratingKey: info.ratingKey,
  kind: info.kind,
  title: info.title,
  at,
  dur,
  librarySectionID: info.librarySectionID,
  showKey: info.showKey,
  showTitle: info.showTitle,
  season: info.seasonIndex,
  index: info.index,
});

const PlexProgressReporter = memo(({ active, ratingKey, info, getPosition }: Props) => {
  const getPositionRef = useRef(getPosition); useEffect(() => { getPositionRef.current = getPosition; }, [getPosition]);
  // The last playhead seen for the title on screen, for the final save.
  const lastRef = useRef<Snapshot | null>(null);
  const known = !!info && !!ratingKey && info.ratingKey === ratingKey;

  useEffect(() => {
    if (!active || !known || !info) return;
    let alive = true;
    const beat = async () => {
      try {
        const p = await getPositionRef.current();
        if (!alive || !(p.duration > 0) || !(p.position > 0)) return;
        lastRef.current = snapshot(info, p.position, p.duration);
        saveProgress(lastRef.current);
      } catch { /* next beat */ }
    };
    const id = window.setInterval(() => { void beat(); }, EVERY_MS);
    void beat();
    return () => { alive = false; window.clearInterval(id); };
  }, [active, known, info]);

  // Final save when the title changes or the player goes away.
  useEffect(() => {
    if (!ratingKey) return;
    return () => {
      const last = lastRef.current;
      if (last && last.ratingKey === ratingKey) {
        saveProgress(last, true);
        lastRef.current = null;
      }
    };
  }, [ratingKey]);

  return null;
});
PlexProgressReporter.displayName = 'PlexProgressReporter';
export default PlexProgressReporter;
