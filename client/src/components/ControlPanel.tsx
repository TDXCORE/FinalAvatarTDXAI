import { Button } from "@/components/ui/button";
import { Zap, Mic, MicOff, X } from "lucide-react";

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

  return (
    <div className="bg-slate-800/80 backdrop-blur-sm rounded-2xl p-6 border border-slate-700">
      <div className="flex justify-center space-x-4 mb-6">
        {/* Connect Button */}
        <Button 
          onClick={onConnect}
          disabled={isConnected}
          className="bg-blue-600 hover:bg-blue-700 px-8 py-3 font-medium shadow-lg hover:shadow-xl"
        >
          <Zap className="w-5 h-5 mr-2" />
          Connect
        </Button>

        {/* Start Conversation Button */}
        <Button 
          onClick={onStartConversation}
          disabled={!isConnected}
          className={`px-8 py-3 font-medium shadow-lg hover:shadow-xl ${
            isRecording 
              ? 'bg-red-600 hover:bg-red-700' 
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {isRecording ? <MicOff className="w-5 h-5 mr-2" /> : <Mic className="w-5 h-5 mr-2" />}
          {isRecording ? 'Stop Conversation' : 'Start Conversation'}
        </Button>

        {/* Disconnect Button */}
        <Button 
          onClick={onDisconnect}
          className="bg-red-600 hover:bg-red-700 px-8 py-3 font-medium shadow-lg hover:shadow-xl"
        >
          <X className="w-5 h-5 mr-2" />
          Disconnect
        </Button>
      </div>

      {/* Status Information */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-400">Peer Connection:</span>
            <span className={`font-medium peerConnectionState-${connectionState}`}>
              {connectionState || '-'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">ICE Connection:</span>
            <span className={`font-medium iceConnectionState-${iceConnectionState}`}>
              {iceConnectionState || '-'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">ICE Gathering:</span>
            <span className={`font-medium iceGatheringState-${iceGatheringState}`}>
              {iceGatheringState || '-'}
            </span>
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-slate-400">Signaling:</span>
            <span className={`font-medium signalingState-${signalingState}`}>
              {signalingState || '-'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Stream Event:</span>
            <span className={`font-medium streamEvent-${streamEvent}`}>
              {streamEvent || '-'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Latency:</span>
            <span className="font-medium text-green-400">
              {latency ? `${latency}ms` : '-'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
