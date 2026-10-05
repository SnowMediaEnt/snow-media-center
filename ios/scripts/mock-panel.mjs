// Tiny Xtream-compatible test panel for trying Live TV / VOD in the iOS
// simulator without a real line. Built from the Showcase demo line-up
// (public-domain / CC sources; ~/Developer/smc-showcase/demo). Run:
//   node ios/scripts/mock-panel.mjs      (http://127.0.0.1:47812, test / test)
// The sign-in form has no server field, so seed the login into the simulator:
//   xcrun simctl spawn <sim> defaults write com.snowmedia.smc \
//     CapacitorStorage.snow-livetv-creds-v1 -string \
//     '{"host":"http://127.0.0.1:47812","username":"test","password":"test","output":"m3u8"}'
import http from 'node:http';
import fs from 'node:fs';
const D = '/Users/jperezro/Developer/smc-showcase/demo';
const lineup = JSON.parse(fs.readFileSync(`${D}/lineup.json`, 'utf8'));
const cat = JSON.parse(fs.readFileSync(`${D}/catalog.json`, 'utf8'));
const src = Object.fromEntries(cat.liveSources.map(s => [s.id, s.url]));
const PORT = 47812, U = 'test', P = 'test';
const vodCats = [...new Set(cat.movies.map(m => m.category))];
const serCats = [...new Set(cat.series.map(s => s.category))];
const now = () => Math.floor(Date.now() / 1000);
const api = (a, q) => {
  switch (a) {
    case undefined: case '': return {
      user_info: { username: U, password: P, auth: 1, status: 'Active', exp_date: String(now() + 365 * 86400), is_trial: '0', active_cons: '0', created_at: String(now() - 86400), max_connections: '2', allowed_output_formats: ['m3u8', 'ts'] },
      server_info: { url: '127.0.0.1', port: String(PORT), https_port: '', server_protocol: 'http', rtmp_port: '', timezone: 'UTC', timestamp_now: now(), time_now: new Date().toISOString().slice(0, 19).replace('T', ' ') },
    };
    case 'get_live_categories': return lineup.categories.map(c => ({ category_id: String(c.id), category_name: c.name, parent_id: 0 }));
    case 'get_live_streams': return lineup.channels.filter(c => !q.get('category_id') || String(c.category) === q.get('category_id')).map(c => ({ num: c.num, name: c.name, stream_type: 'live', stream_id: c.id, stream_icon: '', epg_channel_id: `ch${c.id}`, added: '0', category_id: String(c.category), custom_sid: '', tv_archive: 0, direct_source: '', tv_archive_duration: 0 }));
    case 'get_vod_categories': return vodCats.map((n, i) => ({ category_id: String(100 + i), category_name: n, parent_id: 0 }));
    case 'get_vod_streams': return cat.movies.map(m => ({ num: m.id, name: m.title, stream_type: 'movie', stream_id: m.id, stream_icon: m.poster, rating: String(m.rating), rating_5based: m.rating / 2, added: String(now() - 86400), category_id: String(100 + vodCats.indexOf(m.category)), container_extension: m.ext || 'mp4', custom_sid: '', direct_source: '' })).filter(m => !q.get('category_id') || m.category_id === q.get('category_id'));
    case 'get_vod_info': { const m = cat.movies.find(x => String(x.id) === q.get('vod_id')) || cat.movies[0]; return { info: { movie_image: m.poster, backdrop_path: [m.backdrop], plot: m.plot, cast: m.cast, director: m.director, genre: m.genre, releasedate: String(m.year), rating: String(m.rating), duration_secs: m.durationSecs, duration: '' }, movie_data: { stream_id: m.id, name: m.title, added: '0', category_id: String(100 + vodCats.indexOf(m.category)), container_extension: m.ext || 'mp4' } }; }
    case 'get_series_categories': return serCats.map((n, i) => ({ category_id: String(200 + i), category_name: n, parent_id: 0 }));
    case 'get_series': return cat.series.map(s => ({ num: s.id, name: s.title, series_id: s.id, cover: s.poster, plot: s.plot, cast: s.cast, director: s.director, genre: s.genre, releaseDate: String(s.year), rating: String(s.rating), category_id: String(200 + serCats.indexOf(s.category)), backdrop_path: [s.backdrop] }));
    case 'get_series_info': { const s = cat.series.find(x => String(x.id) === q.get('series_id')) || cat.series[0]; const episodes = {}; const seasons = [];
      (s.seasons || []).forEach((se, si) => { const n = se.season ?? si + 1; seasons.push({ season_number: n, name: `Season ${n}` }); episodes[n] = (se.episodes || []).map((e, ei) => ({ id: String(e.id ?? s.id * 100 + ei), episode_num: ei + 1, title: e.title || `Episode ${ei + 1}`, container_extension: e.ext || 'mp4', info: { plot: e.plot || '', duration_secs: e.durationSecs || 0 }, season: n })); });
      return { seasons, info: { name: s.title, cover: s.poster, plot: s.plot, genre: s.genre, backdrop_path: [s.backdrop] }, episodes }; }
    case 'get_short_epg': return { epg_listings: [] };
    default: return [];
  }
};
const movieUrl = id => cat.movies.find(m => String(m.id) === id)?.url;
const epUrl = id => { for (const s of cat.series) for (const se of s.seasons || []) for (const [ei, e] of (se.episodes || []).entries()) if (String(e.id ?? s.id * 100 + ei) === id) return e.url; };
http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (u.pathname === '/player_api.php') {
    const ok = u.searchParams.get('username') === U && u.searchParams.get('password') === P;
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify(ok ? api(u.searchParams.get('action') ?? undefined, u.searchParams) : { user_info: { auth: 0 } }));
  }
  const m = u.pathname.match(/^\/(live|movie|series)\/[^/]+\/[^/]+\/(\d+)\.\w+$/);
  if (m) {
    const id = m[2];
    const to = m[1] === 'live' ? src[lineup.channels.find(c => String(c.id) === id)?.source] : m[1] === 'movie' ? movieUrl(id) : epUrl(id);
    if (to) { res.writeHead(302, { location: to }); return res.end(); }
  }
  res.writeHead(404); res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`mock panel on http://127.0.0.1:${PORT} (user test / pass test)`));
