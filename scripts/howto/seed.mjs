// How-to capture: what the box "remembers" before the app starts, and the
// made-up account it is signed into. Plan: .claude/plan-howto.md §4.2.
// Everything here is invented: the user is Alex Demo (alex@example.com).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './check.mjs';

export const DEMO_USER_ID = 'a1e2d3c4-5b6a-4c7d-8e9f-0a1b2c3d4e5f';
export const DEMO_EMAIL = 'alex@example.com';
export const DEMO_NAME = 'Alex Demo';

/** The fixed moment every picture is taken at (Sun 4 Oct 2026, 19:30 in New York). */
export const CAPTURE_TIME = new Date('2026-10-04T19:30:00-04:00');

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** The Supabase session of the made-up account (never valid anywhere). */
export function demoSession() {
  const exp = Math.floor(new Date('2099-01-01').getTime() / 1000);
  const user = {
    id: DEMO_USER_ID, aud: 'authenticated', role: 'authenticated', email: DEMO_EMAIL,
    email_confirmed_at: '2026-01-10T12:00:00Z', phone: '', confirmed_at: '2026-01-10T12:00:00Z',
    last_sign_in_at: '2026-10-04T12:00:00Z', app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: DEMO_NAME, display_name: DEMO_NAME, email: DEMO_EMAIL },
    identities: [], created_at: '2026-01-10T12:00:00Z', updated_at: '2026-10-04T12:00:00Z', is_anonymous: false,
  };
  const jwt = [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub: DEMO_USER_ID, email: DEMO_EMAIL, role: 'authenticated', aud: 'authenticated', exp }), 'howto-demo'].join('.');
  return {
    access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: exp,
    refresh_token: 'howto-demo', user,
  };
}

/** The Supabase project ref, from the generated client. */
export function supabaseRef() {
  const src = readFileSync(join(ROOT, 'src', 'integrations', 'supabase', 'client.ts'), 'utf8');
  return /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(src)[1];
}

export function appVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'version.json'), 'utf8')).currentVersion;
}

/** "Who's watching?": Me, Sam, and a Kids profile with a PIN. The PIN is 1234
 *  (the hash is sha256 of smc-pin:<account>:<profile>:<pin>, see profiles.ts);
 *  the profile-edit recipe types it. */
export const PROFILES = [
  { id: 'main', name: 'Me', avatar: 'blue', kidsLevel: null, pinHash: null, position: 0, t: 1 },
  { id: 'samsam', name: 'Sam', avatar: 'teal', kidsLevel: null, pinHash: null, position: 1, t: 1 },
  { id: 'kidsjr', name: 'Kids', avatar: 'orange', kidsLevel: 'kids', pinHash: '48911c45f5cb62d8c31d99ba584e3ff8dc24d2678b44ce37d4781da2128a15c6', position: 2, t: 1 },
];

/**
 * The storage a page starts with. opts.layout: false leaves the Live TV
 * layout unchosen (the first-visit chooser shows); opts.pick: true leaves
 * the profile unpicked ("Who's watching?" shows).
 */
export function seedFor(lang, opts = {}) {
  const session = demoSession();
  const acc = DEMO_USER_ID;
  const local = {
    smc_lang: lang,
    'smc-welcome-shown-version': appVersion(),
    'smc-media-bar-prompt-seen': '1',
    'smc-profiles-intro-seen': '1',
    'snow-media-bar-enabled': '1',
    'smc-phone-remote-typing-hint-shown': '99',
    [`sb-${supabaseRef()}-auth-token`]: JSON.stringify(session),
    [`smc-profiles-v1:${acc}`]: JSON.stringify(PROFILES),
    [`smc-profiles-pulled:${acc}`]: '1',
    [`smc-last-profile:${acc}`]: 'main',
    // Two services in one list: the demo line and a second one on the demo host.
    'snow-livetv-saved-accounts-v1': JSON.stringify([
      { id: 'demo://livetv::demo account', serverLabel: 'DreamStreams', host: 'demo://livetv', username: 'DEMO ACCOUNT', password: 'demo', output: 'm3u8', addedAt: 1 },
      { id: 'demo://vibez::demo vibez', serverLabel: 'Vibez', host: 'demo://vibez', username: 'DEMO VIBEZ', password: 'demo', output: 'm3u8', addedAt: 2 },
    ]),
  };
  if (opts.layout !== false) local['snow-livetv-layout'] = 'classic';
  const session_ = { 'smc-demo': '1', 'smc-howto': '1' };
  if (!opts.pick) session_['smc-active-profile'] = `${acc}|main`;
  return { local, session: session_, clearLayout: opts.layout === false };
}

/** The init script (runs before the app on every page load). */
export function initScript({ local, session, clearLayout }) {
  return `(() => {
    try {
      if (location.protocol !== 'http:') return;
      const local = ${JSON.stringify(local)};
      const session = ${JSON.stringify(session)};
      if (!sessionStorage.getItem('__howto_seeded')) {
        // A fresh box for every picture: nothing left over from the last one.
        localStorage.clear();
        for (const [k, v] of Object.entries(local)) localStorage.setItem(k, v);
        if (${clearLayout}) localStorage.removeItem('snow-livetv-layout');
        for (const [k, v] of Object.entries(session)) sessionStorage.setItem(k, v);
        sessionStorage.setItem('__howto_seeded', '1');
      }
    } catch (e) { /* storage blocked */ }
    // Voice: a recogniser that listens and never hears anything, so the voice
    // panel stays on "listening".
    try {
      class FakeRecognition extends EventTarget {
        constructor() { super(); this.lang = 'en-US'; this.continuous = false; this.interimResults = false; }
        start() { setTimeout(() => { this.onstart && this.onstart(new Event('start')); this.onaudiostart && this.onaudiostart(new Event('audiostart')); }, 50); }
        stop() {} abort() {}
      }
      window.SpeechRecognition = FakeRecognition;
      window.webkitSpeechRecognition = FakeRecognition;
    } catch (e) { /* ignore */ }
  })();`;
}
