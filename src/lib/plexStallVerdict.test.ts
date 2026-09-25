import { describe, expect, it } from 'vitest';
import { classify, type ClassifyInput, type DiagSnapshot } from './bufferDiagnostics';
import { autoDropPreset, connectionDropped, explainPlexStall, presetFor } from './plexStallVerdict';

const snap = (o: Partial<DiagSnapshot>): DiagSnapshot => ({
  verdict: 'unknown', headline: 'Buffering…', detail: '', streamKbps: null, streamEarlyKbps: null,
  probeKbps: null, probeMs: null, probeFailed: false, nowKbps: null, hostKbps: null, hostMs: null, bufferingForMs: 3000, online: true, updatedAt: 0, ...o,
});
// A snapshot carrying the general verdict for these numbers, as the
// diagnostics module builds it.
const general = (o: Partial<ClassifyInput>): DiagSnapshot => {
  const input: ClassifyInput = {
    buffering: true, online: true, neutralFailStreak: 0, probeKbps: null, hostMs: null, hostKbps: null, recentKbps: null, earlyKbps: null, ...o,
  };
  return snap({ ...classify(input), probeKbps: input.probeKbps, online: input.online, hostMs: input.hostMs, hostKbps: input.hostKbps, streamKbps: input.recentKbps, streamEarlyKbps: input.earlyKbps });
};

