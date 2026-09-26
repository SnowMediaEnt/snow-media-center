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

## Tried
(nothing yet)
