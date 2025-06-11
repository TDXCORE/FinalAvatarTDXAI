import { useRef, useCallback } from 'react';
import { CONFIG } from '@/lib/config';

interface UseVADProps {
  onSpeechEnd: (audioBlob: Blob) => void;
  onSpeechStart?: () => void;
}

export function useVoiceActivityDetection({ onSpeechEnd, onSpeechStart }: UseVADProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isSpeakingRef = useRef(false);
  const isRecordingRef = useRef(false);

  const detectVoiceActivity = useCallback(() => {
    if (!analyserRef.current) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Calculate average volume
    const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
    const threshold = 30; // Adjust this threshold as needed

    const isSpeaking = average > threshold;

    if (isSpeaking && !isSpeakingRef.current) {
      // Speech started
      isSpeakingRef.current = true;
      onSpeechStart?.();
      
      // Clear any existing silence timeout
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }

      // Start recording if not already recording
      if (!isRecordingRef.current && mediaRecorderRef.current) {
        recordingChunksRef.current = [];
        mediaRecorderRef.current.start();
        isRecordingRef.current = true;
        console.log('🎤 Voice detected - started recording');
      }
    } else if (!isSpeaking && isSpeakingRef.current) {
      // Potential end of speech - start silence timer
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }

      silenceTimeoutRef.current = setTimeout(() => {
        // Speech ended after silence threshold
        isSpeakingRef.current = false;
        
        if (isRecordingRef.current && mediaRecorderRef.current) {
          mediaRecorderRef.current.stop();
          isRecordingRef.current = false;
          console.log('🔇 Silence detected - stopped recording');
        }
      }, CONFIG.SPEECH.silenceDetectionMs);
    }

    // Continue monitoring
    if (streamRef.current) {
      requestAnimationFrame(detectVoiceActivity);
    }
  }, [onSpeechEnd, onSpeechStart]);

  const startVAD = useCallback(async () => {
    try {
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      streamRef.current = stream;

      // Set up audio analysis
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      analyserRef.current.smoothingTimeConstant = 0.3;
      source.connect(analyserRef.current);

      // Set up media recorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(recordingChunksRef.current, { type: 'audio/webm' });
        if (audioBlob.size > 0) {
          console.log(`📦 Processing audio chunk: ${audioBlob.size} bytes`);
          onSpeechEnd(audioBlob);
        }
        recordingChunksRef.current = [];
      };

      mediaRecorderRef.current = mediaRecorder;

      // Start voice activity detection
      detectVoiceActivity();

      console.log('🎧 Voice Activity Detection started');
      return true;
    } catch (error) {
      console.error('Failed to start VAD:', error);
      return false;
    }
  }, [detectVoiceActivity, onSpeechEnd]);

  const stopVAD = useCallback(() => {
    // Clear timeouts
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    // Stop recording if active
    if (isRecordingRef.current && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      isRecordingRef.current = false;
    }

    // Clean up audio resources
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    isSpeakingRef.current = false;
    analyserRef.current = null;
    mediaRecorderRef.current = null;

    console.log('🔌 Voice Activity Detection stopped');
  }, []);

  return {
    startVAD,
    stopVAD,
    isSpeaking: isSpeakingRef.current
  };
}