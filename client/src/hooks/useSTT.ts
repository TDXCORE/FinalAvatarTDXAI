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

  const processAudioWithGroq = useCallback(async (audioBlob: Blob) => {
    try {
      const groqApiKey = import.meta.env.VITE_GROQ_API_KEY;
      if (!groqApiKey) {
        throw new Error('Groq API key not configured');
      }

      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model', 'whisper-large-v3');
      formData.append('response_format', 'json');
      formData.append('language', 'en');

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
      if (data.text) {
        onTranscription(data.text, true);
      }
    } catch (error) {
      console.error('Groq STT processing failed:', error);
    }
  }, [onTranscription]);

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

    // Create MediaRecorder
    const options = { mimeType: 'audio/webm;codecs=opus' };
    const mediaRecorder = new MediaRecorder(audioStreamRef.current, options);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      processAudioWithGroq(audioBlob);
    };

    mediaRecorder.start(1000); // Collect audio every 1 second
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
    isInitialized,
    connectionStatus
  };
}
