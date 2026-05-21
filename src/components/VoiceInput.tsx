import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Volume2 } from 'lucide-react';

import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { AppManager } from '@/capacitor/AppManager';
import { isNativePlatform } from '@/utils/platform';

export type VoiceState =
  | 'idle'
  | 'requesting_permission'
  | 'listening'
  | 'processing_transcription'
  | 'sending_to_ai'
  | 'speaking'
  | 'error'
  | 'cancelled';

export interface VoiceLifecycleControls {
  setVoiceState: (state: VoiceState) => void;
  restoreFocus: () => void;
  cleanupAudio: () => void;
}

type VoiceErrorSource = 'native' | 'fallback' | 'browser';

interface VoiceInputProps {
  onTranscription: (text: string, controls: VoiceLifecycleControls) => void | Promise<void>;
  onRecordingStart?: () => void;
  onVoiceStateChange?: (state: VoiceState) => void;
  onRestoreFocus?: () => void;
  disabled?: boolean;
  className?: string;
}

const ACTIVE_CAPTURE_STATES = new Set<VoiceState>([
  'requesting_permission',
  'listening',
  'processing_transcription',
]);

const NATIVE_COOLDOWN_MS = 750;
const FALLBACK_RECORDING_TIMEOUT_MS = 12000;

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error ?? '');
const getErrorCode = (error: unknown, fallback = 'VOICE_ERROR') => {
  const maybeCode = (error as { code?: unknown })?.code;
  if (typeof maybeCode === 'string' && maybeCode.trim()) return maybeCode.trim();
  const message = getErrorMessage(error);
  if (/NO_SPEECH_RECOGNIZER|speech recognizer/i.test(message)) return 'NO_SPEECH_RECOGNIZER';
  if (/VOICE_RECOGNIZER_BUSY|busy/i.test(message)) return 'VOICE_RECOGNIZER_BUSY';
  if (/VOICE_CANCELLED|cancel/i.test(message)) return 'VOICE_CANCELLED';
  if (/EMPTY_SPEECH|No speech|didn.t catch/i.test(message)) return 'EMPTY_SPEECH';
  if (/SECURITY|permission|denied|NotAllowed/i.test(message)) return 'MIC_PERMISSION_DENIED';
  if (/ActivityNotFound|not found|unavailable/i.test(message)) return 'ACTIVITY_NOT_FOUND';
  if (/NotFound|NotReadable|no.*device/i.test(message)) return 'NO_MICROPHONE_HARDWARE';
  return fallback;
};

