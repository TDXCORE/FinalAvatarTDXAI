import { useRef, useCallback } from 'react';
import { CONFIG } from '@/lib/config';

// VAD Parameters optimized to prevent duplicate detection
const OPEN_FRAMES = 3;      // más estricto para evitar activaciones múltiples
const CLOSE_FRAMES = 30;    // tiempo extendido para capturar frases completas
const PRE_ROLL_MS = 200;    // buffer mínimo necesario
const THRESHOLD = 6;        // umbral reducido para detección más sensible de interrupciones
const MIN_RECORDING_MS = 1200; // tiempo mínimo extendido para capturar frases completas
const DEBOUNCE_MS = 1500;   // debounce más largo para evitar solapamiento

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
  const isActiveRef = useRef(false);
  
  // Histéresis counters and pre-roll buffer
  const hotFramesRef = useRef(0);
  const coldFramesRef = useRef(0);
  const preRollBufferRef = useRef<number[]>([]);
  const bufferedFramesRef = useRef<number[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const lastProcessedTimeRef = useRef<number>(0);
  const isProcessingRef = useRef(false);
  const backgroundLevelRef = useRef<number>(0);
  const levelHistoryRef = useRef<number[]>([]);

  const buildWavFromBuffer = useCallback((audioData: number[]): Blob => {
    // Simple WAV creation from audio buffer
    const sampleRate = 16000;
    const buffer = new ArrayBuffer(44 + audioData.length * 2);
    const view = new DataView(buffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + audioData.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, audioData.length * 2, true);
    
    // Audio data
    for (let i = 0; i < audioData.length; i++) {
      view.setInt16(44 + i * 2, audioData[i] * 0x7FFF, true);
    }
    
    return new Blob([buffer], { type: 'audio/wav' });
  }, []);

  const detectVoiceActivity = useCallback(() => {
    if (!analyserRef.current || !isActiveRef.current) return;

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);

    // Adaptive voice detection with background noise calibration
    const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
    const level = average;
    
    // Track level history for adaptive threshold
    levelHistoryRef.current.push(level);
    if (levelHistoryRef.current.length > 100) {
      levelHistoryRef.current.shift();
    }
    
    // Calculate background noise level (lowest 25% of recent levels)
    if (levelHistoryRef.current.length > 20) {
      const sortedLevels = [...levelHistoryRef.current].sort((a, b) => a - b);
      const backgroundLevel = sortedLevels[Math.floor(sortedLevels.length * 0.25)];
      backgroundLevelRef.current = backgroundLevel;
    }
    
    // Adaptive threshold: background + reduced sensitivity margin for better interruption detection
    const adaptiveThreshold = backgroundLevelRef.current + 2;
    const finalThreshold = Math.max(adaptiveThreshold, THRESHOLD);
    
    // Debug logging for troubleshooting
    if (level > finalThreshold - 2) {
      console.log(`🎵 Level: ${level.toFixed(1)}, Threshold: ${finalThreshold.toFixed(1)}, BG: ${backgroundLevelRef.current.toFixed(1)}`);
    }

    // Store in pre-roll buffer (ring buffer)
    preRollBufferRef.current.push(...Array.from(dataArray).map(v => v / 255));
    if (preRollBufferRef.current.length > PRE_ROLL_MS / 10) {
      preRollBufferRef.current = preRollBufferRef.current.slice(-PRE_ROLL_MS / 10);
    }

    // Store current frame for potential recording
    bufferedFramesRef.current.push(...Array.from(dataArray).map(v => v / 255));

    // Histéresis logic - replaces fixed threshold
    const recording = isRecordingRef.current;
    
    if (!recording && level > finalThreshold) {
      hotFramesRef.current++;
      coldFramesRef.current = 0;
    } else if (recording && level < finalThreshold) {
      coldFramesRef.current++;
      hotFramesRef.current = 0;
    } else {
      if (!recording) hotFramesRef.current = 0;
      if (recording) coldFramesRef.current = 0;
    }

    // Start recording when enough hot frames detected AND not currently processing
    if (!recording && !isProcessingRef.current && hotFramesRef.current >= OPEN_FRAMES) {
      const timeSinceLastProcessed = Date.now() - lastProcessedTimeRef.current;
      
      // Only start if debounce period has passed
      if (timeSinceLastProcessed >= DEBOUNCE_MS) {
        isSpeakingRef.current = true;
        isRecordingRef.current = true;
        recordingStartTimeRef.current = Date.now();
        onSpeechStart?.();
        
        // Clear any existing timeout
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        }

        // Start MediaRecorder for audio capture
        if (mediaRecorderRef.current && isActiveRef.current) {
          recordingChunksRef.current = [];
          mediaRecorderRef.current.start();
          console.log('🎤 Voice detected - started recording');
        }
        
        hotFramesRef.current = 0;
      } else {
        // Reset frames if debounce period not met
        hotFramesRef.current = 0;
        console.log(`⏳ Debounce active - ${timeSinceLastProcessed}ms since last processing`);
      }
    }

    // Stop recording when enough cold frames detected AND minimum duration met
    if (recording && coldFramesRef.current >= CLOSE_FRAMES) {
      const recordingDuration = Date.now() - recordingStartTimeRef.current;
      const timeSinceLastProcessed = Date.now() - lastProcessedTimeRef.current;
      
      // Only stop if we've recorded for minimum duration AND not currently processing AND debounce period passed
      if (recordingDuration >= MIN_RECORDING_MS && !isProcessingRef.current && timeSinceLastProcessed >= DEBOUNCE_MS) {
        isSpeakingRef.current = false;
        isRecordingRef.current = false;
        isProcessingRef.current = true;
        
        // Stop MediaRecorder - it will handle audio processing via onstop event
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          console.log(`🔇 Stopping MediaRecorder after ${recordingDuration}ms`);
          mediaRecorderRef.current.stop();
          lastProcessedTimeRef.current = Date.now();
          
          // Set processing flag for longer cooldown period
          setTimeout(() => {
            isProcessingRef.current = false;
          }, 1000);
        } else {
          isProcessingRef.current = false;
        }
        
        // Reset buffers
        preRollBufferRef.current = [];
        bufferedFramesRef.current = [];
        coldFramesRef.current = 0;
        recordingStartTimeRef.current = 0;
        
        // MediaRecorder already stopped above - no additional action needed
      } else if (recordingDuration < MIN_RECORDING_MS) {
        // Reset cold frames counter if minimum duration not met
        coldFramesRef.current = 0;
        console.log(`⏳ Continuing recording - ${recordingDuration}ms so far`);
      } else if (isProcessingRef.current) {
        // If currently processing, wait
        coldFramesRef.current = 0;
        console.log(`⏳ Waiting for processing to complete`);
      } else if (timeSinceLastProcessed < DEBOUNCE_MS) {
        // If debounce period not met, wait
        coldFramesRef.current = 0;
        console.log(`⏳ Debounce period active`);
      }
    }

    // Continue monitoring while active
    if (isActiveRef.current) {
      requestAnimationFrame(detectVoiceActivity);
    }
  }, [onSpeechEnd, onSpeechStart, buildWavFromBuffer]);

  const startVAD = useCallback(async () => {
    try {
      // Get microphone access with optimized settings for speech
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 44100,  // Higher sample rate for better quality
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      streamRef.current = stream;

      // Set up audio analysis with better configuration
      audioContextRef.current = new AudioContext({ sampleRate: 44100 });
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 4096;  // Higher resolution for better frequency analysis
      analyserRef.current.smoothingTimeConstant = 0.1;  // Less smoothing for more responsive detection
      analyserRef.current.minDecibels = -90;
      analyserRef.current.maxDecibels = -10;
      source.connect(analyserRef.current);

      // Set up media recorder for audio capture with optimized settings
      let mediaRecorderOptions: MediaRecorderOptions;
      let actualMimeType = 'audio/webm';
      
      // Try best audio format for speech recognition
      if (MediaRecorder.isTypeSupported('audio/wav')) {
        mediaRecorderOptions = { mimeType: 'audio/wav' };
        actualMimeType = 'audio/wav';
      } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mediaRecorderOptions = { mimeType: 'audio/webm;codecs=opus' };
        actualMimeType = 'audio/webm;codecs=opus';
      } else {
        mediaRecorderOptions = { mimeType: 'audio/webm' };
        actualMimeType = 'audio/webm';
      }
      
      const mediaRecorder = new MediaRecorder(stream, mediaRecorderOptions);
      console.log(`🎙️ MediaRecorder initialized with format: ${actualMimeType}`);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (recordingChunksRef.current.length > 0) {
          const audioBlob = new Blob(recordingChunksRef.current, { type: actualMimeType });
          console.log(`📦 Processing voice input: ${audioBlob.size} bytes (${actualMimeType})`);
          onSpeechEnd(audioBlob);
          recordingChunksRef.current = [];
        }
      };

      mediaRecorderRef.current = mediaRecorder;

      // Set as active and start voice activity detection
      isActiveRef.current = true;
      detectVoiceActivity();

      console.log('🎧 Voice Activity Detection started');
      return true;
    } catch (error) {
      console.error('Failed to start VAD:', error);
      return false;
    }
  }, [detectVoiceActivity, onSpeechEnd]);

  const stopVAD = useCallback(() => {
    // Mark as inactive first to stop the detection loop
    isActiveRef.current = false;
    
    // Clear timeouts
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    // Stop recording if active
    if (isRecordingRef.current && mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        // MediaRecorder might already be stopped
      }
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

    // Reset all state
    isSpeakingRef.current = false;
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    hotFramesRef.current = 0;
    coldFramesRef.current = 0;
    preRollBufferRef.current = [];
    bufferedFramesRef.current = [];
    recordingStartTimeRef.current = 0;
    lastProcessedTimeRef.current = 0;
    isProcessingRef.current = false;
    backgroundLevelRef.current = 0;
    levelHistoryRef.current = [];

    console.log('🔌 Voice Activity Detection stopped');
  }, []);

  return {
    startVAD,
    stopVAD,
    isSpeaking: isSpeakingRef.current,
    isActive: isActiveRef.current
  };
}