// Sending an app review: stars, an optional comment, an optional voice note.
//
// Rows go to public.app_reviews (migration *_app_reviews.sql); the voice note
// to the private `review-audio` bucket under '<user_id>/<review_id>.<ext>'.
// The first path segment is the owner: the storage policy checks it, and so
// does review-transcribe before it touches the file. After a voice review is
// saved the box asks review-transcribe to turn it into text; that runs on the
// server with the server's own speech-to-text key, and the box does not wait
// for it.
//
// Analytics get the rating and whether there was text or voice. Never the
// text itself.
import { supabase } from '@/integrations/supabase/client';
import i18n, { getAppLanguage } from '@/i18n';
import { trackEvent } from '@/lib/analytics';
import { parseDeviceInfo, parseFormFactor } from '@/lib/appInfo';
import { loadVersion } from '@/hooks/useVersion';
import { extFor, MAX_ATTACHMENT_BYTES, type AttachmentDraft } from '@/lib/supportAttachments';
import { foregroundHours, markReviewSubmitted } from '@/lib/reviewPrompt';

export const REVIEW_AUDIO_BUCKET = 'review-audio';
/** Matches the column check. */
export const MAX_REVIEW_COMMENT = 2000;

export type ReviewSource = 'prompt' | 'settings';

export interface ReviewInput {
  rating: number;
  comment?: string;
  voice?: AttachmentDraft | null;
  source: ReviewSource;
}

/** A v4 UUID. Chrome 66 (Fire TV) has getRandomValues but no randomUUID. */
export function reviewUuid(): string {
  const c = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => (x < 16 ? '0' : '') + x.toString(16)).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const VERSION_WAIT_MS = 2500;

async function appVersion(): Promise<{ version: string | null; build: number | null }> {
  try {
    const v = await Promise.race([
      loadVersion(),
      new Promise<null>((resolve) => { setTimeout(() => resolve(null), VERSION_WAIT_MS); }),
    ]);
    if (!v) return { version: null, build: null };
    const build = Number(v.versionCode) || 0;
    return { version: v.version ? String(v.version).slice(0, 32) : null, build: build > 0 ? build : null };
  } catch {
    return { version: null, build: null };
  }
}

/**
 * Sends a review. Throws a sentence the screen can show when it fails; on
 * success this box is never asked again.
 */
export async function submitReview(input: ReviewInput): Promise<{ id: string }> {
  const rating = Math.round(input.rating);
  if (!(rating >= 1 && rating <= 5)) throw new Error(i18n.t('review.errors.noStars'));

  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) throw new Error(i18n.t('review.errors.signIn'));

  const id = reviewUuid();
  const comment = (input.comment ?? '').trim().slice(0, MAX_REVIEW_COMMENT);
  const voice = input.voice && input.voice.kind === 'audio' ? input.voice : null;

  let audioPath: string | null = null;
  let audioMs: number | null = null;
  if (voice) {
    if (voice.blob.size === 0) throw new Error(i18n.t('review.errors.voiceEmpty'));
    if (voice.blob.size > MAX_ATTACHMENT_BYTES) throw new Error(i18n.t('review.errors.voiceTooBig'));
    const path = `${user.id}/${id}.${extFor(voice.mime)}`;
    const { error } = await supabase.storage
      .from(REVIEW_AUDIO_BUCKET)
      .upload(path, voice.blob, { contentType: voice.mime, upsert: false });
    if (error) throw new Error(i18n.t('review.errors.voiceUpload'));
    audioPath = path;
    audioMs = Math.max(0, Math.round(voice.durationMs ?? 0));
  }

  const { version, build } = await appVersion();
  let deviceModel: string | null = null;
  try { deviceModel = parseDeviceInfo().model?.slice(0, 64) ?? null; } catch { /* optional */ }

  const { error } = await supabase.from('app_reviews').insert({
    id,
    user_id: user.id,
    rating,
    comment: comment || null,
    audio_path: audioPath,
    audio_ms: audioMs,
    app_version: version,
    build,
    device_model: deviceModel,
    form_factor: parseFormFactor(),
    language: getAppLanguage(),
    hours_used: foregroundHours(),
  });
  if (error) {
    // The note is no use without its row; the policy lets the owner insert
    // but not delete, so it stays for an admin to clear. Nothing to log.
    throw new Error(i18n.t('review.errors.sendFailed'));
  }

  markReviewSubmitted();
  try {
    trackEvent('review_submitted', 'review', { rating, has_text: comment.length > 0, has_voice: !!audioPath, source: input.source });
  } catch { /* analytics never blocks */ }

  if (audioPath) {
    // Fire and forget: the thank-you does not wait for the transcript.
    void supabase.functions.invoke('review-transcribe', { body: { review_id: id } }).catch(() => { /* the Hub shows the audio either way */ });
  }
  return { id };
}
