import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send } from "lucide-react";

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface ConversationPanelProps {
  conversationHistory: Message[];
  currentTranscription: string;
  isRecording: boolean;
  isConnected: boolean;
  apiConfig: any;
  onManualSend: (message: string) => void;
}

export default function ConversationPanel({
  conversationHistory,
  currentTranscription,
  isRecording,
  isConnected,
  apiConfig,
  onManualSend
}: ConversationPanelProps) {
  const [manualInput, setManualInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversationHistory]);

  const handleSendManual = () => {
    if (manualInput.trim()) {
      onManualSend(manualInput);
      setManualInput('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSendManual();
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'connected': return 'bg-green-500';
      case 'connecting': return 'bg-yellow-500';
      case 'error': return 'bg-red-500';
      case 'ready': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = (connected: boolean, status?: string) => {
    if (connected) return 'Connected';
    if (status === 'connecting') return 'Connecting';
    if (status === 'error') return 'Error';
    return 'Disconnected';
  };

  return (
    <div className="w-96 bg-slate-800/50 backdrop-blur-sm border-l border-slate-700 flex flex-col">
      {/* Panel Header */}
      <div className="p-6 border-b border-slate-700">
        <h2 className="text-lg font-semibold text-white mb-2">Conversation</h2>
        <p className="text-sm text-slate-400">Real-time AI conversation with Alex</p>
      </div>

      {/* Conversation History */}
      <div 
        ref={scrollRef}
        className="flex-1 p-6 overflow-y-auto conversation-scroll"
      >
        <div className="space-y-4">
          {conversationHistory.map((message, index) => {
            const isUser = message.role === 'user';
            const isSystem = message.role === 'system';
            
            return (
              <div key={index} className="flex items-start space-x-3 animate-in fade-in duration-300">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isUser 
                    ? 'bg-gradient-to-br from-green-500 to-emerald-600' 
                    : isSystem 
                    ? 'bg-gradient-to-br from-gray-500 to-gray-600' 
                    : 'bg-gradient-to-br from-purple-500 to-blue-600'
                }`}>
                  <span className="text-white font-bold text-xs">
                    {isUser ? 'U' : isSystem ? 'S' : 'AI'}
                  </span>
                </div>
                <div className="flex-1">
                  <div className="bg-slate-700/50 rounded-lg px-4 py-3">
                    <p className="text-sm text-slate-200">{message.content}</p>
                  </div>
                  <span className="text-xs text-slate-500 mt-1 block">
                    {message.timestamp.toLocaleTimeString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Transcription Display */}
        {currentTranscription && (
          <div className="mt-4 p-3 bg-blue-900/20 border border-blue-800/30 rounded-lg">
            <div className="flex items-center space-x-2 mb-2">
              <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
              <span className="text-xs text-blue-300 font-medium">Listening...</span>
            </div>
            <p className="text-sm text-slate-300 italic">{currentTranscription}</p>
          </div>
        )}
      </div>

      {/* Manual Input */}
      <div className="p-6 border-t border-slate-700">
        <div className="space-y-3">
          <label className="text-sm font-medium text-slate-300">Manual Input (Fallback)</label>
          <div className="flex space-x-2">
            <Input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message here..."
              className="flex-1 bg-slate-700 border-slate-600 text-white placeholder-slate-400"
            />
            <Button 
              onClick={handleSendManual}
              disabled={!isConnected || !manualInput.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* API Configuration Panel */}
      <div className="p-6 border-t border-slate-700 bg-slate-900/50">
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-slate-300 hover:text-white">
            <span>API Configuration</span>
            <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="mt-3 space-y-3 text-xs">
            <div>
              <label className="block text-slate-400 mb-1">D-ID Status</label>
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${getStatusColor(isConnected ? 'connected' : 'disconnected')}`}></div>
                <span className="text-slate-300">{getStatusText(isConnected)}</span>
              </div>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Groq STT Status</label>
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${getStatusColor(isRecording ? 'connected' : 'disconnected')}`}></div>
                <span className="text-slate-300">{isRecording ? 'Recording' : 'Standby'}</span>
              </div>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Groq LLM Status</label>
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${getStatusColor('ready')}`}></div>
                <span className="text-slate-300">Ready</span>
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
