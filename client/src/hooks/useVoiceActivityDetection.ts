import { useRef, useCallback } from 'react';
import { CONFIG } from '@/lib/config';

// VAD Parameters simplified for reliable detection
const OPEN_FRAMES = 2;      // más sensible para detectar inicio
const CLOSE_FRAMES = 15;    // tiempo razonable de silencio (~500ms)
const PRE_ROLL_MS = 200;    // buffer mínimo necesario
const THRESHOLD = 20;       // umbral bajo para mejor detección
const MIN_RECORDING_MS = 600; // tiempo mínimo reducido
const DEBOUNCE_MS = 200;    // debounce más corto

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

    // Advanced speech detection using multiple frequency bands
    const sampleRate = audioContextRef.current?.sampleRate || 44100;
    const nyquist = sampleRate / 2;
    
    // Define frequency bands for human speech
    const lowSpeechStart = Math.floor((85 / nyquist) * bufferLength);   // Fundamental frequency low
    const lowSpeechEnd = Math.floor((255 / nyquist) * bufferLength);    // Fundamental frequency high
    const midSpeechStart = Math.floor((255 / nyquist) * bufferLength);  // Formant frequencies start
    const midSpeechEnd = Math.floor((2000 / nyquist) * bufferLength);   // Formant frequencies end
    const highSpeechStart = Math.floor((2000 / nyquist) * bufferLength); // High frequency speech
    const highSpeechEnd = Math.floor((4000 / nyquist) * bufferLength);   // High frequency speech end
    
    let lowSpeechEnergy = 0;
    let midSpeechEnergy = 0;
    let highSpeechEnergy = 0;
    let totalEnergy = 0;
    let noiseEnergy = 0;
    
    for (let i = 0; i < bufferLength; i++) {
      const value = dataArray[i];
      totalEnergy += value;
      
      if (i >= lowSpeechStart && i < lowSpeechEnd) {
        lowSpeechEnergy += value;
      } else if (i >= midSpeechStart && i < midSpeechEnd) {
        midSpeechEnergy += value * 1.5; // Weight formant frequencies more
      } else if (i >= highSpeechStart && i < highSpeechEnd) {
        highSpeechEnergy += value;
      } else {
        noiseEnergy += value;
      }
    }
    
    // Calculate speech characteristics
    const speechEnergy = lowSpeechEnergy + midSpeechEnergy + highSpeechEnergy;
    const speechRatio = totalEnergy > 0 ? speechEnergy / totalEnergy : 0;
    const noiseRatio = totalEnergy > 0 ? noiseEnergy / totalEnergy : 0;
    const average = totalEnergy / bufferLength;
    
    // Speech detected if good speech-to-noise ratio and sufficient energy
    const speechScore = speechRatio - (noiseRatio * 0.5);
    const level = average * Math.max(0, speechScore) * 1.5;

    // Store in pre-roll buffer (ring buffer)
    preRollBufferRef.current.push(...Array.from(dataArray).map(v => v / 255));
    if (preRollBufferRef.current.length > PRE_ROLL_MS / 10) {
      preRollBufferRef.current = preRollBufferRef.current.slice(-PRE_ROLL_MS / 10);
    }

    // Store current frame for potential recording
    bufferedFramesRef.current.push(...Array.from(dataArray).map(v => v / 255));

    // Histéresis logic - replaces fixed threshold
    const recording = isRecordingRef.current;
    
    if (!recording && level > THRESHOLD) {
      hotFramesRef.current++;
      coldFramesRef.current = 0;
    } else if (recording && level < THRESHOLD) {
      coldFramesRef.current++;
      hotFramesRef.current = 0;
    } else {
      if (!recording) hotFramesRef.current = 0;
      if (recording) coldFramesRef.current = 0;
    }

    // Start recording when enough hot frames detected
    if (!recording && hotFramesRef.current >= OPEN_FRAMES) {
      isSpeakingRef.current = true;
      isRecordingRef.current = true;
      recordingStartTimeRef.current = Date.now();
      onSpeechStart?.();
      
      // Clear any existing timeout
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }

      // Start MediaRecorder if available
      if (mediaRecorderRef.current && isActiveRef.current) {
        recordingChunksRef.current = [];
        mediaRecorderRef.current.start();
        console.log('🎤 Voice detected - started recording');
      }
      
      hotFramesRef.current = 0;
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
        
        // Build audio blob with pre-roll + buffered frames
        const allAudioData = [...preRollBufferRef.current, ...bufferedFramesRef.current];
        const audioBlob = buildWavFromBuffer(allAudioData);
        
        if (audioBlob.size > 0) {
          console.log(`🔇 Processing complete phrase: ${recordingDuration}ms audio`);
          lastProcessedTimeRef.current = Date.now();
          
          // Process audio and reset processing flag after callback
          setTimeout(() => {
            onSpeechEnd(audioBlob);
            isProcessingRef.current = false;
          }, 100);
        } else {
          isProcessingRef.current = false;
        }
        
        // Reset buffers
        preRollBufferRef.current = [];
        bufferedFramesRef.current = [];
        coldFramesRef.current = 0;
        recordingStartTimeRef.current = 0;
        
        // Stop MediaRecorder if active
        if (mediaRecorderRef.current && isActiveRef.current) {
          try {
            mediaRecorderRef.current.stop();
          } catch (e) {
            // MediaRecorder might already be stopped
          }
        }
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
        
        // Prepare for next recording segment if still active
        if (isActiveRef.current && mediaRecorderRef.current) {
          setTimeout(() => {
            if (isActiveRef.current && !isRecordingRef.current) {
              // Ready for next voice detection cycle
              console.log('🔄 Ready for next voice input');
            }
          }, 100);
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

    console.log('🔌 Voice Activity Detection stopped');
  }, []);

  return {
    startVAD,
    stopVAD,
    isSpeaking: isSpeakingRef.current,
    isActive: isActiveRef.current
  };
}