export const VoiceInput = ({
  onTranscription,
  onRecordingStart,
  onVoiceStateChange,
  onRestoreFocus,
  disabled = false,
  className = '',
}: VoiceInputProps) => {
  const [localVoiceState, setLocalVoiceState] = useState<VoiceState>('idle');
  const voiceStateRef = useRef<VoiceState>('idle');
  const mountedRef = useRef(true);
  const nativePendingRef = useRef(false);
  const cooldownUntilRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const shouldProcessStopRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const recordingTimeoutRef = useRef<number | null>(null);
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const { toast } = useToast();

  const currentVoiceState = localVoiceState;

  const lifecycleControls: VoiceLifecycleControls = {
    setVoiceState: (state) => transitionVoiceState(state),
    restoreFocus: () => onRestoreFocus?.(),
    cleanupAudio: () => cleanupAudioSession(),
  };

  const transitionVoiceState = (next: VoiceState) => {
    const previous = voiceStateRef.current;
    if (previous === next) return;
    console.log(`VOICE_STATE: ${previous} → ${next}`);
    voiceStateRef.current = next;
    if (mountedRef.current) setLocalVoiceState(next);
    onVoiceStateChange?.(next);
  };

  const logVoiceError = (code: string, message: string, source: VoiceErrorSource, error?: unknown) => {
    console.error(`VOICE_ERROR: ${code}/${message}/${source}`, error ?? '');
  };

  const clearRecordingTimeout = () => {
    if (recordingTimeoutRef.current !== null) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  };

  const releaseWakeLock = async () => {
    if (!wakeLockRef.current) return;
    try {
      await wakeLockRef.current.release();
    } catch {
      // Wake lock was already released or unsupported.
    } finally {
      wakeLockRef.current = null;
    }
  };

  const cleanupAudioSession = (detachRecorder = true) => {
    clearRecordingTimeout();

    const recorder = mediaRecorderRef.current;
    if (recorder && detachRecorder) {
      try {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
      } catch {
        // Ignore detached recorder errors.
      }
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch { /* already stopped */ }
      }
    }

    streamRef.current?.getTracks().forEach((track) => {
      try { track.stop(); } catch { /* already stopped */ }
    });
    streamRef.current = null;
    if (detachRecorder) mediaRecorderRef.current = null;
    chunksRef.current = [];
    shouldProcessStopRef.current = false;
    void releaseWakeLock();
  };

  const finishAfterErrorOrCancel = (state: 'error' | 'cancelled') => {
    transitionVoiceState(state);
    onRestoreFocus?.();
    window.setTimeout(() => {
      if (voiceStateRef.current === state) transitionVoiceState('idle');
      onRestoreFocus?.();
    }, 300);
  };

  const showVoiceError = async (code: string, source: VoiceErrorSource, error?: unknown) => {

    const message = getErrorMessage(error);
    logVoiceError(code, message || code, source, error);

    if (code === 'MIC_PERMISSION_DENIED') {
      // No alert — just take the user straight to the App Info / Permissions screen.
      if (isNativePlatform()) {
        try {
          await AppManager.openAppSettings({ packageName: 'com.snowmedia' });
        } catch (settingsError) {
          console.warn('openAppSettings failed', settingsError);
          toast({
            title: 'Microphone permission needed',
            description: 'Open Settings → Apps → Snow Media Center → Permissions and enable Microphone.',
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: 'Microphone permission needed',
          description: 'Allow microphone access in your browser, then try Voice again.',
          variant: 'destructive',
        });
      }
    } else if (code === 'NO_MICROPHONE_HARDWARE') {
      toast({
        title: 'No microphone available',
        description: 'This device does not expose a microphone to apps.',
        variant: 'destructive',
      });
    } else if (code === 'VOICE_RECOGNIZER_BUSY') {
      toast({
        title: 'Voice is busy',
        description: 'Voice input was reset. Try again.',
        variant: 'destructive',
      });
    } else if (code === 'EMPTY_SPEECH') {
      toast({
        title: 'No speech heard',
        description: 'I didn’t catch that, try again.',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Voice input failed',
        description: message || 'Could not start listening on this device. Try again.',
        variant: 'destructive',
      });
    }

    cleanupAudioSession();
    finishAfterErrorOrCancel('error');
  };




  const cancelVoiceAttempt = (reason: 'button' | 'unmount' | 'back' | 'timeout' = 'button') => {
    console.log(`VOICE_CANCEL: ${reason}`);
    cancelRequestedRef.current = true;

    if (nativePendingRef.current && isNativePlatform()) {
      void AppManager.cancelVoiceInput().catch((error) => {
        console.warn('cancelVoiceInput failed', error);
      });
      nativePendingRef.current = false;
    }

    cleanupAudioSession();
    finishAfterErrorOrCancel('cancelled');
  };

  const processAudio = async (audioBlob: Blob) => {
    transitionVoiceState('processing_transcription');
    try {
      if (cancelRequestedRef.current) return;
      console.log('VOICE_FALLBACK_STT_START');
      const arrayBuffer = await audioBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64Audio = btoa(binary);

      const { data, error } = await supabase.functions.invoke('elevenlabs-stt', {
        body: { audio: base64Audio, mimeType: 'audio/webm' },
      });
      console.log('VOICE_FALLBACK_STT_END');

      if (error) throw error;
      if (cancelRequestedRef.current) return;

      const text = (data as { text?: string })?.text?.trim();
      if (!text) {
        await showVoiceError('EMPTY_SPEECH', 'fallback', new Error('I didn’t catch that, try again'));
        return;
      }

      cleanupAudioSession();
      await onTranscription(text, lifecycleControls);
      if (voiceStateRef.current === 'processing_transcription') {
        transitionVoiceState('idle');
        onRestoreFocus?.();
      }
    } catch (error) {
      await showVoiceError(getErrorCode(error), 'fallback', error);
    } finally {
      cleanupAudioSession();
      cancelRequestedRef.current = false;
    }
  };

  const stopFallbackRecording = (reason: 'button' | 'timeout' = 'button') => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      cleanupAudioSession();
      transitionVoiceState('idle');
      onRestoreFocus?.();
      return;
    }

    console.log(`VOICE_FALLBACK_STOP: ${reason}`);
    shouldProcessStopRef.current = true;
    transitionVoiceState('processing_transcription');
    clearRecordingTimeout();
    try {
      recorder.stop();
    } catch (error) {
      void showVoiceError(getErrorCode(error), 'fallback', error);
    }
  };

  const startFallbackRecording = async (source: 'web' | 'native_fallback') => {
    transitionVoiceState('requesting_permission');
    cancelRequestedRef.current = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('This device does not expose a microphone to apps'), { code: 'NO_MICROPHONE_HARDWARE' });
      }

      console.log(`VOICE_FALLBACK_CAPTURE_START: ${source}`);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });

      if (cancelRequestedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        finishAfterErrorOrCancel('cancelled');
        return;
      }

      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      shouldProcessStopRef.current = false;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      mediaRecorder.onerror = (event) => {
        void showVoiceError('MEDIA_RECORDER_ERROR', 'fallback', event instanceof ErrorEvent ? event.error : event);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        mediaRecorderRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;

        if (cancelRequestedRef.current || !shouldProcessStopRef.current) {
          cleanupAudioSession();
          finishAfterErrorOrCancel('cancelled');
          return;
        }

        if (audioBlob.size <= 0) {
          void showVoiceError('EMPTY_SPEECH', 'fallback', new Error('I didn’t catch that, try again'));
          return;
        }

        void processAudio(audioBlob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      transitionVoiceState('listening');
      recordingTimeoutRef.current = window.setTimeout(() => {
        console.warn('VOICE_TIMEOUT: fallback recording auto-stop');
        stopFallbackRecording('timeout');
      }, FALLBACK_RECORDING_TIMEOUT_MS);

      toast({ title: 'Listening…', description: 'Tap again to stop.' });
    } catch (error) {
      await showVoiceError(getErrorCode(error), 'browser', error);
    }
  };

  const shouldFallbackFromNativeError = (code: string) => (
    code === 'NO_SPEECH_RECOGNIZER' ||
    code === 'ACTIVITY_NOT_FOUND' ||
    code === 'NATIVE_VOICE_UNAVAILABLE'
  );

  const startNativeThenFallback = async () => {
    const now = Date.now();
    if (now < cooldownUntilRef.current) {
      toast({ title: 'Voice is resetting', description: 'Try again in a moment.' });
      return;
    }

    let available = false;
    try {
      const availability = await AppManager.isSpeechRecognitionAvailable();
      available = !!availability.available;
    } catch (error) {
      console.warn('Speech recognizer availability check failed', error);
    }
    console.log(`VOICE_NATIVE_AVAILABLE: ${available}`);

    if (!available) {
      toast({ title: 'No speech recognizer', description: 'Using ElevenLabs voice fallback.' });
      await startFallbackRecording('native_fallback');
      return;
    }

    nativePendingRef.current = true;
    transitionVoiceState('listening');
    try {
      const result = await AppManager.startVoiceInput({ prompt: 'Ask Snow Media AI' });
      cooldownUntilRef.current = Date.now() + NATIVE_COOLDOWN_MS;
      nativePendingRef.current = false;
      const text = result.text?.trim() ?? '';
      console.log('VOICE_NATIVE_RESULT_TEXT:', text);

      if (!text) {
        // Fire TV Alexa often consumes the mic so the native recognizer hears nothing.
        // Auto-fall back to ElevenLabs recording instead of nagging the user.
        console.warn('VOICE_NATIVE_EMPTY → falling back to ElevenLabs recording');
        toast({ title: 'Switching to backup mic', description: 'Listening again — speak now.' });
        await startFallbackRecording('native_fallback');
        return;
      }


      cleanupAudioSession();
      transitionVoiceState('processing_transcription');
      await onTranscription(text, lifecycleControls);
      if (voiceStateRef.current === 'processing_transcription') {
        transitionVoiceState('idle');
        onRestoreFocus?.();
      }
    } catch (error) {
      cooldownUntilRef.current = Date.now() + NATIVE_COOLDOWN_MS;
      nativePendingRef.current = false;
      const code = getErrorCode(error, 'NATIVE_VOICE_UNAVAILABLE');
      logVoiceError(code, getErrorMessage(error) || code, 'native', error);

      if (code === 'VOICE_CANCELLED') {
        finishAfterErrorOrCancel('cancelled');
        return;
      }

      if (code === 'VOICE_RECOGNIZER_BUSY') {
        await showVoiceError(code, 'native', error);
        return;
      if (shouldFallbackFromNativeError(code) || code === 'EMPTY_SPEECH') {
        console.warn(`VOICE_NATIVE_${code} → ElevenLabs fallback`);
        toast({ title: 'Switching to backup mic', description: 'Listening again — speak now.' });
        await startFallbackRecording('native_fallback');
        return;
      }

      await showVoiceError(code, 'native', error);

      }

      await showVoiceError(code, 'native', error);
    } finally {
      nativePendingRef.current = false;
      cancelRequestedRef.current = false;
    }
  };

  const startRecording = async () => {
    if (disabled) return;
    const state = voiceStateRef.current;
    if (ACTIVE_CAPTURE_STATES.has(state)) {
      if (state === 'listening' && mediaRecorderRef.current) stopFallbackRecording('button');
      else cancelVoiceAttempt('button');
      return;
    }
    if (state === 'sending_to_ai' || state === 'speaking') return;

    onRecordingStart?.();
    transitionVoiceState('requesting_permission');

    if (isNativePlatform()) {
      await startNativeThenFallback();
    } else {
      await startFallbackRecording('web');
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (ACTIVE_CAPTURE_STATES.has(voiceStateRef.current) || nativePendingRef.current) {
        console.log('VOICE_CLEANUP: leaving page/unmount');
        cancelRequestedRef.current = true;
        if (nativePendingRef.current && isNativePlatform()) {
          void AppManager.cancelVoiceInput().catch(() => undefined);
        }
      }
      cleanupAudioSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isListening = currentVoiceState === 'listening';
  const isBusy = currentVoiceState === 'requesting_permission'
    || currentVoiceState === 'processing_transcription'
    || currentVoiceState === 'sending_to_ai'
    || currentVoiceState === 'speaking';

  return (
    <Button
      onClick={startRecording}
      disabled={disabled && currentVoiceState === 'idle'}
      variant={isListening ? 'destructive' : 'gold'}
      size="sm"
      className={`transition-all duration-200 ${className}`}
    >
      {isListening ? (
        <>
          <MicOff className="w-4 h-4 mr-2 animate-pulse" />
          Stop
        </>
      ) : isBusy ? (
        <>
          <Volume2 className="w-4 h-4 mr-2 animate-pulse" />
          {currentVoiceState === 'speaking' ? 'Speaking...' : currentVoiceState === 'sending_to_ai' ? 'Sending...' : currentVoiceState === 'requesting_permission' ? 'Preparing...' : 'Processing...'}
        </>
      ) : (
        <>
          <Mic className="w-4 h-4 mr-2" />
          Voice
        </>
      )}
    </Button>
  );
};

export default VoiceInput;
