// The demo's Snow Originals: six made-up videos with drawn posters (inline SVG,
// like liveTvDemo.ts), so the website demo shows the section with no server
// and no real names. There is no video behind them (`videoUrl: ''`): OK shows
// the demo note instead of playing.
//   3 upright and 3 sideways · 2 new · 2 kid-friendly
import type { SnowOriginal } from '@/lib/snowOriginals';

const svgUri = (svg: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

type Art = 'snow' | 'studio' | 'flake' | 'guide' | 'remote' | 'lights';

/** A small drawn scene on a two-colour sky, sized w×h. */
function drawing(art: Art, w: number, h: number, c1: string, c2: string): string {
  const cx = w / 2;
  const cy = h / 2;
  const u = Math.min(w, h) / 10; // one unit of the drawing
  let scene = '';
  if (art === 'snow') {
    scene =
      `<circle cx="${w * 0.75}" cy="${h * 0.22}" r="${u * 1.2}" fill="#fff7d6" fill-opacity="0.9"/>` +
      `<path d="M0 ${h * 0.7} Q ${w * 0.3} ${h * 0.55} ${w * 0.55} ${h * 0.68} T ${w} ${h * 0.62} V ${h} H 0 Z" fill="#ffffff" fill-opacity="0.85"/>` +
      `<path d="M0 ${h * 0.82} Q ${w * 0.4} ${h * 0.72} ${w} ${h * 0.8} V ${h} H 0 Z" fill="#e6f0ff"/>` +
      [0.15, 0.32, 0.5, 0.64, 0.86, 0.24, 0.42, 0.78].map((x, i) =>
        `<circle cx="${w * x}" cy="${h * (0.1 + (i % 4) * 0.12)}" r="${u * 0.18}" fill="#ffffff"/>`).join('');
  } else if (art === 'studio') {
    scene =
      `<rect x="${cx - u * 3}" y="${cy - u * 1.6}" width="${u * 4.4}" height="${u * 3.2}" rx="${u * 0.5}" fill="#0b1622" fill-opacity="0.85"/>` +
      `<path d="M${cx + u * 1.4} ${cy - u * 0.6} L ${cx + u * 3} ${cy - u * 1.4} V ${cy + u * 1.4} L ${cx + u * 1.4} ${cy + u * 0.6} Z" fill="#0b1622" fill-opacity="0.85"/>` +
      `<circle cx="${cx - u * 0.8}" cy="${cy}" r="${u * 0.9}" fill="none" stroke="#ffd166" stroke-width="${u * 0.3}"/>` +
      `<circle cx="${cx - u * 2.3}" cy="${cy - u * 1}" r="${u * 0.25}" fill="#ef4444"/>`;
  } else if (art === 'flake') {
    const arms = [0, 60, 120].map((a) =>
      `<g transform="rotate(${a} ${cx} ${cy})">` +
      `<line x1="${cx}" y1="${cy - u * 3}" x2="${cx}" y2="${cy + u * 3}" stroke="#ffffff" stroke-width="${u * 0.35}" stroke-linecap="round"/>` +
      `<path d="M${cx - u * 0.8} ${cy - u * 2.4} L ${cx} ${cy - u * 1.6} L ${cx + u * 0.8} ${cy - u * 2.4} M${cx - u * 0.8} ${cy + u * 2.4} L ${cx} ${cy + u * 1.6} L ${cx + u * 0.8} ${cy + u * 2.4}" fill="none" stroke="#ffffff" stroke-width="${u * 0.25}" stroke-linecap="round"/>` +
      `</g>`).join('');
    scene = `<circle cx="${cx}" cy="${cy}" r="${u * 3.8}" fill="#ffffff" fill-opacity="0.12"/>${arms}`;
  } else if (art === 'guide') {
    let cells = '';
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 3; c++) {
        const cw = (w * 0.8) / 3 - u * 0.3;
        const x = w * 0.1 + c * (cw + u * 0.3);
        cells += `<rect x="${x}" y="${h * 0.18 + r * h * 0.17}" width="${cw}" height="${h * 0.12}" rx="${u * 0.3}" fill="#ffffff" fill-opacity="${r === 1 && c === 1 ? 0.9 : 0.25}"/>`;
      }
    }
    scene = cells;
  } else if (art === 'remote') {
    scene =
      `<rect x="${cx - u * 1.5}" y="${cy - u * 4}" width="${u * 3}" height="${u * 8}" rx="${u * 1.2}" fill="#0b1622" fill-opacity="0.9"/>` +
      `<circle cx="${cx}" cy="${cy - u * 1.8}" r="${u * 1}" fill="none" stroke="#ffd166" stroke-width="${u * 0.25}"/>` +
      `<circle cx="${cx}" cy="${cy - u * 1.8}" r="${u * 0.4}" fill="#ffd166"/>` +
      [0, 1, 2].map((i) => `<circle cx="${cx - u * 0.7 + i * u * 0.7}" cy="${cy + u * 0.8}" r="${u * 0.25}" fill="#ffffff" fill-opacity="0.7"/>`).join('') +
      [0, 1, 2].map((i) => `<circle cx="${cx - u * 0.7 + i * u * 0.7}" cy="${cy + u * 1.8}" r="${u * 0.25}" fill="#ffffff" fill-opacity="0.7"/>`).join('');
  } else {
    scene =
      `<path d="M${cx - u * 0.4} ${h * 0.45} L ${cx - w * 0.45} ${h} H ${cx + w * 0.45} L ${cx + u * 0.4} ${h * 0.45} Z" fill="#0b1622" fill-opacity="0.8"/>` +
      `<path d="M${cx} ${h * 0.5} V ${h}" stroke="#ffd166" stroke-width="${u * 0.2}" stroke-dasharray="${u * 0.6} ${u * 0.6}"/>` +
      ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#fbbf24'].map((col, i) =>
        `<circle cx="${w * (0.1 + i * 0.16)}" cy="${h * (0.2 + (i % 2) * 0.08)}" r="${u * 0.45}" fill="${col}" fill-opacity="0.85"/>`).join('');
  }
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">` +
    `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>` +
    `</linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>${scene}</svg>`,
  );
}

