import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Smartphone, Video, MessageCircle, Sparkles } from 'lucide-react';
import { useVersion } from '@/hooks/useVersion';

/**
 * Per-version "What's New" entries. When a new build ships, add a new entry
 * here keyed by versionName. Users will see it once after upgrading.
 *
 * Keep entries SHORT and user-facing — no internal/code talk.
 */
const CHANGELOG: Record<string, string[]> = {
  '1.7.7': [
    '🎬 Plex: a short "Getting Plex ready…" while every Home rail and its posters load, so the screen is smooth the moment it appears instead of stuttering while rows arrive',
    '🔎 Plex search: Popular searches and your recent ones, right there before you type',
    '📲 Main Apps: Dreamstreams, VibezTV and Plex now point you to the Player, where they live under Live TV and Plex',
    '🤖 Older Android boxes: the Dashboard and Settings buttons are back at the top right',
  ],
  '1.7.6': [
    '🎬 Plex opens faster: Home shows as soon as the first rows land, and the rails ask the server for only what they show',
    '📦 Plex on small boxes: fewer requests at once, shorter rails, and a stalled server shows an empty row instead of freezing the screen',
    '🔞 Nothing adult on the home screen content bar or in Plex Home, Discover and Search, from Live TV or Plex — an adult library keeps its own tab',
  ],
  '1.7.5': [
    '📢 Alerts you place on Vibez, Dreamstreams or Plex now pop up in the Player too, for anyone signed into that service',
    '🎬 Plex: the side menu folds away while you browse and comes back with Left or Back',
    '📺 Live TV: only one thing is highlighted at a time — the category list no longer lights up while you are on the left menu',
    '🤖 Android boxes: the Plex menu no longer shows as blank white bars',
    '🔑 After sign-in, the finish-your-account card takes the remote instead of the screen behind it',
    '🧰 A box whose Android System WebView is too old now says so, and how to update it, instead of a white screen',
  ],
  '1.7.4': [
    '📺 Live TV: rest on a channel and it plays in the preview box, with sound — OK goes full screen. The preview no longer shows black on Fire TV',
    '🧭 Plex Discover: Because you watched, Hidden Gems, Surprise Me, Rediscover, and rows by genre and decade — under Home in the side menu, with Search right below it',
    '🏠 Plex Home: Popular is now Most Watched',
    '⌨️ Sign-in keyboard fixed on Fire TV: OK opens it, Next moves to Password, Next again lands on Sign In — and it stays closed',
    '👤 Dashboard: Billing & subscription no longer sits cut off below the screen',
    '🖥️ Live TV Settings: the category list no longer stays highlighted while you are in Settings',
  ],
  '1.7.3': [
    '📰 Posts from Snow Media, in Support: every email we send lands under the Posts tab too — dated, marked New until you open it, readable full screen. Turn the heads-up off under Settings → UI',
    '📺 Live TV, your way: Classic, Compact or Grid. The first time you open Live TV it asks which look you want; change it any time under Player Settings → Appearance. OK on a channel previews it, OK again goes full screen',
    '🎬 Plex, redone: a menu down the left for Home and your libraries, slimmer rows, a lighter title page — and hold OK on a library to hide it',
    '🎮 Game Lounge, all new: Blackjack, Casino Hold\'em, Roulette, Slots, Plinko, Dice, Video Poker, TV Trivia and the Daily Spin — play for Snow Coins and climb the leaderboard',
    '🧹 Device Cleaner in Support: frees space and memory in one press, and finds apps nobody opens',
    '💎 Snow Gems from the TV: pick a pack, scan the code, pay on your phone — the gems land on your account by themselves',
    '✨ Premium AI: switch Chat and Image Gen to the top models for Snow Gems, or stay on free',
    '🏠 Dashboard fits on one screen — or pick Large under Settings → UI',
    '🤖 AI Chat can do things now: ask it to open a screen, change your Live TV look, report a channel, install an app or make you a wallpaper — and How to use SMC is up to date',
    '🎯 Content bar, built for you: what you were watching, your live channels with what\'s on now, and Plex picks based on what you watch',
  ],
  '1.7.1': [
    '🚀 No streaming account yet? Create one right on the TV from the sign-in screen',
    '🎁 Start a free 2-day trial with no card, or buy a plan — the Player signs you in when it is ready',
    '👤 My Account: see what you have, extend it, redeem a gift code, or switch the Player to another service',
    '🎬 Plex signs in by itself when you are signed into Live TV — no more codes to send',
    '📧 Your username and password are emailed to you after a trial or purchase, so you cannot lose them',
    '⌨️ Keyboard fixed: Back closes it and stays put, Next moves to the next box',
    '🖥️ Multi-Screen shows every picture again, and the home content bar is back',
    '🐢 Fixed buffering? Long-press a channel: open the guide or send us a ticket',
    'Smoother and lighter: less running in the background while you watch',
  ],
  '1.7': [
    '🎬 New screen-format button in the player — switch between Wide, Fill and Zoom so movies fill your TV properly',
    '🔔 Alerts now reach you even when SMC is closed, and you can turn them off in Settings',
    '📎 Send a screenshot or a short voice message with your support ticket',
    '🎨 Fresh Snow Media background across the app',
    '🕹️ Fixed left/right on the remote in Main Apps and Support, and the focus box is rounded again',
    '🖥️ My Account and the sign-in screen now fit your TV properly',
    '🔑 Forgot your website password? Reset it right from the sign-in screen',
    'Plex loads faster, playback no longer restarts, and the games are playable again',
  ],
  '1.6.9': [
    '🛍️ The Snow Media Store is back — browse items on your TV, scan a QR to check out on your phone',
    '🔑 Sign into My Account with your streaming login — your linked account loads automatically',
    '🖥️ Remote Access now works from a browser too: request and pay anywhere, finish in the app',
    'Bug fixes and performance improvements',
  ],
  '1.6.8': [
    '📰 New: add a Snow Media news widget to your box\'s home screen',
    '💬 Closed captions now work on many more Live TV channels',
    '🔊 Channels with no sound now tell you why instead of playing silently',
    '💬 Scroll back through your whole Support ticket conversation with the remote',
    'Clearer message if an update download fails',
    'Bug fixes and performance improvements',
  ],
  '1.6.7': [
    '🔗 New: Link your email to your Player account so we can remind you before it expires',
    'Scan a QR with your phone or enter your email right on your TV',
    'Manage your subscription and renewals from your phone after linking',
    'Bug fixes and performance improvements',
  ],
  '1.6.6': [
    '🔊 Fixed audio on Dolby (AC-3) channels across all devices',
    'Clearer message when your connection is slow',
    'Bug fixes and performance improvements',
  ],
  '1.6.5': [
    '🎁 Giveaway alerts — a gift badge and a one-time popup now let you know when a giveaway is running',
    '⏳ New countdown timer in the Giveaway section',
    'Cleaner giveaway rules screen and prize artwork',
    'Bug fixes and performance improvements',
  ],
  '1.6.4': [
    '🎁 NEW: August SMC Giveaway — check your entries on the home screen',
    'Enter right from your TV: active accounts are entered automatically',
    'Facebook bonus entry with easy QR steps',
    'Bug fixes and performance improvements',
  ],
  '1.6.3': [
    'Movies & Shows always plays in Original quality — no more surprise "transcoding"',
    'Stuck loading now fixes itself in seconds (with a working Retry everywhere)',
    'New: "How to use SMC" tour in Support — a simple guide to every screen',
    'New: Plex Settings tab — manage categories, see your account, sign out',
    'New: "Fix audio" button in the Audio menu for silent movies',
    'Home screen fixes: content bar sizing + alerts no longer cover buttons',
  ],
  '1.6.2': [
    'Plex: fixed the freeze when opening a movie or show',
    'Faster, lighter Plex image loading',
    'Fixed sign-in drop-outs on some devices',
    'Live TV: channel up/down now works in fullscreen',
    'Fixed a volume-stuck-muted issue',
    'Main Apps now shows "Not installed" clearly',
  ],
  '1.6.1': [
    'Plex: posters load fast again',
    'Plex: fixed missing audio on some movies',
    'Plex: movies pre-buffer 10 seconds for smoother starts',
    'Fixed the stuck "Still preparing" popup',
    'Player Help button now offers support options',
  ],
  '1.6': [
    'Multi-Screen: watch 2 or 4 channels at once (side-by-side, stacked, or 4-grid)',
    'Volume slider added to the player menu',
    'Live TV: player controls now hide fully in fullscreen',
    'Plex: faster browsing, cast photos, quality selector, download subtitles',
    'Fix-buffering shortcut inside the player',
  ],
  '1.5.9': [
    'Plex: movie & show detail pages with ratings, cast and Resume',
    'Plex: full episode browsing for shows',
    'Plex: playback controls — pause, skip, audio & subtitle tracks',
    'Plex: download subtitles from OpenSubtitles',
    'Plex: Home + Search + hide libraries; posters now load',
    'New back-button flow inside Plex',
  ],
  '1.5.8': [
    'Player now opens with two choices — Live TV and Movies & Shows',
    'New: Movies & Shows powered by Plex — sign in once and stream your library',
    'New: Request tab — ask for any movie or show right from the app',
    'Content Bar titles now open inside the app, landing right on the title',
    'Channels now auto-recover from stream drops — no more frozen picture',
    'Main Apps: "not installed" now offers instant Download & Install',
  ],
  '1.5.7': [
    'New: full EPG "Guide" — classic cable-grid layout under Live TV',
    'New: Settings hub — Account, Switch Account, Appearance, Sign Out in one place',
    'New: Saved Accounts — save Dreamstreams + Vibez and switch without re-typing',
    'New: Appearance — customize font, text size, highlight, background & text color',
    'Player closed captions + audio-track selection',
  ],
  '1.5.6': [
    'All-new native video engine — smoother playback and fixed audio on every channel',
    'Closed captions (CC) — pick them in the player\'s subtitle menu',
    'Press & hold a channel: favorites + report with category and channel prefilled',
    'Back button behaves everywhere — fullscreen returns to the channel list',
    'News ticker no longer pauses while you navigate',
    'Faster app detection in Main Apps + pinned apps install directly',
  ],
  '1.5.5': [
    'Smoother Live TV — scroll all the way through categories and channels, the side menu collapses when you open one, and Back steps cleanly instead of exiting the whole player',
    'New "Update Channels" button to refresh your list instantly',
    'Every selected button now shows a clear gold highlight',
    'Speed test: you can now exit it any time and scroll to the full results',
    'AI images you create while signed out now stay in your gallery until you clear the app\'s data',
  ],
  '1.5.4': [
    'Clearer on-screen highlight so you always see exactly what\'s selected',
    'Player: new "Update Channels" button + auto-refresh every time you open it',
    'New Pre-Event Steps reminder for PPV nights (turn it on in Settings → App Alerts)',
    'Smoother D-pad navigation in the AI chat, Settings, Player, and image gallery',
    'Read AI replies aloud in Josh\'s voice — now free',
  ],
  '1.5.3': [
    'Free AI assistant is now open to everyone — no sign-in needed to chat or make images',
    'Upgraded to a faster, smarter AI model',
    'Voice replies are more reliable on Fire TV (new "tap to hear" option)',
    'Fixed a glitch where typing in AI chat could trigger the mic / hide the keyboard',
  ],
  '1.5.2': [
    'Your Account screen now shows your full subscription — expiration, connections, and your login details',
    'Improved the content-bar preview',
  ],
  '1.5.1': [

    'New Snow Gems & Snow Coins — buy Snow Gems for AI features and image generation, and get bonus free Snow Coins to play in the Game Room',
    'Game Room now fits your TV screen properly — no more games getting cut off at the top or bottom',
    'Movies & Series open instantly and scroll smoothly — no more freezing when you open them',
    'Smoother video playback, plus you can now reach Account right from the player',
    'The Content Bar now starts off, with a quick one-tap option to turn it on (lighter on older devices)',
    'New languages: Spanish, French, German, and Arabic',
    'Performance improvements across older and lower-powered devices',
  ],
  '1.1.0': [
    'New, more intuitive layout — easier to find your way around',
    'All support is now in one place: tickets, AI chat, videos, and the buffering guide together under Support',
    'Turn the Content Bar on or off any time in Settings → UI — great if it makes your device feel slower',
    'Brand new interactive Buffering Guide with built-in speed test and one-tap VPN install',
    'Pinned Apps now show which ones are actually installed — tap a greyed-out pin to reinstall it',
    'Send a Support ticket without an account (add your email and we can create your account right from the form)',
    'Bug fixes and polish across the home screen, Support, and navigation',
  ],
  '1.0.5': [
    'Content Bar can now be turned off in Settings → Updates — great for older or slower devices',
    'Smoother home screen — news ticker no longer stutters when moving across the bottom buttons',
    'Plex now uses direct playback again when launching movies from the Content Bar',
    'Simpler Plex launching with fewer extra handoff attempts on Android',
    'D-pad now reaches the new Content Bar toggle directly from the Updates tab',
  ],

  '1.0.4': [
    'Plex deep-linking fixed — tapping a movie or show on the Content Bar now opens that exact item in Plex',
    'Content Bar duplicates removed — 1080p and 4K versions are merged so each title only appears once (switch to 4K from inside Plex)',
    'Buffering Guide: IPVanish and Surfshark now download directly from the same source as Main Apps',
    'Smoother back-button behavior on popups and Pinned Apps',
  ],
  '1.0.3': [
    'New Content Bar — now connects directly to your Plex library for movies, shows, and Continue Watching',
    'Live TV events now show only what is actually airing right now (Live TV streaming connection coming soon)',
    'Small fixes and polish to the Buffering Guide',
    'Layout tweaks across the home screen for a cleaner look',
  ],
  '1.0.2': [
    'Added the built-in Speed Test',
    'Added the interactive Buffering Guide in Main Apps',
    'Fine-tuned the Snow Media AI assistant',
  ],
};

