import { useState, useEffect, useRef, useCallback } from "react";
import { Card } from "@/components/ui/card";
import AvatarVideo from "@/components/AvatarVideo";
import ConversationPanel from "@/components/ConversationPanel";
import ControlPanel from "@/components/ControlPanel";
import AudioTestPanel from "@/components/AudioTestPanel";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSTT } from "@/hooks/useSTT";
import { useLLM } from "@/hooks/useLLM";
import { useVoiceActivityDetection } from "@/hooks/useVoiceActivityDetection";
import { loadApiConfig, CONFIG } from "@/lib/config";

export default function ConversationalAvatar() {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAvatarTalking, setIsAvatarTalking] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
  }>>([]);
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [latency, setLatency] = useState<number | null>(null);
  const [apiConfig, setApiConfig] = useState<any>(null);
  const [latencyStart, setLatencyStart] = useState<number | null>(null);
  const [pipelineState, setPipelineState] = useState<'idle' | 'processing' | 'thinking'>('idle');
  
  // Abort controllers and refs for cleanup
  const abortRef = useRef<() => void>(() => {});
  const didAbortController = useRef<AbortController | null>(null);
  const llmAbortController = useRef<AbortController | null>(null);
  const sttAbortController = useRef<AbortController | null>(null);
  const turnId = useRef(0);
  const thinkingTimer = useRef<NodeJS.Timeout | null>(null);

  const {
    connect: connectWebRTC,
    disconnect: disconnectWebRTC,
    softReset,
    sendStreamText,
    interruptStream,
    connectionState,
    iceConnectionState,
    iceGatheringState,
    signalingState,
    streamingState,
    streamEvent,
    isStreamReady,
    videoRef,
    idleVideoRef
  } = useWebRTC();

  // Helper function for adding messages
  const addConversationMessage = useCallback((role: 'user' | 'assistant' | 'system', content: string) => {
    const message = {
      role,
      content,
      timestamp: new Date()
    };
    
    setConversationHistory(prev => {
      const newHistory = [...prev, message];
      // Keep history manageable (<12 turns as per PRD)
      if (newHistory.length > 24) {
        return newHistory.slice(-20);
      }
      return newHistory;
    });
  }, []);

  // Process user message function - needs to be declared before useLLM
  const processUserMessage = useCallback(async (userMessage: string) => {
    console.log('Processing user message:', userMessage);
    
    setLatencyStart(Date.now());
    addConversationMessage('user', userMessage);
    setPipelineState('thinking');
    
    // Build messages with current history plus new user message
    const messages = [
      {
        role: 'system' as const,
        content: 'Eres Alex, un asistente de IA útil. Mantén las respuestas concisas y naturales para conversación por voz. Limita a 2-3 oraciones. Responde siempre en español.'
      },
      ...conversationHistory
        .filter(msg => msg.role !== 'system')
        .map(msg => ({
          role: msg.role,
          content: msg.content
        })),
      {
        role: 'user' as const,
        content: userMessage
      }
    ];

    // Create abort controller for LLM request
    llmAbortController.current = new AbortController();
    
    // Send to LLM - will be handled by useLLM hook
    console.log('🧠 Sending messages to LLM:', messages);
    if (sendToLLM) {
      sendToLLM(messages, llmAbortController.current);
    }
  }, [conversationHistory, addConversationMessage]);

  // LLM hook with response handler
  const { sendMessage: sendToLLM } = useLLM({
    onResponse: async (response) => {
      console.log('🎯 LLM Response in callback:', response);
      addConversationMessage('assistant', response);
      if (apiConfig) {
        console.log('🎯 Creating new D-ID controller and sending to avatar');
        
        // Ensure WebRTC before each send
        if (!connectionState || connectionState === 'failed' || connectionState === 'disconnected') {
          console.log('🔄 WebRTC connection lost, reconnecting...');
          try {
            await connectWebRTC(apiConfig);
            // Wait a moment for connection to stabilize
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            console.error('Failed to reconnect WebRTC:', error);
            return;
          }
        }
        
        // Abort previous clip only if still playing
        if (isAvatarTalking && didAbortController.current) {
          didAbortController.current.abort();
          didAbortController.current = null;
        }
        
        const controller = new AbortController();
        didAbortController.current = controller;
        setIsAvatarTalking(true);
        console.log('🎯 Calling sendStreamText with response:', response);
        sendStreamText(response, controller);
      } else {
        console.log('❌ No apiConfig available for D-ID');
      }
    }
  });

  const {
    startRecording,
    stopRecording,
    processAudioWithGroq,
    isInitialized: sttInitialized,
    connectionStatus: sttStatus
  } = useSTT({
    onTranscription: (text, isFinal) => {
      setCurrentTranscription(text);
      if (isFinal) {
        processUserMessage(text);
        setCurrentTranscription('');
      }
    }
  });

  // Centralized abort function - the "red button"
  const abortTurn = useCallback(() => {
    console.log('🛑 ABORT TURN - Stopping all processes');
    console.log('🛑 Avatar talking state:', isAvatarTalking);
    console.log('🛑 Pipeline state:', pipelineState);
    
    // 1. GENTLY STOP VIDEO (don't disconnect completely)
    if (videoRef.current) {
      console.log('🛑 Pausing main video element');
      videoRef.current.pause();
      videoRef.current.style.opacity = '0';
    }
    
    if (idleVideoRef.current) {
      console.log('🛑 Showing idle video');
      idleVideoRef.current.style.opacity = '1';
      idleVideoRef.current.style.display = 'block';
      idleVideoRef.current.play().catch(e => console.log('Idle video play failed:', e));
    }
    
    // 2. Stop current D-ID stream
    if (didAbortController.current) {
      console.log('🛑 Aborting current D-ID controller');
      didAbortController.current.abort();
      didAbortController.current = null;
    }
    
    interruptStream();
    
    // 3. LLM stream
    if (llmAbortController.current) {
      console.log('🛑 Aborting LLM controller');
      llmAbortController.current.abort();
    }
    
    // 4. STT stream  
    if (sttAbortController.current) {
      console.log('🛑 Aborting STT controller');
      sttAbortController.current.abort();
    }
    
    // 5. Timers and state cleanup
    if (thinkingTimer.current) {
      console.log('🛑 Clearing thinking timer');
      clearTimeout(thinkingTimer.current);
      thinkingTimer.current = null;
    }
    
    setIsAvatarTalking(false);
    setPipelineState('idle');
    
    console.log('🛑 All processes stopped - abort complete');
    
    // Restore video element after short delay
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.style.opacity = '1';
      }
    }, 500);

    // Force complete state reset
    setTimeout(() => {
      if (idleVideoRef.current) idleVideoRef.current.style.display = 'none';
      if (videoRef.current) videoRef.current.style.opacity = '1';
      setIsAvatarTalking(false);
      setPipelineState('idle');
    }, 500);
  }, [videoRef, idleVideoRef, isAvatarTalking, pipelineState, interruptStream]);

  // Make abortTurn available to other components
  abortRef.current = abortTurn;

  // Voice Activity Detection for automatic conversation flow
  const { startVAD, stopVAD } = useVoiceActivityDetection({
    isAvatarSpeaking: isAvatarTalking,
    onSpeechEnd: async (audioBlob) => {
      console.log(`📦 Processing voice input: ${audioBlob.size} bytes`);
      
      // Process audio with Groq STT optimized for low latency
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.wav');
      formData.append('model', 'whisper-large-v3');
      formData.append('language', 'es');
      formData.append('response_format', 'json');
      formData.append('temperature', '0.0');
      formData.append('prompt', 'Conversación en español');

      try {
        const groqApiKey = import.meta.env.VITE_GROQ_API_KEY;
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${groqApiKey}`,
          },
          body: formData
        });

        if (response.ok) {
          const data = await response.json();
          if (data.text && data.text.trim()) {
            const transcription = data.text.trim();
            console.log('🎯 Voice transcription:', transcription);
            
            // Filter out only obvious video artifacts
            const isRealArtifact = transcription.toLowerCase() === 'gracias por ver' ||
                                 transcription.toLowerCase() === 'subtítulos' ||
                                 transcription.toLowerCase() === 'subtitulos' ||
                                 transcription.toLowerCase() === 'suscríbete' ||
                                 transcription.toLowerCase() === 'suscribete';
            
            // Allow meaningful conversation
            if (!isRealArtifact && transcription.length > 1) {
              console.log('✅ Processing user message after barge-in:', transcription);
              processUserMessage(transcription);
            } else {
              console.log('🚫 Filtered artifact:', transcription);
              setPipelineState('idle');
            }
          }
        } else {
          setPipelineState('idle');
        }
      } catch (error) {
        console.error('Voice processing failed:', error);
        setPipelineState('idle');
      }
    },
    onSpeechStart: () => {
      console.log('🎤 Voice detected, listening... Avatar talking:', isAvatarTalking);
      
      // Normal speech detection only - barge-in is handled by onInterrupt
      if (!isAvatarTalking) {
        console.log('🎤 Normal voice detection - avatar not talking');
        setPipelineState('processing');
      }
    },
    onInterrupt: () => {
      console.log('🛑 VOICE INTERRUPT DETECTED - Same as Stop button');
      abortRef.current();
    }
  });

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const config = await loadApiConfig();
        setApiConfig(config);
        addConversationMessage('system', '¡Bienvenido! Haz clic en "Connect" para iniciar tu conversación con Alex.');
      } catch (error) {
        console.error('Failed to load API configuration:', error);
        addConversationMessage('system', 'Error: Por favor configura tus claves API en el archivo .env.');
      }
    };

    initializeApp();
  }, [addConversationMessage]);

  const handleConnect = async () => {
    if (!apiConfig) {
      addConversationMessage('system', 'Error: Configuración de API no cargada');
      return;
    }

    try {
      await connectWebRTC(apiConfig);
      setIsConnected(true);
      addConversationMessage('system', 'Conectado al asistente AI. Ahora puedes iniciar una conversación.');
    } catch (error) {
      console.error('Connection failed:', error);
      addConversationMessage('system', 'Error: No se pudo conectar al servicio AI. Verifica tu configuración de API.');
    }
  };

  const handleStartConversation = async () => {
    if (!isRecording) {
      try {
        const vadStarted = await startVAD();
        if (vadStarted) {
          setIsRecording(true);
          addConversationMessage('system', 'Detección de voz activa. Alex responderá automáticamente cuando hagas una pausa al hablar.');
        } else {
          throw new Error('Failed to start voice detection');
        }
      } catch (error) {
        console.error('Failed to start conversation:', error);
        addConversationMessage('system', 'Error: No se pudo acceder al micrófono. Verifica los permisos.');
      }
    } else {
      stopVAD();
      setIsRecording(false);
      addConversationMessage('system', 'Detección de voz detenida.');
    }
  };

  // Add test event listeners
  useEffect(() => {
    const handleSendStreamText = (event: any) => {
      if (apiConfig) {
        sendStreamText(event.detail.text);
      }
    };

    const handleVoiceTranscription = (event: any) => {
      if (event.detail.text && event.detail.isFinal) {
        processUserMessage(event.detail.text);
      }
    };

    const handleManualInterrupt = () => {
      if (abortRef.current) {
        console.log('🧪 Test: Triggering manual interrupt');
        abortRef.current();
      }
    };

    const handleVoiceInterrupt = () => {
      if (abortRef.current) {
        console.log('🧪 Test: Triggering voice interrupt (barge-in)');
        abortRef.current();
      }
    };

    window.addEventListener('test-send-stream-text', handleSendStreamText);
    window.addEventListener('test-voice-transcription', handleVoiceTranscription);
    window.addEventListener('test-manual-interrupt', handleManualInterrupt);
    window.addEventListener('test-voice-interrupt', handleVoiceInterrupt);

    return () => {
      window.removeEventListener('test-send-stream-text', handleSendStreamText);
      window.removeEventListener('test-voice-transcription', handleVoiceTranscription);
      window.removeEventListener('test-manual-interrupt', handleManualInterrupt);
      window.removeEventListener('test-voice-interrupt', handleVoiceInterrupt);
    };
  }, [apiConfig, sendStreamText, processUserMessage]);

  const handleDisconnect = () => {
    console.log('🔌 Manual disconnect initiated by user');
    disconnectWebRTC();
    stopRecording();
    stopVAD();
    setIsConnected(false);
    setIsRecording(false);
    setIsAvatarTalking(false);
    setCurrentTranscription('');
    setConversationHistory([]);
    setLatency(null);
    addConversationMessage('system', 'Desconectado del asistente AI.');
  };

  const handleManualSend = (message: string) => {
    if (message.trim() && isConnected) {
      processUserMessage(message.trim());
    }
  };

  // Test barge-in functionality
  const testBargeIn = useCallback(() => {
    console.log('🧪 TESTING BARGE-IN FUNCTIONALITY');
    
    if (!isConnected) {
      console.log('❌ Not connected - connect first');
      return;
    }
    
    // Simulate avatar talking
    setIsAvatarTalking(true);
    console.log('🗣️ Simulated avatar talking state: true');
    
    // Create a test D-ID controller
    didAbortController.current = new AbortController();
    
    // Simulate a long avatar response
    setTimeout(() => {
      if (apiConfig) {
        sendStreamText("Esta es una respuesta muy larga para probar la funcionalidad de interrupción. El usuario debería poder interrumpir esta respuesta hablando mientras el avatar está respondiendo.", didAbortController.current || undefined);
      }
    }, 1000);
    
    console.log('🧪 Test barge-in setup complete - try speaking now to interrupt');
  }, [isConnected, apiConfig, sendStreamText]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 dark:from-gray-900 dark:to-gray-800 p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-center mb-8 text-gray-800 dark:text-white">
          Conversational AI Avatar
        </h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Avatar Video Section */}
          <div className="lg:col-span-2">
            <Card className="p-6 h-full">
              <AvatarVideo
                videoRef={videoRef}
                idleVideoRef={idleVideoRef}
                streamingState={streamingState}
                isStreamReady={isStreamReady}
                isRecording={isRecording}
              />
            </Card>
          </div>
          
          {/* Controls and Conversation */}
          <div className="space-y-6">
            {/* Control Panel */}
            <Card className="p-4">
              <ControlPanel
                isConnected={isConnected}
                isRecording={isRecording}
                connectionState={connectionState}
                iceConnectionState={iceConnectionState}
                iceGatheringState={iceGatheringState}
                signalingState={signalingState}
                streamingState={streamingState}
                streamEvent={streamEvent}
                latency={latency}
                sttStatus={sttStatus}
                onConnect={handleConnect}
                onStartConversation={handleStartConversation}
                onDisconnect={handleDisconnect}
                onTestBargein={testBargeIn}
                onManualInterrupt={abortTurn}
              />
            </Card>
            
            {/* Conversation Panel */}
            <Card className="p-4">
              <ConversationPanel
                conversationHistory={conversationHistory}
                currentTranscription={currentTranscription}
                isRecording={isRecording}
                isConnected={isConnected}
                apiConfig={apiConfig}
                onManualSend={handleManualSend}
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}