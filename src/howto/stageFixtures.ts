// Made-up data for the How-to guide's picture stage (HowToStage.tsx) and the
// recorder's web fallback during a capture run. Developer build only: nothing
// imports this outside `import.meta.env.DEV` branches, so it never ships.
//
// Everything here is invented: channel and programme names come from the demo
// line-up (data/liveTvDemo), titles from its made-up catalogue, artwork is
// drawn in code. Times are relative to now (the capture script fixes the clock).
import type { RecordSchedule, RecordVolume, RecordingItem } from '@/capacitor/SnowRecorder';
import type { VideoController, VideoTrackInfo } from '@/components/livetv/VideoPlayer';
import { DEMO_CHANNELS, demoGetShortEpg, demoLogo, demoPoster } from '@/data/liveTvDemo';
import { decodeEpgText, pickNowNext, type EpgNowNext, type XtreamLiveStream } from '@/lib/xtream';
import type { ProgrammeChoice } from '@/lib/recordSchedule';

const MIN = 60_000;
const HOUR = 60 * MIN;
const GB = 1024 * 1024 * 1024;

// ── the channel on screen (player bar, record dialogs, hold-OK menu) ───────

/** "Summit Sports", the Sports category's first channel. */
export const stageChannel = (): XtreamLiveStream =>
  DEMO_CHANNELS.find((c) => c.name === 'Summit Sports') ?? DEMO_CHANNELS[0];

export const STAGE_CATEGORY = 'Sports';

export const stageNowNext = (): EpgNowNext => pickNowNext(demoGetShortEpg(stageChannel().stream_id, 6));

/** The channel's next programmes, for the Guide's record dialog. */
export const stageProgrammes = (): ProgrammeChoice[] => {
  const now = Date.now();
  return demoGetShortEpg(stageChannel().stream_id, 10)
    .map((e) => ({ title: decodeEpgText(e.title), startMs: Number(e.start_timestamp) * 1000, endMs: Number(e.stop_timestamp) * 1000 }))
    .filter((p) => p.endMs > now)
    .slice(0, 6);
};

export const stageChannelLogo = (): string => demoLogo(stageChannel().name);

// ── a pretend player (tracks for the Subtitles and Audio buttons) ──────────

export const makeStageController = (subs: VideoTrackInfo[], auds: VideoTrackInfo[]): VideoController => ({
  play() {},
  pause() {},
  togglePlay() {},
  seek() {},
  isPaused: () => false,
  isSeekable: () => false,
  getSubtitleTracks: () => subs,
  setSubtitleTrack() {},
  getAudioTracks: () => auds,
  setAudioTrack() {},
});

export const STAGE_SUBS: VideoTrackInfo[] = [
  { id: 0, label: 'English', language: 'en', active: false },
  { id: 1, label: 'Español', language: 'es', active: false },
];
export const STAGE_AUDIO: VideoTrackInfo[] = [
  { id: 0, label: 'English · Stereo', language: 'en', active: true },
  { id: 1, label: 'Español · Stereo', language: 'es', active: false },
];

// ── Plex (made-up catalogue title, drawn poster) ───────────────────────────

export const STAGE_PLEX = {
  show: 'Harbor Lights',
  episode: 'S1 · E2  The Letter',
  next: 'S1 · E3  Crossroads',
  poster: () => demoPoster('Harbor Lights'),
  durationSec: 44 * 60,
  positionSec: 70,
} as const;

/** The code the Plex link screen shows (made up). */
export const STAGE_PLEX_CODE = 'K7Q4';

// ── recordings (the recorder's web fallback, capture only) ─────────────────

export const stageVolumes = (): RecordVolume[] => [
  { id: 'box', label: 'This box', removable: false, freeBytes: 9.4 * GB, totalBytes: 16 * GB },
  { id: 'usb-demo', label: 'USB drive', removable: true, freeBytes: 48.2 * GB, totalBytes: 64 * GB },
];

const recording = (i: number, channel: string, title: string, agoH: number, durMin: number, volumeId: string, gb: number): RecordingItem => ({
  id: `demo-rec-${i}`,
  name: title,
  channel,
  path: `demo://recordings/${i}.ts`,
  playUrl: `demo://recordings/${i}.ts`,
  bytes: Math.round(gb * GB),
  startedAt: Date.now() - agoH * HOUR,
  durationSec: durMin * 60,
  recording: false,
  volumeId,
  volumeLabel: volumeId === 'box' ? 'This box' : 'USB drive',
});

/** Three finished recordings. */
export const stageRecordings = (): RecordingItem[] => [
  recording(1, 'Summit Sports', 'Matchday Live', 20, 120, 'usb-demo', 3.1),
  recording(2, 'Planet Wild', 'Wild Kingdoms', 30, 60, 'box', 1.4),
  recording(3, 'Aurora Cinema', 'Sunday Premiere', 52, 110, 'usb-demo', 2.8),
];

/** One set for tonight, one that was missed. */
export const stageSchedules = (): RecordSchedule[] => {
  const now = Date.now();
  const tonight = Math.ceil((now + HOUR) / (30 * MIN)) * 30 * MIN;
  return [
    {
      id: 'demo-sched-1', streamId: stageChannel().stream_id, channelName: 'Summit Sports', programmeTitle: 'Full-Time Analysis',
      startUtcMs: tonight, endUtcMs: tonight + HOUR, padBeforeMin: 2, padAfterMin: 5, volumeId: 'usb-demo',
      status: 'scheduled', finishedAtMs: 0,
    },
    {
      id: 'demo-sched-2', streamId: stageChannel().stream_id, channelName: 'Deep Field Docs', programmeTitle: 'The Universe',
      startUtcMs: now - 26 * HOUR, endUtcMs: now - 25 * HOUR, padBeforeMin: 2, padAfterMin: 5, volumeId: 'box',
      status: 'missed', finishedAtMs: now - 25 * HOUR,
    },
  ];
};
