import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Volume2 } from 'lucide-react';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { AppManager } from '@/capacitor/AppManager';
import { isNativePlatform } from '@/utils/platform';

interface VoiceInputProps {
  onTranscription: (text: string) => void;
  onRecordingStart?: () => void;
  className?: string;
}

export const VoiceInput = ({ onTranscription, onRecordingStart, className = '' }: VoiceInputProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const { toast } = useToast();

  const startRecording = async () => {
    try {
      // Notify parent in gesture context (so it can unlock TTS audio playback)
      onRecordingStart?.();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 },
      });

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await processAudio(audioBlob);
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);

      toast({ title: 'Listening…', description: 'Tap again to stop.' });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error ?? '');
      const isFireTV = /AFT[A-Z0-9]+/i.test(navigator.userAgent);
      const isPermissionError = /Permission|NotAllowed|denied/i.test(errMsg);
      const noMicHardware = /NotFound|NotReadable|no.*device/i.test(errMsg);

      if (isFireTV || noMicHardware) {
        toast({
          title: 'No microphone available',
          description: isFireTV
            ? "Fire TV remotes don't expose their mic to apps. Voice input works on phones, tablets and Android TV boxes with a connected mic."
            : 'No microphone was detected on this device.',
          variant: 'destructive',
        });
      } else if (isPermissionError && isNativePlatform()) {
        toast({
          title: 'Microphone access denied',
          description: 'Tap "Open Settings", then enable Microphone for Snow Media Center.',
          variant: 'destructive',
          action: (
            <ToastAction
              altText="Open Settings"
              onClick={async () => {
                try {
                  await AppManager.openAppSettings({ packageName: 'com.snowmedia' });
                } catch (e) {
                  console.warn('openAppSettings failed', e);
                }
              }}
            >
              Open Settings
            </ToastAction>
          ),
        });
      } else {
        toast({
          title: 'Microphone access denied',
          description: 'Please allow microphone access to use voice input.',
          variant: 'destructive',
        });
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsProcessing(true);
    }
  };

  const processAudio = async (audioBlob: Blob) => {
    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      // Chunk-encode to avoid stack overflow
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const base64Audio = btoa(binary);

      const { data, error } = await supabase.functions.invoke('elevenlabs-stt', {
        body: { audio: base64Audio, mimeType: 'audio/webm' },
      });

      if (error) throw error;
      const text = (data as { text?: string })?.text?.trim();
      if (!text) {
        toast({ title: 'No speech detected', description: 'Please try again.', variant: 'destructive' });
      } else {
        onTranscription(text);
      }
    } catch (error) {
      console.error('STT error:', error);
      toast({
        title: 'Voice input failed',
        description: error instanceof Error ? error.message : 'Could not transcribe audio.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  return (
    <Button
      onClick={toggleRecording}
      disabled={isProcessing}
      variant={isRecording ? 'destructive' : 'gold'}
      size="sm"
      className={`transition-all duration-200 ${className}`}
    >
      {isProcessing ? (
        <>
          <Volume2 className="w-4 h-4 mr-2 animate-pulse" />
          Processing...
        </>
      ) : isRecording ? (
        <>
          <MicOff className="w-4 h-4 mr-2 animate-pulse" />
          Stop
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
