import { useState, useRef, useCallback } from 'react';
import { connectToGroqSTT } from '@/lib/groqApi';

interface UseSTTProps {
  onTranscription: (text: string, isFinal: boolean) => void;
}

export function useSTT({ onTranscription }: UseSTTProps) {
  const [isInitialized, setIsInitialized] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const sttWebSocketRef = useRef<WebSocket | null>(null);

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

      const options = { mimeType: 'audio/webm;codecs=opus' };
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0 && sttWebSocketRef.current && sttWebSocketRef.current.readyState === WebSocket.OPEN) {
          // In production, convert to PCM and send to Groq STT
          // For now, simulate STT response
          simulateSTTResponse();
        }
      };

      setIsInitialized(true);
      return true;
    } catch (error) {
      console.error('Failed to initialize audio:', error);
      return false;
    }
  }, []);

  const simulateSTTResponse = useCallback(() => {
    // Mock STT responses for demo
    const mockResponses = [
      "Hello, how are you today?",
      "What can you tell me about artificial intelligence?",
      "I'd like to know more about machine learning.",
      "Can you explain how neural networks work?",
      "Thank you for the information."
    ];

    const randomResponse = mockResponses[Math.floor(Math.random() * mockResponses.length)];
    
    // Simulate partial transcription
    setTimeout(() => {
      onTranscription(randomResponse.substring(0, Math.floor(randomResponse.length / 2)), false);
    }, 500);

    // Simulate final transcription
    setTimeout(() => {
      onTranscription(randomResponse, true);
    }, 1500);
  }, [onTranscription]);

  const connectSTT = useCallback(async () => {
    try {
      setConnectionStatus('connecting');
      
      // In production, implement proper Groq STT WebSocket connection
      // For now, simulate connection
      sttWebSocketRef.current = {
        readyState: WebSocket.OPEN,
        send: () => {},
        close: () => {}
      } as any;

      setConnectionStatus('connected');
      return true;
    } catch (error) {
      console.error('Failed to connect STT:', error);
      setConnectionStatus('error');
      return false;
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (!isInitialized) {
      const initialized = await initializeAudio();
      if (!initialized) throw new Error('Failed to initialize audio');
    }

    const connected = await connectSTT();
    if (!connected) throw new Error('Failed to connect STT');

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
      mediaRecorderRef.current.start(20); // 20ms chunks as per PRD
    }
  }, [isInitialized, initializeAudio, connectSTT]);

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
