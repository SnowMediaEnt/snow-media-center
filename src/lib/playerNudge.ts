// "It's better in the Player": shown when someone opens the old Dreamstreams,
// VibezTV or Plex app from Main Apps or a pinned tile. One "Don't show this
// again" covers all three, on this box.
const KEY = 'smc-player-nudge-off';

export const playerNudgeOff = (): boolean => {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
};

export const setPlayerNudgeOff = (off: boolean): void => {
  try {
    if (off) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch { /* private mode: it just shows again next time */ }
};

/** The benefits, short enough to read from the couch. */
export const PLAYER_BENEFITS: string[] = [
  'Live TV, the Guide, VOD and Multi-Screen, all in one place',
  'Plex built in and faster, with Continue Watching and search',
  'Favorites, Backups when a channel is down, and remote Play/Pause',
  'Always up to date with Snow Media Center, nothing else to install',
];
