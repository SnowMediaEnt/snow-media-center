// Drawn artwork for the made-up titles in the fixtures (owner answer 2: no
// studio posters in the pictures). A fixture names an image as
//   https://img.example.com/<kind>/<slug>.svg
// and the capture's network layer answers it with an SVG drawn here from the
// slug: the same title always gets the same picture.
//   kind: poster (2:3) · backdrop (16:9) · logo (square) · tile (16:9, no text) · avatar (square)

const PALETTES = [
  ['#0b1f3a', '#1d4e89', '#f2c14e'],
  ['#1b0f2e', '#5b2a86', '#f78e69'],
  ['#062925', '#0f766e', '#a7f3d0'],
  ['#2a0f0f', '#9a3412', '#fcd34d'],
  ['#0f172a', '#334155', '#38bdf8'],
  ['#1f1300', '#a16207', '#fde68a'],
  ['#12071f', '#be185d', '#fbcfe8'],
  ['#03161f', '#0369a1', '#e0f2fe'],
];

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const titleFromSlug = (slug) => slug.split('-').filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

// A few simple scenes, so a row of posters doesn't look like one poster.
const SCENES = [
  // mountains under a moon
  (w, h, [, mid, hi]) => `<circle cx="${w * 0.7}" cy="${h * 0.28}" r="${w * 0.12}" fill="${hi}" opacity=".9"/>
    <path d="M0 ${h * 0.72} L${w * 0.3} ${h * 0.42} L${w * 0.5} ${h * 0.6} L${w * 0.72} ${h * 0.36} L${w} ${h * 0.66} V${h} H0Z" fill="${mid}" opacity=".85"/>`,
  // city skyline
  (w, h, [bg, mid, hi]) => {
    let s = '';
    for (let i = 0; i < 9; i++) {
      const bw = w / 9; const bh = h * (0.18 + ((i * 37) % 30) / 100);
      s += `<rect x="${i * bw}" y="${h * 0.78 - bh}" width="${bw - 3}" height="${bh + h * 0.22}" fill="${i % 2 ? mid : bg}" opacity=".9"/>`;
    }
    return `<circle cx="${w * 0.25}" cy="${h * 0.22}" r="${w * 0.08}" fill="${hi}"/>` + s;
  },
  // waves
  (w, h, [, mid, hi]) => [0, 1, 2].map((i) => `<path d="M0 ${h * (0.55 + i * 0.12)} Q${w * 0.25} ${h * (0.48 + i * 0.12)} ${w * 0.5} ${h * (0.55 + i * 0.12)} T${w} ${h * (0.55 + i * 0.12)} V${h} H0Z" fill="${i === 1 ? hi : mid}" opacity="${0.35 + i * 0.2}"/>`).join(''),
  // rings
  (w, h, [, mid, hi]) => [0.34, 0.24, 0.14].map((r, i) => `<circle cx="${w * 0.5}" cy="${h * 0.4}" r="${w * r}" fill="none" stroke="${i === 1 ? hi : mid}" stroke-width="${w * 0.03}"/>`).join(''),
  // stripes
  (w, h, [, mid, hi]) => [0, 1, 2, 3].map((i) => `<rect x="${-w * 0.2 + i * w * 0.32}" y="0" width="${w * 0.12}" height="${h * 1.4}" fill="${i % 2 ? hi : mid}" opacity=".35" transform="rotate(20 ${w / 2} ${h / 2})"/>`).join(''),
];

/** Split a title into at most 3 lines of about `max` characters. */
const lines = (title, max) => {
  const out = [];
  for (const word of title.split(' ')) {
    const last = out[out.length - 1];
    if (last && (last + ' ' + word).length <= max) out[out.length - 1] = last + ' ' + word;
    else out.push(word);
  }
  return out.slice(0, 3);
};

/** The SVG text for one image. */
export function drawArt(kind, slug) {
  const h0 = hash(slug);
  const pal = PALETTES[h0 % PALETTES.length];
  const scene = SCENES[(h0 >>> 3) % SCENES.length];
  const title = titleFromSlug(slug);
  const [w, h] = kind === 'poster' ? [400, 600]
    : kind === 'logo' || kind === 'avatar' ? [300, 300]
      : [640, 360];
  const bg = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal[1]}"/><stop offset="1" stop-color="${pal[0]}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/>`;
  let body = '';
  if (kind === 'logo') {
    const initials = title.split(' ').map((x) => x[0]).join('').slice(0, 3);
    body = `<circle cx="150" cy="150" r="118" fill="${pal[0]}" stroke="${pal[2]}" stroke-width="10"/>
      <text x="150" y="${150 + 24}" font-family="Montserrat, Arial, sans-serif" font-weight="900" font-size="${initials.length > 2 ? 64 : 80}" fill="${pal[2]}" text-anchor="middle">${esc(initials)}</text>`;
  } else if (kind === 'avatar') {
    body = `<circle cx="150" cy="118" r="54" fill="${pal[2]}"/><path d="M50 280 Q150 160 250 280Z" fill="${pal[2]}"/>`;
  } else {
    body = scene(w, h, pal);
    if (kind !== 'tile') {
      const size = kind === 'poster' ? 46 : 42;
      const ls = lines(title, kind === 'poster' ? 14 : 22);
      const y0 = kind === 'poster' ? h * 0.8 - (ls.length - 1) * size * 1.1 : h * 0.62 - (ls.length - 1) * size * 1.1;
      body += `<rect x="0" y="${y0 - size * 1.4}" width="${w}" height="${h - y0 + size * 1.4}" fill="${pal[0]}" opacity=".35"/>`;
      body += ls.map((l, i) => `<text x="${w / 2}" y="${y0 + i * size * 1.1}" font-family="Montserrat, Arial, sans-serif" font-weight="900" font-size="${size}" fill="#ffffff" text-anchor="middle">${esc(l.toUpperCase())}</text>`).join('');
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg}${body}</svg>`;
}