const STORAGE_KEY = 'smc-welcome-shown-version';

interface WelcomePopupProps {
  /**
   * Reports whether this is on screen. Index needs it: this popup takes the
   * whole screen and has no gate of its own, so any other notice opening at
   * the same time lands on top of it and the viewer can no longer reach
   * "Let's go".
   */
  onOpenChange?: (open: boolean) => void;
}

const WelcomePopup = ({ onOpenChange }: WelcomePopupProps) => {
  const { version, isLoading } = useVersion();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'first' | 'whatsnew'>('first');

  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => { onOpenChangeRef.current?.(open); }, [open]);

  useEffect(() => {
    if (isLoading) return;
    try {
      const last = localStorage.getItem(STORAGE_KEY);
      if (!last) {
        // First install (or storage cleared)
        setMode('first');
        setOpen(true);
      } else if (last !== version && CHANGELOG[version]) {
        // Updated to a version that has a changelog entry
        setMode('whatsnew');
        setOpen(true);
      }
    } catch {
      // ignore — show nothing if storage is unavailable
    }
  }, [version, isLoading]);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, version);
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  // Auto-focus the primary button so D-pad / Enter dismisses immediately
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const btn = document.querySelector<HTMLButtonElement>('[data-welcome-primary="true"]');
      btn?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [open]);

  // Trap input: arrows keep focus on button, Back/Escape dismisses
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const key = e.key;
      const code = (e as any).keyCode;
      if (key === 'Escape' || key === 'Backspace' || key === 'GoBack' || code === 4 || code === 27) {
        e.preventDefault();
        e.stopPropagation();
        dismiss();
        return;
      }
      if (key === 'Enter' || key === ' ' || code === 13 || code === 23 || code === 66) {
        // Activate the popup button ourselves and stop the event from
        // reaching the underlying page handler (which would also activate
        // the focused card behind the popup).
        e.preventDefault();
        e.stopPropagation();
        dismiss();
        return;
      }
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        // The notes can run longer than the screen: Up/Down read through them.
        e.preventDefault();
        e.stopPropagation();
        const box = document.querySelector<HTMLElement>('[data-welcome-scroll="true"]');
        if (box) box.scrollBy({ top: (key === 'ArrowDown' ? 1 : -1) * Math.round(box.clientHeight * 0.6), behavior: 'smooth' });
        document.querySelector<HTMLButtonElement>('[data-welcome-primary="true"]')?.focus({ preventScroll: true });
        return;
      }
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        document.querySelector<HTMLButtonElement>('[data-welcome-primary="true"]')?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open]);

  const changelog = useMemo(() => CHANGELOG[version] || [], [version]);

  // Only offer to scroll when the notes actually overflow the box.
  const [canScroll, setCanScroll] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const box = document.querySelector<HTMLElement>('[data-welcome-scroll="true"]');
      setCanScroll(!!box && box.scrollHeight > box.clientHeight + 4);
    }, 120);
    return () => clearTimeout(t);
  }, [open, changelog]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/85 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <Card className={`w-full ${mode === 'first' ? 'max-w-lg' : 'max-w-5xl'} bg-gradient-to-br from-blue-900 to-slate-900 border-blue-500/40 p-6 relative shadow-2xl`}>

        {mode === 'first' ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-6 h-6 text-yellow-300" />
              <h2 className="text-2xl font-bold text-white">Welcome to Snow Media Center</h2>
            </div>
            <p className="text-sm text-white/80 mb-4">
              Here's what each section does:
            </p>
            <ul className="space-y-3 text-sm text-white/95">
              <li className="flex gap-3">
                <Smartphone className="w-5 h-5 mt-0.5 text-cyan-300 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Main Apps</p>
                  <p className="text-white/75">Download all apps pertaining to Snow Media.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <Video className="w-5 h-5 mt-0.5 text-purple-300 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Support Videos</p>
                  <p className="text-white/75">Step-by-step videos on devices and services.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <MessageCircle className="w-5 h-5 mt-0.5 text-green-300 flex-shrink-0" />
                <div>
                  <p className="font-semibold">Chat &amp; Community</p>
                  <p className="text-white/75">
                    Submit tickets for help or questions — AI chat bot also available.
                  </p>
                </div>
              </li>
            </ul>
            <div className="mt-4 bg-white/5 border border-white/10 rounded-md p-3 text-xs text-white/80">
              Sign in with your <strong>snowmediaent.com</strong> account, or create a new one to
              keep track of purchases and Snow Gems.
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-6 h-6 text-yellow-300" />
              <h2 className="text-2xl font-bold text-white">What's New in v{version}</h2>
            </div>
            <div data-welcome-scroll="true" className="max-h-[58vh] overflow-y-auto overscroll-contain pr-2">
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2.5 text-base leading-snug text-white/95 list-disc list-outside pl-5">
                {changelog.map((line, i) => (
                  <li key={i} className="break-words">{line}</li>
                ))}
              </ul>
            </div>
            <p className="mt-3 text-xs text-white/50">{canScroll ? "▲ ▼ scroll · OK close" : "OK close"}</p>
          </>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-sm italic text-yellow-300/90 font-quicksand">
            Stay Streamin — Stay Dreamin
          </p>
          <Button
            data-welcome-primary="true"
            onClick={dismiss}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-6 focus:ring-4 focus:ring-yellow-300 focus:scale-105 transition-all"
          >
            {mode === 'first' ? "Let's go" : 'Got it'}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default memo(WelcomePopup);
