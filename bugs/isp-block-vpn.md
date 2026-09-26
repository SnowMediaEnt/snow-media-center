# Some ISPs block Live TV; with a VPN on, Plex stops working

## What's broken
On some internet providers the Live TV channel list never loads unless a VPN is on. With the VPN on,
Live TV works, but Plex in SMC doesn't. (Earlier, build 39: with a VPN the official Plex app still played
while SMC's Plex barely loaded: Now 1.3 Mb/s, "Internet 12.6 Mb/s".)

## How the owner reproduces it
Without a VPN on the affected ISP: Live TV categories/channel list never load, but Game Day shows its
games and its channels PLAY fine. So the provider's streams get through; only the channel-list requests
(player_api.php, sent natively via CapacitorHttp from src/lib/xtream.ts httpGetJson) are blocked. Game Day's
channel list may come from a cache kept from when the VPN was on (gameDay.ts uses getLiveStreams).
Not yet known: whether a DNS change (1.1.1.1) alone fixes it; what Plex shows with the VPN on.

## Leads
- ISP blocks of IPTV panels are very often DNS-based (the ISP's DNS won't resolve the panel's domain).
  If so, SMC could resolve the panel's address itself (DNS over HTTPS) and no VPN would be needed.
  Test on the box: set the Wi-Fi DNS to 1.1.1.1 / 8.8.8.8 (or Private DNS dns.google) with no VPN.
- Plex over a VPN: the server may refuse or throttle VPN addresses, the direct path may fail and leave
  only Plex's relay (capped ~1-2 Mb/s), or the VPN's DNS may not resolve *.plex.direct names.

## Owner decision
Fix it for a 1.8 release, tested on the device first. Channels themselves play without a VPN (content bar
Live TV channels play fine); only the channel list doesn't appear.
Plan (rung 2): when the box's direct player_api.php request is blocked, fetch the list JSON through a new
Snow Media edge function (allowed provider hosts only, like player-login's ALLOWED_HOSTS); streams stay direct.

## Tried
(nothing yet)

## Rung 2 (fixer-2): list reads through Snow Media when the direct path is blocked
Status: built, NOT yet device-tested. **The edge function `xtream-list-proxy` must be deployed (via
Lovable) before the device test**; until it is, the app behaves exactly as before (the fallback fails
quietly and the original error stands).

Root cause (as far as can be told off-device): the ISP filters the box's player_api.php requests to the
panel, not the panel's hostname: live streams on the SAME host (`/live/<user>/<pass>/<id>.ts`) play without
a VPN, so this is not a DNS block (so the DNS-over-HTTPS lead is unlikely to help). Most likely URL/DPI
filtering of `player_api.php` (Dreamstreams is plain http on :8080).

Design:
- `supabase/functions/xtream-list-proxy/index.ts` (verify_jwt = false in supabase/config.toml, like
  player-login, which the Player calls the same way and which works before any Snow Media sign-in).
  POST `{ host, username, password, action?, params? }`. Relays only GET player_api.php reads to hosts in
  player-login's ALLOWED_HOSTS (copied, with a test that fails if the two lists differ; player-login stays a
  single pasteable file). Only SMC's read actions (account info with no action, get_live_categories,
  get_live_streams, get_vod_categories, get_vod_streams, get_series_categories, get_series, get_series_info,
  get_vod_info, get_short_epg), each with its own fixed params; values `[A-Za-z0-9_.-]{1,64}`. Redirects are
  followed by hand, only to another allowed host. 40 s timeout, 48 MB cap, Dalvik user agent (what the app's
  own HTTP sends). Panel 2xx JSON is returned unchanged with its status; any other panel status comes back as
  HTTP 200 `{ ok:false, reason:'panel_status', status }` so a gateway error (e.g. not deployed) is never
  mistaken for the panel's own 401/429; refusals are `{ ok:false, reason }` (host_not_allowed,
  action_not_allowed, bad_params, not_json, too_large, panel_unreachable, panel_timeout, ...). Never logs
  username, password or any panel URL. No secrets or env needed.
- `src/lib/xtreamListProxy.ts` + `httpGetJson` in `src/lib/xtream.ts`: on the box (native only), the direct
  CapacitorHttp request runs first, unchanged. If it fails in a blocked-looking way (no answer: network
  error, timeout, reset, DNS/TLS failure; HTTP 403/451; a non-JSON 200) the same read is repeated through the
  proxy. 401, 429 and other statuses are real answers and are not proxied. When the proxy delivers, the line
  (panel host) is remembered as blocked for the session, and in localStorage for 30 min after last use, so
  later reads go to the proxy first; if the proxy then fails, direct is tried and a direct success forgets
  the block. Demo mode throws before either path; web browsers never use it. Streams are not proxied.
- Live TV's buffering card shows "Channel list: through Snow Media (your internet blocks the provider)"
  when the playing line's lists come that way.

Risk to watch: all blocked-ISP boxes now reach the panel from Supabase's few egress addresses; if the panel
rate-limits or blocks those, the proxy answers `panel_status` 429/403 and the list still fails.
