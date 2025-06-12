import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import AvatarVideo from "@/components/AvatarVideo";
import ConversationPanel from "@/components/ConversationPanel";
import ControlPanel from "@/components/ControlPanel";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSTT } from "@/hooks/useSTT";
import { useLLM } from "@/hooks/useLLM";
import { useVoiceActivityDetection } from "@/hooks/useVoiceActivityDetection";
import { loadApiConfig, CONFIG } from "@/lib/config";

export default function ConversationalAvatar() {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
  }>>([]);
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [latency, setLatency] = useState<number | null>(null);
  const [apiConfig, setApiConfig] = useState<any>(null);
  const [latencyStart, setLatencyStart] = useState<number | null>(null);

  const {
    connect: connectWebRTC,
    disconnect: disconnectWebRTC,
    sendStreamText,
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

  const { sendMessage: sendToLLM } = useLLM({
    onResponse: (response) => {
      addConversationMessage('assistant', response);
      if (apiConfig) {
        sendStreamText(response);
      }
    }
  });

  // Voice Activity Detection for automatic conversation flow
  const { startVAD, stopVAD } = useVoiceActivityDetection({
    onSpeechEnd: async (audioBlob) => {
      console.log(`📦 Processing voice input: ${audioBlob.size} bytes`);
      
      // Process audio with Groq STT
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model', 'whisper-large-v3');
      formData.append('language', 'es');
      formData.append('response_format', 'json');

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
            console.log('🎯 Voice transcription:', data.text);
            processUserMessage(data.text);
          }
        }
      } catch (error) {
        console.error('Voice processing failed:', error);
      }
    },
    onSpeechStart: () => {
      console.log('🎤 Voice detected, listening...');
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
    setLatencyStart(Date.now());
    addConversationMessage('user', userMessage);
    
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

    await sendToLLM(messages);
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

  // Track latency when stream is done
  useEffect(() => {
    if (streamEvent === 'done' && latencyStart) {
      const currentLatency = Date.now() - latencyStart;
      setLatency(currentLatency);
      setLatencyStart(null);
    }
  }, [streamEvent, latencyStart]);

  return (
    <div className="min-h-screen w-full bg-dark-slate font-inter text-slate-200 overflow-x-hidden">
      {/* Header */}
      <header className="w-full bg-slate-800/50 backdrop-blur-sm border-b border-slate-700 px-3 sm:px-4 md:px-6 py-2 sm:py-3 md:py-4 mobile-safe-area">
        <div className="flex items-center justify-between max-w-7xl mx-auto w-full">
          <div className="flex items-center space-x-2 sm:space-x-3 flex-shrink-0">
            <div className="w-6 h-6 sm:w-8 sm:h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-xs sm:text-sm">AI</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg md:text-xl font-semibold text-white truncate">Alex</h1>
              <p className="text-xs sm:text-sm text-slate-400 hidden sm:block truncate">D-ID AI Assistant</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 sm:space-x-4 flex-shrink-0">
            <div className="flex items-center space-x-1 sm:space-x-2 text-xs sm:text-sm">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
              <span className="text-slate-300 hidden sm:inline whitespace-nowrap">{isConnected ? 'Connected' : 'Ready'}</span>
              <span className="text-slate-300 sm:hidden">{isConnected ? '●' : '○'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-col lg:flex-row flex-1 w-full min-h-0 relative">
        {/* Avatar Section */}
        <div className="flex-1 flex items-center justify-center p-3 sm:p-4 md:p-6 lg:p-8 w-full lg:w-auto">
          <div className="max-w-2xl w-full mx-auto">
            <AvatarVideo
              videoRef={videoRef}
              idleVideoRef={idleVideoRef}
              streamingState={streamingState}
              isStreamReady={isStreamReady}
              isRecording={isRecording}
            />

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
            />
          </div>
        </div>

        {/* Conversation Panel */}
        <div className="w-full lg:w-96 lg:flex-shrink-0">
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
