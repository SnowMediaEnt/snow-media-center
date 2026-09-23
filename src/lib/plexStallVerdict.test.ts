import { describe, expect, it } from 'vitest';
import type { DiagSnapshot } from './bufferDiagnostics';
import { explainPlexStall, presetFor } from './plexStallVerdict';

const snap = (o: Partial<DiagSnapshot>): DiagSnapshot => ({
  verdict: 'unknown', headline: 'Buffering…', detail: '', streamKbps: null, streamEarlyKbps: null,
  probeKbps: null, probeMs: null, hostKbps: null, hostMs: null, bufferingForMs: 3000, online: true, updatedAt: 0, ...o,
});

describe('explainPlexStall', () => {
  it('blames the relay first', () => {
    expect(explainPlexStall(snap({ probeKbps: 90000 }), { transcoding: false, route: 'relay' })?.headline).toMatch(/Relay/);
  });
  it('blames the internet when it is slower than the file', () => {
    const r = explainPlexStall(snap({ probeKbps: 12000 }), { transcoding: false, fileKbps: 40000, route: 'direct' });
    expect(r?.verdict).toBe('internet');
    expect(r?.detail).toMatch(/1080p · 8 Mbps/);
  });
  it('blames the server when the internet is fine but the stream is not', () => {
    const r = explainPlexStall(snap({ probeKbps: 200000, hostKbps: 6000 }), { transcoding: false, fileKbps: 30000, route: 'direct' });
    expect(r?.verdict).toBe('server');
    expect(r?.headline).toMatch(/send/);
  });
  it('leaves ISP throttling alone', () => {
    expect(explainPlexStall(snap({ verdict: 'throttling', probeKbps: 90000, streamKbps: 2000 }), { transcoding: false, fileKbps: 8000 })).toBeNull();
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
