import { useState, useRef, useCallback } from 'react';

interface UseSTTProps {
  onTranscription: (text: string, isFinal: boolean) => void;
}

export function useSTT({ onTranscription }: UseSTTProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const sttWebSocketRef = useRef<WebSocket | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isProcessingRef = useRef(false);
  const audioQueueRef = useRef<Blob[]>([]);

  const initializeAudio = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });

      audioStreamRef.current = stream;
      setIsInitialized(true);
      return true;
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      return false;
    }
  }, []);

  const connectSTT = useCallback(async () => {
    try {
      setConnectionStatus('connecting');
      
      const groqApiKey = import.meta.env.VITE_GROQ_API_KEY;
      if (!groqApiKey) {
        throw new Error('Groq API key not configured');
      }

      // Create WebSocket connection to Groq STT
      const ws = new WebSocket('wss://api.groq.com/openai/v1/audio/transcriptions', ['Authorization', `Bearer ${groqApiKey}`]);
      
      ws.onopen = () => {
        console.log('Groq STT WebSocket connected');
        setConnectionStatus('connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.text) {
            onTranscription(data.text, data.is_final || false);
          }
        } catch (error) {
          console.error('Failed to parse STT response:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('STT WebSocket error:', error);
        setConnectionStatus('error');
      };

      ws.onclose = () => {
        console.log('STT WebSocket closed');
        setConnectionStatus('disconnected');
      };

      sttWebSocketRef.current = ws;
      return true;
    } catch (error) {
      console.error('Failed to connect STT:', error);
      setConnectionStatus('error');
      return false;
    }
  }, [onTranscription]);

  const lastTranscriptionRef = useRef<string>('');
  const lastTranscriptionTimeRef = useRef<number>(0);

  // Helper function to calculate text similarity
  const calculateSimilarity = useCallback((text1: string, text2: string): number => {
    if (!text1 || !text2) return 0;
    
    const words1 = text1.toLowerCase().split(/\s+/);
    const words2 = text2.toLowerCase().split(/\s+/);
    
    const commonWords = words1.filter(word => words2.includes(word));
    const totalWords = Math.max(words1.length, words2.length);
    
    return totalWords > 0 ? commonWords.length / totalWords : 0;
  }, []);

  // Helper function to detect transcription artifacts
  const isTranscriptionArtifact = useCallback((text: string): boolean => {
    const normalizedText = text.toLowerCase().trim();
    
    // Comprehensive list of known artifacts
    const artifacts = [
      'en español',
      'gracias por ver el video',
      'gracias por ver',
      'por ver el video',
      'ver el video',
      'gracias por',
      'por ver',
      'del video',
      'el video'
    ];
    
    // Check for exact artifacts (more strict)
    for (const artifact of artifacts) {
      if (normalizedText === artifact || normalizedText.includes(artifact)) {
        console.log(`🚫 Artifact detected: "${text}" contains "${artifact}"`);
        return true;
      }
    }
    
    // Check for very short transcriptions that are likely noise
    if (normalizedText.length < 8) {
      console.log(`🚫 Too short: "${text}" (${normalizedText.length} chars)`);
      return true;
    }
    
    // Check for repeated words/phrases pattern
    const words = normalizedText.split(/\s+/);
    const uniqueWords = new Set(words);
    if (words.length > 3 && uniqueWords.size < words.length / 2) {
      console.log(`🚫 Repetitive pattern: "${text}" (${uniqueWords.size}/${words.length} unique)`);
      return true;
    }
    
    // Check for common noise patterns
    const noisePatterns = [
      /^(gracias|thank|thanks)/i,
      /video\s*$/i,
      /^(por|for)\s/i
    ];
    
    for (const pattern of noisePatterns) {
      if (pattern.test(normalizedText)) {
        console.log(`🚫 Noise pattern: "${text}" matches ${pattern}`);
        return true;
      }
    }
    
    return false;
  }, []);

  const processAudioQueue = useCallback(async () => {
    if (isProcessingRef.current || audioQueueRef.current.length === 0) {
      return;
    }

    isProcessingRef.current = true;
    const audioBlob = audioQueueRef.current.shift()!;
    
    console.log(`📦 Processing voice input: ${audioBlob.size} bytes`);
    
    try {
      const groqApiKey = import.meta.env.VITE_GROQ_API_KEY;
      if (!groqApiKey) {
        throw new Error('Groq API key not configured');
      }

      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.wav');
      formData.append('model', 'whisper-large-v3');
      formData.append('response_format', 'json');
      formData.append('language', 'es');
      formData.append('temperature', '0');
      formData.append('prompt', 'El usuario habla español claramente. Transcribe exactamente lo que dice sin omitir palabras.');

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqApiKey}`,
        },
        body: formData
      });

      if (!response.ok) {
        throw new Error(`Groq STT API error: ${response.status}`);
      }

      const data = await response.json();
      const transcription = data.text?.trim() || '';
      
      if (transcription && transcription.length > 2) {
        // Advanced duplicate detection and filtering
        const currentTime = Date.now();
        const timeSinceLastTranscription = currentTime - lastTranscriptionTimeRef.current;
        
        // Check for exact duplicates or very similar transcriptions
        const similarity = calculateSimilarity(transcription, lastTranscriptionRef.current);
        const isDuplicate = similarity > 0.8 && timeSinceLastTranscription < 5000;
        
        // Filter out common artifacts and repeated phrases
        const isArtifact = isTranscriptionArtifact(transcription);
        
        console.log(`🔍 Analyzing transcription: "${transcription}" | Similarity: ${similarity.toFixed(2)} | IsArtifact: ${isArtifact}`);
        
        // Additional safety check - reject if contains any artifact keywords
        const cleanText = transcription.toLowerCase().trim();
        const containsArtifact = cleanText === 'en español' || 
                                cleanText.includes('en español') ||
                                cleanText.includes('gracias') ||
                                cleanText.includes('video') ||
                                cleanText.includes('por ver');
        
        if (!isDuplicate && !isArtifact && !containsArtifact) {
          console.log('🎯 Voice transcription:', transcription);
          lastTranscriptionRef.current = transcription;
          lastTranscriptionTimeRef.current = currentTime;
          onTranscription(transcription, true);
        } else {
          console.log('🔄 Filtered transcription:', transcription, 
            isDuplicate ? '(duplicate)' : 
            isArtifact ? '(artifact)' : 
            containsArtifact ? '(contains artifact keywords)' : '(other)',
            `| Clean: "${cleanText}"`);
        }
      } else {
        console.log('🔇 Empty or invalid transcription, skipping');
      }
    } catch (error) {
      console.error('Groq STT processing failed:', error);
    } finally {
      isProcessingRef.current = false;
      
      // Clear queue to prevent backlog
      audioQueueRef.current = [];
    }
  }, [onTranscription, calculateSimilarity, isTranscriptionArtifact]);

  const processAudioWithGroq = useCallback(async (audioBlob: Blob) => {
    // Skip if already processing to prevent multiple simultaneous transcriptions
    if (isProcessingRef.current) {
      console.log('🔄 Skipping audio processing - already processing');
      return;
    }
    
    // Add to queue but implement intelligent selection
    audioQueueRef.current.push(audioBlob);
    
    // If multiple audio blobs arrive quickly, only process the largest one
    setTimeout(() => {
      if (audioQueueRef.current.length > 1) {
        // Sort by size and keep only the largest
        audioQueueRef.current.sort((a, b) => b.size - a.size);
        const largestBlob = audioQueueRef.current[0];
        console.log(`📊 Multiple audio detected: processing largest (${largestBlob.size} bytes), discarding ${audioQueueRef.current.length - 1} others`);
        audioQueueRef.current = [largestBlob];
      }
      
      // Start processing
      if (!isProcessingRef.current) {
        processAudioQueue();
      }
    }, 100); // Small delay to allow multiple blobs to arrive
  }, [processAudioQueue]);

  const startRecording = useCallback(async () => {
    if (!isInitialized) {
      const initialized = await initializeAudio();
      if (!initialized) throw new Error('Failed to initialize audio');
    }

    if (!audioStreamRef.current) {
      throw new Error('Audio stream not initialized');
    }

    // Reset audio chunks
    audioChunksRef.current = [];

    // Create MediaRecorder with better settings for STT
    const options = { mimeType: 'audio/webm;codecs=opus' };
    const mediaRecorder = new MediaRecorder(audioStreamRef.current, options);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
        console.log(`Audio chunk: ${event.data.size} bytes`);
      }
    };

    mediaRecorder.onstop = () => {
      console.log('Processing recorded audio...');
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      console.log(`Total audio size: ${audioBlob.size} bytes`);
      processAudioWithGroq(audioBlob);
    };

    // Start recording with continuous chunks
    console.log('Starting STT recording...');
    mediaRecorder.start(500); // More frequent chunks for better responsiveness
    setConnectionStatus('recording');
  }, [isInitialized, initializeAudio, processAudioWithGroq]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    if (sttWebSocketRef.current) {
      sttWebSocketRef.current.close();
      sttWebSocketRef.current = null;
    }
    
    setConnectionStatus('disconnected');
  }, []);

  return {
    startRecording,
    stopRecording,
    processAudioWithGroq,
    isInitialized,
    connectionStatus
  };
}
