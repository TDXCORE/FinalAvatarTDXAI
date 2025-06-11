import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import AvatarVideo from "@/components/AvatarVideo";
import ConversationPanel from "@/components/ConversationPanel";
import ControlPanel from "@/components/ControlPanel";
import { useWebRTC } from "@/hooks/useWebRTC";
import { useSTT } from "@/hooks/useSTT";
import { useLLM } from "@/hooks/useLLM";
import { loadApiConfig } from "@/lib/config";

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

  useEffect(() => {
    const initializeApp = async () => {
      try {
        const config = await loadApiConfig();
        setApiConfig(config);
        addConversationMessage('system', 'Welcome! Click "Connect" to start your conversation with Alex.');
      } catch (error) {
        console.error('Failed to load API configuration:', error);
        addConversationMessage('system', 'Error: Please configure your API keys in the api.json file.');
      }
    };

    // Listen for custom events from test script
    const handleSendStreamText = (event: any) => {
      if (apiConfig) {
        sendStreamText(event.detail);
      }
    };

    window.addEventListener('sendStreamText', handleSendStreamText);
    initializeApp();

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
    
    const messages = [
      {
        role: 'system' as const,
        content: 'You are Alex, a helpful AI assistant. Keep responses concise and natural for voice conversation. Limit to 2-3 sentences.'
      },
      ...conversationHistory
        .filter(msg => msg.role !== 'system')
        .map(msg => ({
          role: msg.role,
          content: msg.content
        }))
    ];

    await sendToLLM(messages);
  };

  const handleConnect = async () => {
    if (!apiConfig) {
      addConversationMessage('system', 'Error: API configuration not loaded');
      return;
    }

    try {
      await connectWebRTC(apiConfig);
      setIsConnected(true);
      addConversationMessage('system', 'Connected to AI assistant. You can now start a conversation.');
    } catch (error) {
      console.error('Connection failed:', error);
      addConversationMessage('system', 'Error: Failed to connect to AI service. Please check your API configuration.');
    }
  };

  const handleStartConversation = async () => {
    if (!isRecording) {
      try {
        await startRecording();
        setIsRecording(true);
        addConversationMessage('system', 'Listening... You can now speak to Alex.');
      } catch (error) {
        console.error('Failed to start recording:', error);
        addConversationMessage('system', 'Error: Could not access microphone. Please check permissions.');
      }
    } else {
      stopRecording();
      setIsRecording(false);
    }
  };

  const handleDisconnect = () => {
    disconnectWebRTC();
    stopRecording();
    setIsConnected(false);
    setIsRecording(false);
    setCurrentTranscription('');
    setConversationHistory([]);
    setLatency(null);
    addConversationMessage('system', 'Disconnected from AI assistant.');
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
    <div className="min-h-screen bg-dark-slate font-inter text-slate-200">
      {/* Header */}
      <header className="bg-slate-800/50 backdrop-blur-sm border-b border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-sm">AI</span>
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">Conversational Avatar Alex</h1>
              <p className="text-sm text-slate-400">D-ID AI Assistant</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`}></div>
              <span className="text-slate-300">{isConnected ? 'Connected' : 'Ready to Connect'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex flex-1">
        {/* Avatar Section */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-2xl w-full">
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
        <ConversationPanel
          conversationHistory={conversationHistory}
          currentTranscription={currentTranscription}
          isRecording={isRecording}
          isConnected={isConnected}
          apiConfig={apiConfig}
          onManualSend={handleManualSend}
        />
      </main>
    </div>
  );
}
