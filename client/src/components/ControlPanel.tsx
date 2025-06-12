import { Button } from "@/components/ui/button";
import { Zap, Mic, MicOff, X, TestTube } from "lucide-react";
import { useAudioTest } from "@/hooks/useAudioTest";

interface ControlPanelProps {
  isConnected: boolean;
  isRecording: boolean;
  connectionState: string;
  iceConnectionState: string;
  iceGatheringState: string;
  signalingState: string;
  streamingState: string;
  streamEvent: string;
  latency: number | null;
  sttStatus: string;
  onConnect: () => void;
  onStartConversation: () => void;
  onDisconnect: () => void;
  onTestBargein?: () => void;
}

export default function ControlPanel({
  isConnected,
  isRecording,
  connectionState,
  iceConnectionState,
  iceGatheringState,
  signalingState,
  streamingState,
  streamEvent,
  latency,
  sttStatus,
  onConnect,
  onStartConversation,
  onDisconnect
}: ControlPanelProps) {
  const { runFullTest } = useAudioTest();

  return (
    <div className="bg-slate-800/80 backdrop-blur-sm rounded-2xl p-4 border border-slate-700 w-full">
      {/* Buttons - Grid layout for mobile */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Connect Button */}
        <Button 
          onClick={onConnect}
          disabled={isConnected}
          className="bg-blue-600 hover:bg-blue-700 px-4 py-3 font-medium shadow-lg hover:shadow-xl text-sm"
        >
          <Zap className="w-4 h-4 mr-2" />
          Connect
        </Button>

        {/* Start Conversation Button */}
        <Button 
          onClick={onStartConversation}
          disabled={!isConnected}
          className={`px-4 py-3 font-medium shadow-lg hover:shadow-xl text-sm ${
            isRecording 
              ? 'bg-red-600 hover:bg-red-700' 
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {isRecording ? <MicOff className="w-4 h-4 mr-2" /> : <Mic className="w-4 h-4 mr-2" />}
          {isRecording ? 'Stop' : 'Talk'}
        </Button>

        {/* Test Pipeline Button */}
        <Button 
          onClick={runFullTest}
          className="bg-purple-600 hover:bg-purple-700 px-4 py-3 font-medium shadow-lg hover:shadow-xl text-sm"
          title="Test complete audio pipeline"
        >
          <TestTube className="w-4 h-4 mr-2" />
          Test
        </Button>

        {/* Disconnect Button */}
        <Button 
          onClick={onDisconnect}
          className="bg-red-600 hover:bg-red-700 px-4 py-3 font-medium shadow-lg hover:shadow-xl text-sm"
        >
          <X className="w-4 h-4 mr-2" />
          End
        </Button>
      </div>

      {/* Status Information - Collapsible */}
      <details className="group">
        <summary className="flex items-center justify-between cursor-pointer text-sm font-medium text-slate-300 hover:text-white mb-3">
          <span>Connection Status</span>
          <svg className="w-4 h-4 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400">Peer:</span>
              <span className={`font-medium peerConnectionState-${connectionState} truncate ml-2`}>
                {connectionState || '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">ICE:</span>
              <span className={`font-medium iceConnectionState-${iceConnectionState} truncate ml-2`}>
                {iceConnectionState || '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Gather:</span>
              <span className={`font-medium iceGatheringState-${iceGatheringState} truncate ml-2`}>
                {iceGatheringState || '-'}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400">Signal:</span>
              <span className={`font-medium signalingState-${signalingState} truncate ml-2`}>
                {signalingState || '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Stream:</span>
              <span className={`font-medium streamEvent-${streamEvent} truncate ml-2`}>
                {streamEvent || '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Latency:</span>
              <span className="font-medium text-green-400 truncate ml-2">
                {latency ? `${latency}ms` : '-'}
              </span>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
