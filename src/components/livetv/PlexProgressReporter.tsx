// Saves where this viewer is in the Plex title on screen (see plexProgress:
// the viewer's own resume points, which every box keeps). Renders nothing.
// Every fifteen seconds it reads the playhead and saves it on the box; when
// the title changes or the player closes it saves the last position it saw
// as final, which also copies it to the viewer's account.
//
// When the box is signed into Plex with the viewer's OWN Plex account
// (`server`), the same progress is also reported to the server, so the Plex
// apps on their other devices and the server's Continue Watching agree. With
// the shared provider account it is not: that account's progress is everyone's.
import { memo, useEffect, useRef } from 'react';
import { reportPlexTimeline, type PlexPlayInfo } from '@/lib/plex';
import { saveProgress, type PlexProgress } from '@/lib/plexProgress';

interface Props {
  active: boolean;
  ratingKey: string | null;
  /** What is playing, from EpisodeAutoplay; nothing is saved until it is known. */
  info: PlexPlayInfo | null;
  getPosition: () => Promise<{ position: number; duration: number; playing: boolean }>;
  /** Also report to this server (own Plex account only). */
  server?: { base: string; token: string } | null;
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

const PlexProgressReporter = memo(({ active, ratingKey, info, getPosition, server }: Props) => {
  const getPositionRef = useRef(getPosition); useEffect(() => { getPositionRef.current = getPosition; }, [getPosition]);
  const serverRef = useRef(server); serverRef.current = server;
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
        const srv = serverRef.current;
        if (srv) void reportPlexTimeline(srv.base, srv.token, info.ratingKey, p.playing ? 'playing' : 'paused', p.position, p.duration);
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
        const srv = serverRef.current;
        if (srv) void reportPlexTimeline(srv.base, srv.token, last.ratingKey, 'stopped', last.at, last.dur);
        lastRef.current = null;
      }
    };
  }, [ratingKey]);

  return null;
});
PlexProgressReporter.displayName = 'PlexProgressReporter';
export default PlexProgressReporter;
