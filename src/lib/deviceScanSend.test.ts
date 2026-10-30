// Support › Device check's text and sending: the English summary, the
// assistant message (the scan fenced as information), the ticket text and
// subject, the signed-in ticket (the Buffering Guide's createTicket path) and
// the guest report (report-channel, a real contact required).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: h.invoke } } }));
vi.mock('@/lib/appInfo', () => ({ withAppInfo: async (b: string) => `App: Snow Media Center 1.9.6 (build 99)\n\n${b}` }));

import {
  ASSISTANT_MAX, SCAN_END, SCAN_START, TICKET_MAX, assistantMessage, contactOk, scanSummary, sendDeviceScanGuest,
  sendDeviceScanTicket, ticketMessage, ticketSubject,
} from './deviceScanSend';
import { rateScan } from './deviceScanRating';
import { smcPicks } from './deviceScanPicks';
import type { CodecSupport, DeviceScan } from './deviceScan';

const GB = 1024 ** 3;
const hw: CodecSupport = { decoder: true, hardware: true, uhd: true, tenBit: true };
const SCAN: DeviceScan = {
  at: 0, source: 'native', formFactor: 'tv', model: 'AFTKA', osVersion: '11', apiLevel: 30, webview: 112,
  ramTotal: 1.9 * GB, ramFree: 0.6 * GB, ramLow: false, lowRamDevice: false, storageFree: 3 * GB, storageTotal: 8 * GB,
  cores: 4, is64bit: true, screen: { width: 3840, height: 2160, refreshHz: 60, hdr: ['hdr10'] },
  codecs: { avc: hw, hevc: hw, vp9: hw, av1: hw },
  network: { type: 'wifi', downKbps: null, vpn: false }, wifi: { band: '2.4', linkMbps: 65, rssi: -72, standard: 4 },
  speed: { downMbps: 30, upMbps: 5, pingMs: 30, jitterMs: 2, at: 0 },
};

beforeEach(() => { h.invoke.mockReset(); h.invoke.mockResolvedValue({ data: { success: true }, error: null }); });

describe('device scan send', () => {
  it('the summary is English, a line a finding, with each level', () => {
    const s = scanSummary(SCAN, rateScan(SCAN), '1.9.6 (99)');
    expect(s.split('\n')[0]).toBe('Device check — overall: ORANGE');
    expect(s).toContain('AFTKA · Android 11 (API 30) · tv · app 1.9.6 (99)');
    expect(s).toContain('- Memory: 1.9 GB [yellow]');
    expect(s).toContain('- Wi-Fi band: 2.4 GHz [orange]');
    expect(s).toContain('Worth a look: Router / Wi-Fi');
    expect(s).not.toMatch(/deviceScan\./);
  });

  it('the assistant message: the question, then the scan and picks fenced as information, under the cap', () => {
    const m = assistantMessage('Explain please', SCAN, rateScan(SCAN), smcPicks());
    expect(m.startsWith('Explain please\n\n' + SCAN_START)).toBe(true);
    expect(m.endsWith(SCAN_END)).toBe(true);
    expect(m).toContain('Suggested devices:');
    expect(m).toContain('NVIDIA Shield TV Pro');
    expect(m.length).toBeLessThanOrEqual(ASSISTANT_MAX);
    const long = assistantMessage('x'.repeat(3700), SCAN, rateScan(SCAN), smcPicks());
    expect(long.length).toBeLessThanOrEqual(ASSISTANT_MAX);
    expect(long.endsWith(SCAN_END)).toBe(true);
  });

  it('ticket text and subject', () => {
    expect(ticketMessage('  stops at night ', 'SUMMARY')).toBe('stops at night\n\nSUMMARY');
    expect(ticketMessage('', 'S')).toBe('S');
    expect(ticketMessage('n', 'x'.repeat(3000)).length).toBe(TICKET_MAX);
    expect(ticketSubject(SCAN, rateScan(SCAN))).toBe('[Device Check] AFTKA — ORANGE');
  });

  it('signed in: createTicket with the app lines in front; a failure says so', async () => {
    const createTicket = vi.fn(async () => 't1');
    expect(await sendDeviceScanTicket(createTicket, 'Subj', 'Body')).toEqual({ ok: true, ticket: true });
    expect(createTicket).toHaveBeenCalledWith('Subj', 'App: Snow Media Center 1.9.6 (build 99)\n\nBody');
    expect(await sendDeviceScanTicket(async () => { throw new Error('User not authenticated'); }, 'S', 'B')).toEqual({ ok: false, reason: 'sign_in_required' });
    expect(await sendDeviceScanTicket(async () => { throw new Error('db'); }, 'S', 'B')).toEqual({ ok: false, reason: 'failed' });
  });

  it('a real contact: an email or a phone with 7+ digits, not any word', () => {
    expect(contactOk('me@example.com')).toBe(true);
    expect(contactOk('+1 (555) 123-4567')).toBe(true);
    expect(contactOk('call me')).toBe(false);
    expect(contactOk('12345')).toBe(false);
    expect(contactOk('me@home')).toBe(false);
    expect(contactOk('  ')).toBe(false);
  });

  it('signed out: report-channel as a guest ticket, with the name and contact; nothing sent without them', async () => {
    expect(await sendDeviceScanGuest('', 'me@example.com', 'S', 'B')).toEqual({ ok: false, reason: 'name_required' });
    expect(await sendDeviceScanGuest('Ann', 'soon', 'S', 'B')).toEqual({ ok: false, reason: 'contact_required' });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(await sendDeviceScanGuest('Ann\nLee', 'me@example.com', '[Device Check] AFTKA — ORANGE', 'SUMMARY')).toEqual({ ok: true, ticket: false });
    const [fn, opts] = h.invoke.mock.calls[0] as [string, { body: { subject: string; message: string } }];
    expect(fn).toBe('report-channel');
    expect(opts.body.subject).toBe('[Guest Ticket] [Device Check] AFTKA — ORANGE');
    expect(opts.body.message).toContain('Name: Ann Lee\nContact: me@example.com');
    expect(opts.body.message).toContain('SUMMARY');
    expect(opts.body.message.startsWith('App: Snow Media Center')).toBe(true);
    h.invoke.mockResolvedValue({ data: null, error: { context: { status: 429 } } });
    expect(await sendDeviceScanGuest('Ann', '5551234567', 'S', 'B')).toEqual({ ok: false, reason: 'rate_limited' });
    h.invoke.mockRejectedValue(new Error('offline'));
    expect(await sendDeviceScanGuest('Ann', '5551234567', 'S', 'B')).toEqual({ ok: false, reason: 'failed' });
  });
});
