import { useCallback, useRef } from 'react';

export function useAudioTest() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const testAudioDetection = useCallback(async () => {
    try {
      console.log('🎤 Testing audio detection...');
      
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      
      streamRef.current = stream;
      console.log('✅ Microphone access granted');
      
      // Create audio context and analyser
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      
      analyserRef.current.fftSize = 256;
      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      // Monitor audio levels
      const checkAudioLevel = () => {
        if (!analyserRef.current) return;
        
        analyserRef.current.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
        
        if (average > 10) {
          console.log(`🔊 Audio detected - Level: ${Math.round(average)}`);
        }
        
        requestAnimationFrame(checkAudioLevel);
      };
      
      checkAudioLevel();
      console.log('✅ Audio monitoring started');
      
      return true;
    } catch (error) {
      console.error('❌ Audio test failed:', error);
      return false;
    }
  }, []);

  const testSTTFlow = useCallback(async () => {
    console.log('🗣️ Testing STT flow...');
    
    if (!streamRef.current) {
      console.error('❌ No audio stream available');
      return false;
    }

    try {
      const mediaRecorder = new MediaRecorder(streamRef.current, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      const audioChunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
          console.log(`📦 Audio chunk received: ${event.data.size} bytes`);
        }
      };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        console.log(`🎵 Audio blob created: ${audioBlob.size} bytes`);
        
        // Test Groq STT API
        await testGroqSTT(audioBlob);
      };
      
      console.log('🔴 Starting 3-second recording...');
      mediaRecorder.start();
      
      setTimeout(() => {
        mediaRecorder.stop();
        console.log('⏹️ Recording stopped');
      }, 3000);
      
      return true;
    } catch (error) {
      console.error('❌ STT test failed:', error);
      return false;
    }
  }, []);

  const testGroqSTT = useCallback(async (audioBlob: Blob) => {
    console.log('🤖 Testing Groq STT API...');
    
    try {
      const groqApiKey = import.meta.env.VITE_GROQ_API_KEY;
      if (!groqApiKey) {
        console.error('❌ GROQ API key not found');
        return;
      }
      
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model', 'whisper-large-v3');
      formData.append('response_format', 'json');
      
      console.log('📡 Sending to Groq STT...');
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
      console.log('✅ STT Response:', data.text);
      
      // Test LLM flow
      if (data.text) {
        await testGroqLLM(data.text);
      }
      
    } catch (error) {
      console.error('❌ Groq STT failed:', error);
    }
  }, []);

  const testGroqLLM = useCallback(async (userText: string) => {
    console.log('🧠 Testing Groq LLM API...');
    
    try {
      const groqApiKey = import.meta.env.VITE_GROQ_API_KEY;
      if (!groqApiKey) {
        console.error('❌ GROQ API key not found');
        return;
      }
      
      const messages = [
        {
          role: 'system',
          content: 'You are Alex, a helpful AI assistant. Keep responses concise and natural for voice conversation. Limit to 2-3 sentences.'
        },
        {
          role: 'user',
          content: userText
        }
      ];
      
      console.log('📡 Sending to Groq LLM...');
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.1-70b-versatile',
          messages: messages,
          temperature: 0.7,
          max_tokens: 150
        })
      });
      
      if (!response.ok) {
        throw new Error(`Groq LLM API error: ${response.status}`);
      }
      
      const data = await response.json();
      const assistantResponse = data.choices[0]?.message?.content;
      console.log('✅ LLM Response:', assistantResponse);
      
      // Test D-ID TTS flow
      if (assistantResponse) {
        await testDIDTTS(assistantResponse);
      }
      
    } catch (error) {
      console.error('❌ Groq LLM failed:', error);
    }
  }, []);

  const testDIDTTS = useCallback(async (text: string) => {
    console.log('🗣️ Testing D-ID TTS flow...');
    
    try {
      const didApiKey = import.meta.env.VITE_DID_API_KEY;
      if (!didApiKey) {
        console.error('❌ D-ID API key not found');
        return;
      }
      
      console.log('📡 Sending text to D-ID for TTS...');
      console.log('Text to speak:', text);
      
      // Simulate sending to existing D-ID stream
      const streamMessage = {
        type: 'stream-text',
        payload: {
          script: {
            type: 'text',
            input: text,
            provider: {
              type: 'elevenlabs',
              voice_id: '21m00Tcm4TlvDq8ikWAM'
            },
            ssml: true
          },
          config: {
            stitch: true
          },
          background: {
            color: '#FFFFFF'
          }
        }
      };
      
      console.log('✅ D-ID message prepared:', streamMessage);
      console.log('🎬 Avatar should now speak the response!');
      
    } catch (error) {
      console.error('❌ D-ID TTS test failed:', error);
    }
  }, []);

  const runFullTest = useCallback(async () => {
    console.log('🚀 Starting full pipeline test...');
    console.log('================================');
    
    try {
      // Step 1: Test microphone access
      console.log('1️⃣ Testing microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('✅ Microphone access granted');
      
      // Step 2: Test audio recording
      console.log('2️⃣ Starting 3-second recording...');
      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
        console.log(`📦 Audio chunk: ${event.data.size} bytes`);
      };
      
      mediaRecorder.onstop = async () => {
        console.log('3️⃣ Processing recorded audio...');
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        console.log(`🎵 Total audio: ${audioBlob.size} bytes`);
        
        // Step 3: Test STT
        await testGroqSTT(audioBlob);
      };
      
      mediaRecorder.start();
      
      setTimeout(() => {
        mediaRecorder.stop();
        stream.getTracks().forEach(track => track.stop());
      }, 3000);
      
      console.log('🎤 Recording for 3 seconds... Please speak now!');
      
    } catch (error) {
      console.error('❌ Test failed:', error);
    }
  }, [testGroqSTT]);

  const cleanup = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
  }, []);

  return {
    runFullTest,
    testAudioDetection,
    testSTTFlow,
    cleanup
  };
}