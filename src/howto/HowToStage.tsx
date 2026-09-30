// The How-to guide's picture stage (plan-howto.md, section 3). Developer build
// only: App.tsx adds the /howto-stage route under `import.meta.env.DEV`, so
// the production build (the APK and the website) has neither the route nor
// this file.
//
// Some screens can't be reached in a browser (the native player's bar, the
// recorder, Multi-Screen, Plex playback). The capture script (scripts/howto)
// opens /howto-stage?shot=<id>&bg=<picture> and this page draws the REAL
// component with made-up props (stageFixtures), over an earlier capture of
// the screen behind it (`bg`) or over a drawn still. A later redesign of the
// component shows up at the next capture.
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShotId } from '@/data/howtoContract';
import { isHowtoCapture } from '@/lib/demoMode';
import { DEMO_LIVE_CREDS } from '@/data/liveTvDemo';
import CredentialsForm from '@/components/livetv/CredentialsForm';
import ReportChannelDialog from '@/components/livetv/ReportChannelDialog';
import PlayerControlBar from '@/components/livetv/PlayerControlBar';
import RecordDialog from '@/components/livetv/RecordDialog';
import RecordingsScreen from '@/components/livetv/RecordingsScreen';
import MultiScreenSection from '@/components/livetv/MultiScreenSection';
import PlexAuthScreen from '@/components/livetv/PlexAuthScreen';
import PlexPlayerOverlay, { type PlayerPrompt } from '@/components/livetv/PlexPlayerOverlay';
import { liveBarOrder } from '@/components/livetv/liveBar';
import {
  STAGE_AUDIO, STAGE_CATEGORY, STAGE_PLEX, STAGE_PLEX_CODE, STAGE_SUBS, makeStageController, stageChannel,
  stageChannelLogo, stageNowNext, stageProgrammes,
} from './stageFixtures';

/** The shots this page draws (table 1c: "stage"). */
const STAGE_SHOTS = [
  'live-signin', 'live-holdmenu', 'live-report', 'live-player', 'live-record', 'guide-record', 'recordings', 'multi',
  'plex-connect', 'plex-link', 'plex-player', 'plex-upnext', 'plex-subs', 'plex-audio',
] as const satisfies readonly ShotId[];
type StageShot = (typeof STAGE_SHOTS)[number];

const noop = () => {};
const noopAsync = async () => {};

// Where Live TV's content sits under its header and folded side menu, on the
// 960×540 screen the pictures are taken at (LiveTV.tsx: a 56 px header plus
// its rule, a 48 px menu plus its rule). The Recordings screen and
// Multi-Screen take that place over the picture of Live TV behind them.
const LIVE_CONTENT = { top: 57, left: 49 } as const;

/** An earlier capture of the screen behind, from the capture script (same origin only). */
const readBg = (qs: URLSearchParams): string | null => {
  const bg = qs.get('bg');
  return bg && bg.startsWith('/') && !bg.startsWith('//') ? bg : null;
};

const Backdrop = ({ src }: { src: string | null }) => (src
  ? <img src={src} alt="" className="absolute top-0 left-0 w-full h-full object-cover" />
  : null);

/** A drawn still in place of a TV picture: a gradient and the artwork, never a real frame. */
const DrawnStill = ({ art, wide }: { art: string; wide?: boolean }) => (
  <div
    className="absolute top-0 left-0 w-full h-full flex items-center justify-center"
    style={{ backgroundImage: 'linear-gradient(135deg, #0b2a4a 0%, #16395f 45%, #0e5a6b 100%)' }}
  >
    <img src={art} alt="" className={wide ? 'h-3/4 rounded-2xl shadow-2xl opacity-90' : 'w-48 h-48 rounded-3xl shadow-2xl opacity-90'} />
  </div>
);

// Solid, close to Live TV's own dark (black/70 over the wallpaper), so the
// channel list in the picture behind doesn't show through the screen on top.
const LIVE_CONTENT_BG = '#0e0c14';

const LiveContent = ({ bg, children }: { bg: string | null; children: React.ReactNode }) => (bg ? (
  <div className="relative w-full h-screen overflow-hidden text-white">
    <Backdrop src={bg} />
    <div className="absolute flex" style={{ top: LIVE_CONTENT.top, left: LIVE_CONTENT.left, right: 0, bottom: 0, backgroundColor: LIVE_CONTENT_BG }}>
      {children}
    </div>
  </div>
) : (
  <div className="w-full h-screen flex overflow-hidden text-white bg-black/70">{children}</div>
));

