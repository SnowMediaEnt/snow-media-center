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
import { noteProgressDiag, saveProgress, type PlexProgress } from '@/lib/plexProgress';

interface Props {
  active: boolean;
  ratingKey: string | null;
  /** What is playing: at first what PlexSection already knew when Play was
   *  pressed, then EpisodeAutoplay's fuller answer from the server. Nothing
   *  is saved until it is known. */
  info: PlexPlayInfo | null;
  getPosition: () => Promise<{ position: number; duration: number; playing: boolean }>;
  /** Also report to this server (own Plex account only). */
  server?: { base: string; token: string } | null;
}

const EVERY_MS = 15_000;
/** A title that follows another in the same player (Up Next) is first read
 *  this long after it starts: the stream changes under a player that stays
 *  up, and a reading straight away was still the last episode's playhead
 *  (its credits), which saved the next one as watched. Nothing is lost: the
 *  first minute is never a place to resume from. */
const NEXT_FIRST_MS = 5_000;

type Snapshot = Omit<PlexProgress, 't' | 'done'>;

// Only the fields that are known. What was known at Play can be less than
// the server says (no show key for an episode opened from a rail), and a
// save merges into the title's saved entry: an undefined field would wipe
// the library or the show saved there before, and the title would drop out
// of its library's Continue Watching.
const snapshot = (info: PlexPlayInfo, at: number, dur: number): Snapshot => {
  const s: Snapshot = { ratingKey: info.ratingKey, kind: info.kind, title: info.title, at, dur };
  if (info.librarySectionID != null) s.librarySectionID = info.librarySectionID;
  if (info.showKey != null) s.showKey = info.showKey;
  if (info.showTitle != null) s.showTitle = info.showTitle;
  if (info.seasonIndex != null) s.season = info.seasonIndex;
  if (info.index != null) s.index = info.index;
  return s;
};

const PlexProgressReporter = memo(({ active, ratingKey, info, getPosition, server }: Props) => {
  const getPositionRef = useRef(getPosition); useEffect(() => { getPositionRef.current = getPosition; }, [getPosition]);
  const serverRef = useRef(server); serverRef.current = server;
  // The last playhead seen for the title on screen, for the final save.
  const lastRef = useRef<Snapshot | null>(null);
  const known = !!info && !!ratingKey && info.ratingKey === ratingKey;
  // As of the last commit, for the close below: its cleanup runs after the
  // render that already cleared them, so it must not read this render's.
  const stateRef = useRef({ known, active });
  useEffect(() => { stateRef.current = { known, active }; }, [known, active]);
  // The title the player was last read for while up, and when the title on
  // screen now was first known.
  const readForRef = useRef<string | null>(null);
  const knownSinceRef = useRef<{ key: string; at: number } | null>(null);

  // Each beat also leaves a line for the Continue Watching check in Plex
  // Settings (one small write per fifteen seconds): what the player said and,
  // when nothing was saved, why. It beats while the title is known even if
  // the player is not up yet, so "not playing" shows there too.
  useEffect(() => {
    if (!known || !info) return;
    let alive = true;
    const beat = async () => {
      if (!active) {
        noteProgressDiag({ beatAt: Date.now(), beatPos: undefined, beatDur: undefined, beatSkip: 'inactive' });
        return;
      }
      try {
        const p = await getPositionRef.current();
        // The server's running time first. The player does not always know it:
        // a stream still opening says 0, and a converted (transcoded) stream
        // may only know the part converted so far, just ahead of the
        // playhead, which made every such title count as watched to the end
        // and left Continue Watching.
        const dur = info.duration && info.duration > 0 ? info.duration : p.duration;
        if (!alive) return;
        const skip = !(dur > 0) ? 'no-duration' : !(p.position > 0) ? 'no-position' : undefined;
        noteProgressDiag({ beatAt: Date.now(), beatPos: p.position, beatDur: dur, beatSkip: skip });
        if (skip) return;
        lastRef.current = snapshot(info, p.position, dur);
        saveProgress(lastRef.current);
        const srv = serverRef.current;
        if (srv) void reportPlexTimeline(srv.base, srv.token, info.ratingKey, p.playing ? 'playing' : 'paused', p.position, dur);
      } catch {
        // The player could not say where it is; next beat.
        if (alive) noteProgressDiag({ beatAt: Date.now(), beatPos: undefined, beatDur: undefined, beatSkip: 'no-position' });
      }
    };
    const key = info.ratingKey;
    const read = () => { if (active) readForRef.current = key; void beat(); };
    if (knownSinceRef.current?.key !== key) knownSinceRef.current = { key, at: Date.now() };
    const followsAnother = readForRef.current != null && readForRef.current !== key;
    const wait = followsAnother ? Math.max(0, NEXT_FIRST_MS - (Date.now() - knownSinceRef.current.at)) : 0;
    const id = window.setInterval(read, EVERY_MS);
    const first = wait > 0 ? window.setTimeout(read, wait) : null;
    if (!wait) read();
    return () => { alive = false; window.clearInterval(id); if (first != null) window.clearTimeout(first); };
  }, [active, known, info]);

  // Final save when the title changes or the player goes away.
  useEffect(() => {
    if (!ratingKey) return;
    return () => {
      // For the check in Plex Settings: whether it knew the title and the
      // player was up at the end. A title never known was never saved.
      const { known: closedKnown, active: closedActive } = stateRef.current;
      noteProgressDiag({ closedAt: Date.now(), closedKnown, closedActive });
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
