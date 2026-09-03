import { supabase } from '@/integrations/supabase/client';
import { SnowCapture, screenCaptureSupported } from '@/capacitor/SnowCapture';
import { isFireTV } from '@/utils/platform';

/**
 * Attachments on support tickets: a screenshot of what the customer is looking
 * at, or a short voice note, in either direction.
 *
 * Files live in the private `support-attachments` bucket under
 * `<ticket_id>/<uuid>.<ext>`. That first path segment is not cosmetic — the
 * storage policies parse it to decide whether the caller owns the ticket, so
 * the path shape is load-bearing (see the 20260903030000 migration).
 */

export const ATTACHMENT_BUCKET = 'support-attachments';
/** Matches file_size_limit on the bucket. Checked here so the failure is a
 *  sentence instead of a 413 from storage. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type AttachmentKind = 'image' | 'audio';

export interface AttachmentDraft {
  kind: AttachmentKind;
  blob: Blob;
  mime: string;
  /** Audio only, for the "0:07" label. */
  durationMs?: number;
}

export interface UploadedAttachment {
  attachment_path: string;
  attachment_kind: AttachmentKind;
  attachment_mime: string;
  attachment_bytes: number;
  attachment_ms: number | null;
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
};

const extFor = (mime: string): string => EXT[mime.split(';')[0].trim()] ?? 'bin';

/** Chrome 66 (Fire TV) has no crypto.randomUUID. */
const uuid = (): string => {
  const c = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export async function uploadAttachment(
  ticketId: string,
  draft: AttachmentDraft,
): Promise<UploadedAttachment> {
  if (draft.blob.size === 0) throw new Error('That file came back empty — please try again.');
  if (draft.blob.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('That file is too big to attach (10 MB limit).');
  }
  const path = `${ticketId}/${uuid()}.${extFor(draft.mime)}`;
  const { error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, draft.blob, { contentType: draft.mime, upsert: false });
  if (error) throw new Error(error.message || 'Could not upload that attachment.');
  return {
    attachment_path: path,
    attachment_kind: draft.kind,
    attachment_mime: draft.mime,
    attachment_bytes: draft.blob.size,
    attachment_ms: draft.kind === 'audio' ? Math.round(draft.durationMs ?? 0) : null,
  };
}

/**
 * A viewable URL for an attachment. The bucket is private, so this is a signed
 * URL that expires — long enough to read a ticket, short enough that a leaked
 * link is not a leaked screenshot.
 */
export async function attachmentUrl(path: string, expiresSeconds = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(path, expiresSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/* ── screenshots ─────────────────────────────────────────────────────────── */

export const canAttachScreenshot = (): boolean => screenCaptureSupported();

/** Capture the current screen as an attachment draft. */
export async function captureScreenshot(): Promise<AttachmentDraft> {
  const shot = await SnowCapture.captureScreen({ quality: 80, maxWidth: 1920 });
  // Chrome 66 has no fetch(dataUri) → Blob, so decode by hand.
  const bin = atob(shot.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return { kind: 'image', blob: new Blob([bytes], { type: shot.mime }), mime: shot.mime };
}

/* ── voice notes ─────────────────────────────────────────────────────────── */

/**
 * Whether this device can RECORD audio.
 *
 * Fire TV cannot, and it is not a permission problem: the Alexa remote's mic is
 * not exposed to apps at all, so getUserMedia "succeeds" and hands back a
 * silent stream. VoiceInput already learned this the hard way. Playing a voice
 * note from support works everywhere — it is only recording that needs a real
 * microphone.
 */
export function canRecordVoice(): boolean {
  if (isFireTV()) return false;
  if (typeof navigator === 'undefined') return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  return typeof MediaRecorder !== 'undefined';
}

const VOICE_MIMES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

/** Longest voice note. Support messages, not podcasts. */
export const MAX_VOICE_MS = 60_000;
/** Below this a recording is silence or a mis-tap, not a message. */
const MIN_VOICE_BYTES = 1500;

export interface VoiceRecorder {
  /** Resolves with the recording, or null if it was too short to be real. */
  stop: () => Promise<AttachmentDraft | null>;
  cancel: () => void;
}

export async function startVoiceRecording(): Promise<VoiceRecorder> {
  if (!canRecordVoice()) throw new Error('This device has no microphone available to apps.');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const mime = VOICE_MIMES.find((m) => MediaRecorder.isTypeSupported(m));
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  const startedAt = Date.now();
  recorder.start();

  const release = () => { for (const t of stream.getTracks()) t.stop(); };
  // Hard stop, so a forgotten recording cannot run until the tab dies.
  const cap = window.setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, MAX_VOICE_MS);

  return {
    stop: () =>
      new Promise<AttachmentDraft | null>((resolve) => {
        window.clearTimeout(cap);
        if (recorder.state === 'inactive') { release(); resolve(null); return; }
        recorder.onstop = () => {
          release();
          const type = recorder.mimeType || mime || 'audio/webm';
          const blob = new Blob(chunks, { type });
          // A silent stream (see canRecordVoice) still produces a tiny file.
          // Sending it would give support an empty voice note to puzzle over.
          if (blob.size < MIN_VOICE_BYTES) { resolve(null); return; }
          resolve({ kind: 'audio', blob, mime: type, durationMs: Date.now() - startedAt });
        };
        recorder.stop();
      }),
    cancel: () => {
      window.clearTimeout(cap);
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* ignore */ }
      release();
    },
  };
}
