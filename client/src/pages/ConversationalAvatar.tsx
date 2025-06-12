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
    
    // 1. FORCE STOP VIDEO IMMEDIATELY
    if (videoRef.current) {
      console.log('🛑 FORCE stopping main video element');
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      videoRef.current.style.opacity = '0';
      videoRef.current.style.display = 'none';
      
      // Remove video source to completely stop playback
      videoRef.current.src = '';
      videoRef.current.srcObject = null;
    }
    
    if (idleVideoRef.current) {
      console.log('🛑 Showing idle video');
      idleVideoRef.current.style.opacity = '1';
      idleVideoRef.current.style.display = 'block';
    }
    
    // 2. Stop D-ID connection aggressively
    if (didAbortController.current) {
      console.log('🛑 Aborting D-ID controller');
      didAbortController.current.abort();
    }
    
    // Force stop WebRTC streams
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
    
    // Restore video element after short delay to allow for new streams
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.style.display = 'block';
        console.log('🔄 Video element restored for future use');
      }
    }, 1000);
  }, [videoRef, idleVideoRef, isAvatarTalking, pipelineState, interruptStream]);

  // Make abortTurn available to other components
  abortRef.current = abortTurn;

  const { sendMessage: sendToLLM } = useLLM({
    onResponse: (response) => {
      addConversationMessage('assistant', response);
      if (apiConfig) {
        // Create new abort controller for this D-ID stream
        didAbortController.current = new AbortController();
        setIsAvatarTalking(true);
        sendStreamText(response, didAbortController.current);
      }
    }
  });

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
      formData.append('temperature', '0.0'); // More deterministic
      formData.append('prompt', 'Conversación en español'); // Context hint

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
            
            // Filter out common artifacts
            const isArtifact = transcription.toLowerCase().includes('gracias por ver') ||
                              transcription.toLowerCase().includes('en español') ||
                              transcription.toLowerCase() === 'gracias';
            
            if (!isArtifact) {
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
      
      // Barge-in: Stop avatar if talking when user starts speaking
      if (isAvatarTalking) {
        console.log('🛑 BARGE-IN DETECTED - Avatar was talking, calling abort function');
        console.log('🛑 Current video state:', videoRef.current ? 'exists' : 'null');
        console.log('🛑 Current idle video state:', idleVideoRef.current ? 'exists' : 'null');
        abortRef.current(); // Call centralized abort
      } else {
        console.log('🎤 Normal voice detection - avatar not talking');
      }
      
      // Start new recording turn
      setPipelineState('processing');
    },
    onInterrupt: () => {
      console.log('🛑 INTERRUPT CALLBACK - Same as Stop button');
      abortRef.current(); // Direct call to abort function - same as Stop button
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
  }, []); // Remove dependencies to prevent loop

  useEffect(() => {
    // Listen for custom events from test script
    const handleSendStreamText = (event: any) => {
      if (apiConfig) {
        sendStreamText(event.detail);
      }
    };

    window.addEventListener('sendStreamText', handleSendStreamText);

    return () => {
      window.removeEventListener('sendStreamText', handleSendStreamText);
    };
  }, [apiConfig, sendStreamText]);

  const addConversationMessage = (role: 'user' | 'assistant' | 'system', content: string) => {
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
  };

  const processUserMessage = async (userMessage: string) => {
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
    
    // Send to LLM with a small delay for visual feedback
    setTimeout(() => {
      sendToLLM(messages, llmAbortController.current ?? undefined);
    }, 1000);
  };

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
        // Start Voice Activity Detection instead of manual recording
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

  const handleDisconnect = () => {
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
    
    console.log('🧪 Test setup complete - try speaking to interrupt the avatar');
  }, [isConnected, apiConfig, sendStreamText]);

  // Manual interrupt test - simulate user speaking during avatar response
  const testManualInterrupt = useCallback(() => {
    console.log('🧪 MANUAL INTERRUPT TEST - Simulating user voice during avatar speech');
    
    if (isAvatarTalking) {
      console.log('🛑 Manually triggering abort function');
      abortRef.current();
    } else {
      console.log('❌ Avatar not currently talking - start a response first');
    }
  }, [isAvatarTalking]);

  // Track latency when stream is done
  useEffect(() => {
    if (streamEvent === 'done' && latencyStart) {
      const currentLatency = Date.now() - latencyStart;
      setLatency(currentLatency);
      setLatencyStart(null);
    }
  }, [streamEvent, latencyStart]);

  // Track avatar talking state based on streaming events
  useEffect(() => {
    if (streamEvent === 'done' || streamEvent === 'error') {
      setIsAvatarTalking(false);
      console.log('🔇 Avatar finished speaking');
    } else if (streamEvent === 'started') {
      setIsAvatarTalking(true);
      console.log('🗣️ Avatar started speaking');
    }
  }, [streamEvent]);

  return (
    <div className="h-screen w-full bg-dark-slate font-inter text-slate-200 overflow-hidden flex flex-col">
      {/* Header - Fixed at top */}
      <header className="flex-shrink-0 w-full bg-slate-800/50 backdrop-blur-sm border-b border-slate-700 px-4 py-3">
        <div className="flex items-center justify-between max-w-7xl mx-auto w-full">
          <div className="flex items-center space-x-3 flex-shrink-0">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">AI</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-white truncate">Alex</h1>
              <p className="text-sm text-slate-400 hidden sm:block truncate">D-ID AI Assistant</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 flex-shrink-0">
            <div className="flex items-center space-x-2 text-sm">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
              <span className="text-slate-300 hidden sm:inline whitespace-nowrap">{isConnected ? 'Connected' : 'Ready'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content - Flexible layout */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Avatar Section */}
        <div className="flex-1 lg:flex-shrink-0 flex flex-col justify-center items-center p-4 overflow-y-auto">
          <div className="w-full max-w-md mx-auto">
            <AvatarVideo
              videoRef={videoRef}
              idleVideoRef={idleVideoRef}
              streamingState={streamingState}
              isStreamReady={isStreamReady}
              isRecording={isRecording}
            />

            <div className="mt-4 space-y-4">
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
                onManualInterrupt={testManualInterrupt}
              />
              
              {/* Audio Test Panel - for debugging */}
              <AudioTestPanel 
                onAudioTest={(audioBlob) => {
                  console.log('🧪 Test audio captured, processing with STT...');
                  processAudioWithGroq(audioBlob);
                }}
              />
            </div>
          </div>
        </div>

        {/* Conversation Panel */}
        <div className="w-full lg:w-96 lg:flex-shrink-0 flex">
          <ConversationPanel
            conversationHistory={conversationHistory}
            currentTranscription={currentTranscription}
            isRecording={isRecording}
            isConnected={isConnected}
            apiConfig={apiConfig}
            onManualSend={handleManualSend}
          />
        </div>
      </main>
    </div>
  );
}
