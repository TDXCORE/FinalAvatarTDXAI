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
    <div className="bg-slate-800/80 backdrop-blur-sm rounded-2xl p-3 sm:p-4 md:p-6 border border-slate-700">
      {/* Buttons - Stack on mobile, grid on larger screens */}
      <div className="flex flex-col sm:grid sm:grid-cols-2 lg:flex lg:flex-row lg:justify-center gap-2 sm:gap-3 mb-4 sm:mb-6">
        {/* Connect Button */}
        <Button 
          onClick={onConnect}
          disabled={isConnected}
          className="bg-blue-600 hover:bg-blue-700 px-3 sm:px-4 md:px-6 py-2 sm:py-3 font-medium shadow-lg hover:shadow-xl text-xs sm:text-sm"
        >
          <Zap className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
          <span className="hidden sm:inline">Connect</span>
          <span className="sm:hidden">Connect</span>
        </Button>

        {/* Start Conversation Button */}
        <Button 
          onClick={onStartConversation}
          disabled={!isConnected}
          className={`px-3 sm:px-4 md:px-6 py-2 sm:py-3 font-medium shadow-lg hover:shadow-xl text-xs sm:text-sm ${
            isRecording 
              ? 'bg-red-600 hover:bg-red-700' 
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {isRecording ? <MicOff className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" /> : <Mic className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />}
          <span className="hidden md:inline">{isRecording ? 'Stop Voice Detection' : 'Start Conversation'}</span>
          <span className="md:hidden">{isRecording ? 'Stop' : 'Talk'}</span>
        </Button>

        {/* Test Pipeline Button */}
        <Button 
          onClick={runFullTest}
          className="bg-purple-600 hover:bg-purple-700 px-3 sm:px-4 md:px-6 py-2 sm:py-3 font-medium shadow-lg hover:shadow-xl text-xs sm:text-sm"
          title="Test complete audio pipeline"
        >
          <TestTube className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
          <span className="hidden sm:inline">Test</span>
          <span className="sm:hidden">Test</span>
        </Button>

        {/* Disconnect Button */}
        <Button 
          onClick={onDisconnect}
          className="bg-red-600 hover:bg-red-700 px-3 sm:px-4 md:px-6 py-2 sm:py-3 font-medium shadow-lg hover:shadow-xl text-xs sm:text-sm"
        >
          <X className="w-3 h-3 sm:w-4 sm:h-4 mr-1 sm:mr-2" />
          <span className="hidden sm:inline">Disconnect</span>
          <span className="sm:hidden">End</span>
        </Button>
      </div>

      {/* Status Information - Hidden on small screens, collapsible on medium */}
      <div className="hidden sm:block">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4 text-xs sm:text-sm">
          <div className="space-y-1 sm:space-y-2">
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
          <div className="space-y-1 sm:space-y-2">
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
      </div>

      {/* Minimal status for mobile */}
      <div className="sm:hidden flex justify-center space-x-4 text-xs">
        <span className={`text-slate-400 ${isConnected ? 'text-green-400' : ''}`}>
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
        {latency && (
          <span className="text-green-400">{latency}ms</span>
        )}
      </div>
    </div>
  );
}
