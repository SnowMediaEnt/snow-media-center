import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  canAttachScreenshot, canRecordVoice, captureScreenshot,
  startVoiceRecording, uploadAttachment, MAX_VOICE_MS,
  type AttachmentDraft, type UploadedAttachment, type VoiceRecorder,
} from '@/lib/supportAttachments';

/**
 * Holds the one pending attachment while a reply is being composed, so the
 * screenshot/voice buttons and the Send button can be wired up in a few lines
 * wherever a ticket is answered.
 *
 * The draft is uploaded on send, not on capture: a customer who takes a
 * screenshot and then changes their mind should not have left a file behind.
 */
export function useAttachmentComposer() {
  const { toast } = useToast();
  const [draft, setDraft] = useState<AttachmentDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [recordingMs, setRecordingMs] = useState<number | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const tickRef = useRef<number | null>(null);

  const stopTick = () => { if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; } };
  useEffect(() => () => { stopTick(); recorderRef.current?.cancel(); }, []);

  const takeScreenshot = useCallback(async () => {
    setBusy(true);
    try {
      setDraft(await captureScreenshot());
      toast({
        title: 'Screenshot attached',
        description: 'Video does not appear in a screenshot — menus and errors do.',
      });
    } catch (e) {
      toast({ title: 'Could not take a screenshot', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const startRecording = useCallback(async () => {
    try {
      recorderRef.current = await startVoiceRecording();
      const startedAt = Date.now();
      setRecordingMs(0);
      tickRef.current = window.setInterval(() => setRecordingMs(Date.now() - startedAt), 250);
    } catch (e) {
      toast({ title: 'Cannot record here', description: (e as Error).message, variant: 'destructive' });
    }
  }, [toast]);

  const stopRecording = useCallback(async () => {
    stopTick();
    setRecordingMs(null);
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (!rec) return;
    const result = await rec.stop();
    if (!result) {
      // Either a mis-tap or a device whose mic hands back silence.
      toast({
        title: 'Nothing was recorded',
        description: 'Hold the button while you speak, then release.',
        variant: 'destructive',
      });
      return;
    }
    setDraft(result);
  }, [toast]);

  const cancelRecording = useCallback(() => {
    stopTick();
    setRecordingMs(null);
    recorderRef.current?.cancel();
    recorderRef.current = null;
  }, []);

  /** Uploads the pending draft and returns the row fields to store with it. */
  const commit = useCallback(async (ticketId: string): Promise<UploadedAttachment | null> => {
    if (!draft) return null;
    setBusy(true);
    try {
      const uploaded = await uploadAttachment(ticketId, draft);
      setDraft(null);
      return uploaded;
    } finally {
      setBusy(false);
    }
  }, [draft]);

  return {
    draft,
    clearDraft: () => setDraft(null),
    busy,
    recordingMs,
    maxRecordingMs: MAX_VOICE_MS,
    canScreenshot: canAttachScreenshot(),
    canRecord: canRecordVoice(),
    takeScreenshot,
    startRecording,
    stopRecording,
    cancelRecording,
    commit,
  };
}