/** The blurred fill beside an upright poster: just its two colours, as the Hub's 32-px still would look stretched. */
const backdrop = (c1: string, c2: string): string => svgUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="57" viewBox="0 0 32 57">` +
  `<defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">` +
  `<stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>` +
  `</linearGradient></defs><rect width="32" height="57" fill="url(#g)"/></svg>`,
);

const DAY = 24 * 60 * 60_000;
const ago = (days: number): string => new Date(Date.now() - days * DAY).toISOString();

interface Seed { id: string; title: string; description: string; art: Art; colors: [string, string]; portrait: boolean; durationSec: number; days: number; kidFriendly: boolean }

const SEEDS: Seed[] = [
  { id: 'demo-orig-1', title: 'Snow Day at the Studio', description: 'A quick look around the place where the Snow Media team builds the TV app, on the snowiest morning of the year.', art: 'snow', colors: ['#1e3a8a', '#60a5fa'], portrait: true, durationSec: 42, days: 1, kidFriendly: false },
  { id: 'demo-orig-2', title: 'Your New Box in Two Minutes', description: 'Plug in, pick a profile, open Live TV. Everything you need on day one.', art: 'studio', colors: ['#7a1f3d', '#f97316'], portrait: false, durationSec: 128, days: 3, kidFriendly: false },
  { id: 'demo-orig-3', title: 'Paper Snowflakes, Step by Step', description: 'Fold, cut, unfold: six easy snowflakes to hang in the window.', art: 'flake', colors: ['#0e7490', '#a5f3fc'], portrait: true, durationSec: 95, days: 12, kidFriendly: true },
  { id: 'demo-orig-4', title: 'Finding Shows in the Guide', description: 'Jump a day ahead, find tonight’s game, and set a recording without leaving the couch.', art: 'guide', colors: ['#312e81', '#7c3aed'], portrait: false, durationSec: 64, days: 20, kidFriendly: false },
  { id: 'demo-orig-5', title: 'The Big Remote Challenge', description: 'How fast can the team find a channel with the remote behind their back?', art: 'remote', colors: ['#134e4a', '#2dd4bf'], portrait: true, durationSec: 37, days: 35, kidFriendly: false },
  { id: 'demo-orig-6', title: 'Winter Lights Drive', description: 'A slow, cosy drive past the brightest light displays in town.', art: 'lights', colors: ['#0b1622', '#3b0764'], portrait: false, durationSec: 175, days: 60, kidFriendly: true },
];

export const ORIGINALS_DEMO: SnowOriginal[] = SEEDS.map((s, i) => {
  const [c1, c2] = s.colors;
  const width = s.portrait ? 720 : 1920;
  const height = s.portrait ? 1280 : 1080;
  return {
    id: s.id,
    title: s.title,
    description: s.description,
    videoUrl: '',
    posterUrl: s.portrait ? drawing(s.art, 405, 720, c1, c2) : drawing(s.art, 640, 360, c1, c2),
    backdropUrl: s.portrait ? backdrop(c1, c2) : null,
    durationSec: s.durationSec,
    width,
    height,
    portrait: s.portrait,
    kidFriendly: s.kidFriendly,
    publishedAt: ago(s.days),
    createdAt: ago(s.days),
    sort: i * 10,
  };
});