describe('explainPlexStall', () => {
  it('blames the relay first', () => {
    expect(explainPlexStall(snap({ probeKbps: 90000 }), { transcoding: false, route: 'relay' })?.headline).toMatch(/Relay/);
  });
  it('on the relay, suggests the relay-sized preset (not 720p · 3 Mbps)', () => {
    const r = explainPlexStall(snap({ probeKbps: 90000 }), { transcoding: false, fileKbps: 10000, route: 'relay' });
    expect(r?.detail).toMatch(/Pick 480p · 2 Mbps in the player menu/);
    expect(r?.detail).not.toMatch(/720p/);
    // Automatic quality on: it says what it will do instead.
    const auto = explainPlexStall(snap({ probeKbps: 90000 }), { transcoding: false, fileKbps: 10000, route: 'relay', autoNext: '480p · 2 Mbps' });
    expect(auto?.detail).toMatch(/Lowering to 480p · 2 Mbps automatically/);
    expect(auto?.autoSaid).toBe(true);
    // Already there: nothing to pick.
    const at = explainPlexStall(snap({ probeKbps: 90000 }), { transcoding: true, fileKbps: 10000, targetKbps: 2000, route: 'relay' });
    expect(at?.detail).not.toMatch(/Pick/);
  });
  it('blames the internet when it is slower than the file, naming the quick check', () => {
    const r = explainPlexStall(snap({ probeKbps: 12000 }), { transcoding: false, fileKbps: 40000, route: 'direct' });
    expect(r?.verdict).toBe('internet');
    expect(r?.headline).toMatch(/Quick internet check: 12\.0 Mb\/s/);
    expect(r?.detail).toMatch(/Pick 1080p · 8 Mbps in the player menu/);
    expect(r?.autoSaid).toBe(false);
  });
  it('with automatic quality on, says it is lowering instead of "pick X"', () => {
    const r = explainPlexStall(snap({ probeKbps: 12000 }), { transcoding: false, fileKbps: 40000, route: 'direct', autoNext: '1080p · 8 Mbps' });
    expect(r?.detail).toMatch(/Lowering to 1080p · 8 Mbps automatically if it keeps stalling/);
    expect(r?.detail).not.toMatch(/Pick/);
    expect(r?.autoSaid).toBe(true);
  });
  it('says it lowers in a few seconds when the early drop is due, else if it keeps stalling', () => {
    const ctx = { transcoding: false, fileKbps: 20000, route: 'direct' as const, serverKbps: 9000, autoNext: '720p · 4 Mbps' };
    const soon = explainPlexStall(snap({ probeKbps: null }), { ...ctx, autoSoon: true });
    expect(soon?.detail).toMatch(/Lowering to 720p · 4 Mbps in a few seconds\.$/);
    expect(soon?.detail).not.toMatch(/keeps stalling/);
    expect(soon?.autoSaid).toBe(true);
    const later = explainPlexStall(snap({ probeKbps: null }), ctx);
    expect(later?.detail).toMatch(/Lowering to 720p · 4 Mbps automatically if it keeps stalling\.$/);
    expect(later?.detail).not.toMatch(/few seconds/);
    // The internet fine: the server's upload is named, and the same timing.
    const fast = explainPlexStall(snap({ probeKbps: 200000 }), { ...ctx, autoSoon: true });
    expect(fast?.headline).toMatch(/can't send this fast enough/);
    expect(fast?.detail).toMatch(/Lowering to 720p · 4 Mbps in a few seconds\.$/);
  });
  it('a low quick check is not the story when the player gets enough from the server', () => {
    const r = explainPlexStall(snap({ probeKbps: 12000 }), { transcoding: false, fileKbps: 40000, route: 'direct', serverKbps: 60000 });
    expect(r?.verdict).not.toBe('internet');
  });
  it('blames the server only on proof: what it sent flat out in the stall', () => {
    const r = explainPlexStall(snap({ probeKbps: 200000 }), { transcoding: false, fileKbps: 30000, route: 'direct', serverKbps: 6000 });
    expect(r?.verdict).toBe('server');
    expect(r?.headline).toMatch(/can't send this fast enough/);
    expect(r?.detail).toMatch(/6\.0 Mb\/s/);
    expect(r?.detail).toMatch(/Pick 720p · 4 Mbps in the player menu/);
  });
  it('a quick probe of the server or the rate right now is not proof: no culprit, no preset', () => {
    // The owner's case: internet quick check 317.8, now 0.5, needs 23.7.
    const owner = snap({ verdict: 'server', headline: 'The stream server is struggling', detail: 'x', probeKbps: 317800, nowKbps: 500, hostKbps: 900, hostMs: 1800 });
    const r = explainPlexStall(owner, { transcoding: false, fileKbps: 23700, route: 'direct' });
    expect(r?.verdict).not.toBe('server');
    expect(r?.headline).not.toMatch(/server can't|too slow/);
    expect(r?.detail).not.toMatch(/Pick|Lowering/);
    expect(r?.detail).toMatch(/Your internet is fine \(quick check: 317\.8 Mb\/s\)/);
    // Even with automatic quality able to lower, it does not say it will.
    const auto = explainPlexStall(owner, { transcoding: false, fileKbps: 23700, route: 'direct', autoNext: '1080p · 12 Mbps' });
    expect(auto?.detail).not.toMatch(/Pick|Lowering/);
  });
  it('nothing arriving from the server is said plainly, never as a speed', () => {
    const r = explainPlexStall(snap({ probeKbps: 317800, nowKbps: 0 }), { transcoding: false, fileKbps: 23700, route: 'direct', quietMs: 7400, autoNext: '1080p · 12 Mbps' });
    expect(r?.headline).toBe('Waiting for the Plex server to answer');
    expect(r?.detail).toBe('No data from the server for 7 s.');
    expect(r?.verdict).toBe('unknown');
    expect(r?.autoSaid).toBeFalsy();
    // A moment of nothing (under 2 s) is not yet worth saying.
    expect(explainPlexStall(snap({ probeKbps: 317800 }), { transcoding: false, fileKbps: 23700, route: 'direct', quietMs: 1000 })?.headline).not.toMatch(/Waiting/);
  });
  it('a connection that dropped says so, ahead of the server going quiet', () => {
    // Android TV: navigator.onLine stays true; the internet check failed twice.
    const down = general({ online: true, neutralFailStreak: 2, probeKbps: 317800 });
    expect(connectionDropped(down)).toBe(true);
    const r = explainPlexStall(down, { transcoding: false, fileKbps: 23700, route: 'direct', quietMs: 25000, autoNext: '1080p · 12 Mbps' });
    expect(r?.headline).toBe('Your internet connection dropped');
    expect(r?.verdict).toBe('internet');
    // Flagged: the 317.8 is from before the drop.
    expect(r?.dropped).toBe(true);
    expect(r?.detail).not.toMatch(/317\.8|Lowering|Pick/);
    // Offline too, and on the relay.
    const offline = general({ online: false, probeKbps: 317800 });
    expect(explainPlexStall(offline, { transcoding: false, fileKbps: 23700, route: 'relay', quietMs: 25000 })).toMatchObject({ headline: 'Your internet connection dropped', dropped: true });
  });
  it('a slow internet check is not a dropped connection', () => {
    const slow = general({ probeKbps: 2100 });
    expect(slow.verdict).toBe('internet');
    expect(connectionDropped(slow)).toBe(false);
    expect(explainPlexStall(slow, { transcoding: false, fileKbps: 8000, route: 'direct' })?.dropped).toBeUndefined();
    // One failed check is not a drop either.
    expect(connectionDropped(general({ neutralFailStreak: 1, probeKbps: 317800 }))).toBe(false);
  });
  it('a server sending enough flat out is not blamed: a hiccup', () => {
    const r = explainPlexStall(snap({ probeKbps: 317800 }), { transcoding: false, fileKbps: 23700, route: 'direct', serverKbps: 84000 });
    expect(r?.verdict).toBe('unknown');
    expect(r?.detail).toMatch(/sending 84\.0 Mb\/s, enough/);
    expect(r?.detail).not.toMatch(/Pick/);
  });
  it('short on proof, internet not known to be fine: the connection, not the server', () => {
    const r = explainPlexStall(snap({ probeKbps: null }), { transcoding: false, fileKbps: 20000, route: 'direct', serverKbps: 9000 });
    expect(r?.headline).toBe('The Plex server connection is too slow for this video');
    expect(r?.detail).toMatch(/Pick 720p · 4 Mbps in the player menu/);
  });
  it('"ISP throttling" from quick samples of the stream, the internet fine and no proof: no culprit', () => {
    const throttled = general({ probeKbps: 90000, recentKbps: 2000, earlyKbps: 9000 });
    expect(throttled.verdict).toBe('throttling');
    const r = explainPlexStall(throttled, { transcoding: false, fileKbps: 8000, route: 'direct' });
    expect(r).toEqual({ verdict: 'unknown', headline: 'Buffering…', detail: 'Your internet is fine (quick check: 90.0 Mb/s). This video needs about 8.0 Mb/s.' });
    expect(r?.detail).not.toMatch(/ISP|VPN|Pick|Lowering/);
  });
  it('ISP throttling stands when the internet check is not plainly fine', () => {
    // What the video needs is not known...
    expect(explainPlexStall(general({ probeKbps: 90000, recentKbps: 2000, earlyKbps: 9000 }), { transcoding: false })).toBeNull();
    // ...or the check is only just above it.
    expect(explainPlexStall(general({ probeKbps: 17000, recentKbps: 2000, earlyKbps: 9000 }), { transcoding: false, fileKbps: 14000, route: 'direct' })).toBeNull();
  });
  it('says nothing when playing normally', () => {
    expect(explainPlexStall(snap({ verdict: 'ok' }), { transcoding: false, fileKbps: 8000 })).toBeNull();
  });
});

describe('presetFor', () => {
  it('fits the speed with headroom', () => {
    expect(presetFor(12000)).toBe('1080p · 8 Mbps');
    expect(presetFor(5000)).toBe('720p · 3 Mbps');
    expect(presetFor(500)).toBe('480p · 2 Mbps');
  });
});

describe('autoDropPreset', () => {
  it("drops a 1080p remux to what the player gets from the server", () => {
    expect(autoDropPreset(35000, { serverKbps: 11000 })?.key).toBe('1080-8');
  });
  it('never on no number at all (it used to assume half the file)', () => {
    expect(autoDropPreset(35000, {})).toBeNull();
    expect(autoDropPreset(35000, { serverKbps: null })).toBeNull();
  });
  it('not when the server sends at least as fast as the file plays', () => {
    expect(autoDropPreset(35000, { serverKbps: 36000 })).toBeNull();
    // A shade under: it can never keep up.
    expect(autoDropPreset(35000, { serverKbps: 33000 })?.key).toBe('1080-20');
  });
  it('leaves small files and unknown sizes alone', () => {
    expect(autoDropPreset(6000, { serverKbps: 20000 })).toBeNull();
    expect(autoDropPreset(undefined, { serverKbps: 2000 })).toBeNull();
  });
});