const Stage = ({ shot, bg }: { shot: StageShot; bg: string | null }) => {
  const { t } = useTranslation();
  const ch = useMemo(stageChannel, []);
  const nowNext = useMemo(stageNowNext, []);
  const liveController = useMemo(() => makeStageController(STAGE_SUBS, STAGE_AUDIO), []);
  const programmes = useMemo(stageProgrammes, []);

  switch (shot) {
    case 'live-signin':
      return <CredentialsForm initial={null} onSaved={noop} />;

    case 'live-holdmenu':
    case 'live-report':
      // The script presses the keys that reach the reasons step (live-report).
      return (
        <div className="relative w-full h-screen overflow-hidden">
          <Backdrop src={bg} />
          <ReportChannelDialog
            channelName={ch.name}
            channelId={ch.stream_id}
            categoryName={STAGE_CATEGORY}
            isFavorite={false}
            onToggleFavorite={noop}
            onRecord={noop}
            onClose={noop}
          />
        </div>
      );

    case 'live-player':
      return (
        <div className="relative w-full h-screen overflow-hidden text-white">
          <DrawnStill art={stageChannelLogo()} />
          <PlayerControlBar
            visible
            order={liveBarOrder({ rewind: true, record: true })}
            focus="rec"
            isPaused={false}
            controller={liveController}
            tracksTick={0}
            categoryName={STAGE_CATEGORY}
            channelLogo={ch.stream_icon}
            channelNum={ch.num}
            channelName={ch.name}
            nowTitle={nowNext.now?.title}
            nowStart={nowNext.now?.start}
            nowEnd={nowNext.now?.end}
            nextTitle={nowNext.next?.title}
            subMenuOpen={false}
            audioMenuOpen={false}
            subMenuFocus={-2}
            audioMenuFocus={-2}
            volMenuOpen={false}
            volume={0.8}
            rewind={{ availableSec: 1800, behindSec: 45, archiveDays: 0 }}
          />
        </div>
      );

    case 'live-record':
      return (
        <div className="relative w-full h-screen overflow-hidden">
          <Backdrop src={bg} />
          <RecordDialog
            channelName={ch.name}
            maxConnections={2}
            programme={nowNext.now ? { title: nowNext.now.title, endMs: nowNext.now.end } : null}
            onStart={noop}
            onClose={noop}
          />
        </div>
      );

    case 'guide-record':
      return (
        <div className="relative w-full h-screen overflow-hidden">
          <Backdrop src={bg} />
          <RecordDialog
            channelName={ch.name}
            maxConnections={2}
            programmes={programmes}
            streamId={ch.stream_id}
            existing={[]}
            onStart={noop}
            onClose={noop}
          />
        </div>
      );

    case 'recordings':
      // Its list comes from the recorder's web fallback (stageFixtures).
      return <LiveContent bg={bg}><RecordingsScreen active onClose={noop} /></LiveContent>;

    case 'multi':
      return (
        <LiveContent bg={bg}>
          <MultiScreenSection creds={DEMO_LIVE_CREDS} isActive previewOnly onExitLeft={noop} onExitUp={noop} />
        </LiveContent>
      );

    case 'plex-connect':
    case 'plex-link':
      return (
        <div className="relative w-full h-screen overflow-hidden bg-black/30">
          <PlexAuthScreen
            status={shot === 'plex-link' ? 'linking' : 'signed-out'}
            pinCode={shot === 'plex-link' ? STAGE_PLEX_CODE : null}
            error={null}
            providerAvailable
            onStartLink={noop}
            onLinkWithProvider={noop}
            onCancel={noop}
            onRetry={noop}
            onSignOut={noop}
          />
        </div>
      );

    case 'plex-player':
    case 'plex-upnext':
    case 'plex-subs':
    case 'plex-audio': {
      const prompt: PlayerPrompt | null = shot === 'plex-player'
        ? { kind: 'skip', label: t('plex.player.skipIntro'), onOk: noop }
        : shot === 'plex-upnext'
          ? { kind: 'next', label: t('plex.player.playNext'), detail: STAGE_PLEX.next, countdown: 10, onOk: noop, onBack: noop }
          : null;
      return (
        <div className="relative w-full h-screen overflow-hidden text-white">
          <DrawnStill art={STAGE_PLEX.poster()} wide />
          <PlexPlayerOverlay
            active
            title={`${STAGE_PLEX.show} · ${STAGE_PLEX.episode}`}
            controller={makeStageController(STAGE_SUBS, STAGE_AUDIO)}
            tracksTick={0}
            getPosition={async () => ({ position: STAGE_PLEX.positionSec, duration: STAGE_PLEX.durationSec, playing: true })}
            seekTo={noopAsync}
            onBackWhileHidden={noop}
            qualityKey="original"
            onChangeQuality={noop}
            volume={0.8}
            onChangeVolume={noop}
            prompt={prompt}
            // Paused keeps the control bar up without a key (Up next: the prompt alone).
            paused={shot !== 'plex-upnext'}
          />
        </div>
      );
    }
  }
};

const HowToStage = () => {
  const qs = useMemo(() => new URLSearchParams(window.location.search), []);
  const shot = qs.get('shot') as StageShot | null;
  // Only in a capture run (?demo=1&howto=1): the recorder's fixtures and the
  // extra demo channels are switched on by the same flag.
  if (!isHowtoCapture() || !shot || !(STAGE_SHOTS as readonly string[]).includes(shot)) {
    return <div data-howto-stage="unavailable" className="p-8 text-white">howto-stage: open with ?demo=1&amp;howto=1&amp;shot=&lt;{STAGE_SHOTS.join(' | ')}&gt;</div>;
  }
  return <div data-howto-stage={shot}><Stage shot={shot} bg={readBg(qs)} /></div>;
};

export default HowToStage;
