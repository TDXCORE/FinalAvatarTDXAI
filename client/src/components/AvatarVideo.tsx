import { useEffect, RefObject } from "react";

interface AvatarVideoProps {
  videoRef: RefObject<HTMLVideoElement>;
  idleVideoRef: RefObject<HTMLVideoElement>;
  streamingState: string;
  isStreamReady: boolean;
  isRecording: boolean;
}

export default function AvatarVideo({
  videoRef,
  idleVideoRef,
  streamingState,
  isStreamReady,
  isRecording
}: AvatarVideoProps) {
  
  useEffect(() => {
    // Initialize idle video
    if (idleVideoRef.current) {
      idleVideoRef.current.src = '/alex_v2_idle.mp4';
      idleVideoRef.current.loop = true;
      idleVideoRef.current.muted = true;
      idleVideoRef.current.play().catch(e => console.log('Idle video play failed:', e));
    }
  }, [idleVideoRef]);

  const streamVideoOpacity = streamingState === 'streaming' && isStreamReady ? 1 : 0;
  const idleVideoOpacity = 1 - streamVideoOpacity;

  return (
    <div className="relative w-full flex flex-col items-center">
      {/* Avatar Container */}
      <div className="relative w-64 h-64 mx-auto mb-6">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-purple-600/20 rounded-full blur-xl"></div>
        <div className="relative w-full h-full bg-slate-800 rounded-full overflow-hidden border-4 border-slate-700 shadow-2xl">
          {/* Idle Video Element */}
          <video 
            ref={idleVideoRef}
            className="w-full h-full object-cover transition-opacity duration-300"
            autoPlay 
            loop 
            muted
            playsInline
            style={{ opacity: idleVideoOpacity }}
          />
          
          {/* Stream Video Element */}
          <video 
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
            autoPlay
            playsInline
            style={{ opacity: streamVideoOpacity }}
          />
          
          {/* Status Overlay */}
          <div className="absolute bottom-4 left-4 right-4">
            <div className="bg-black/50 backdrop-blur-sm rounded-lg px-3 py-2 text-center">
              <span className={`text-sm text-white streamingState-${streamingState}`}>
                {streamingState === 'streaming' ? 'Speaking' : 'Idle'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Voice Activity Indicator */}
      <div className="flex justify-center mb-4">
        <div className={`flex items-end space-x-1 h-8 ${isRecording ? 'block' : 'hidden'}`}>
          <div className="mic-bar"></div>
          <div className="mic-bar"></div>
          <div className="mic-bar"></div>
          <div className="mic-bar"></div>
          <div className="mic-bar"></div>
        </div>
      </div>
    </div>
  );
}
