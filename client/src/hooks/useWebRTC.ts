import { useRef, useState, useCallback, useEffect } from 'react';
import { connectToWebSocket, sendMessage } from '@/lib/didApi';

export function useWebRTC() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const idleVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const webSocketRef = useRef<WebSocket | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const [connectionState, setConnectionState] = useState('');
  const [iceConnectionState, setIceConnectionState] = useState('');
  const [iceGatheringState, setIceGatheringState] = useState('');
  const [signalingState, setSignalingState] = useState('');
  const [streamingState, _setStreamingState] = useState<'empty'|'streaming'|'cancelling'>('empty');
  const streamingStateRef = useRef<'empty'|'streaming'|'cancelling'>('empty');
  const cancellingRef = useRef(false);

  // Synchronous setter that updates ref immediately and state asynchronously
  const setStreamingState = useCallback((next: 'empty'|'streaming'|'cancelling') => {
    streamingStateRef.current = next;   // ref updated synchronously
    _setStreamingState(next);           // React state (async)
  }, []);
  const [streamEvent, setStreamEvent] = useState('');
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastBytesReceived, setLastBytesReceived] = useState(0);
  const [videoIsPlaying, setVideoIsPlaying] = useState(false);

  const onIceGatheringStateChange = useCallback(() => {
    if (peerConnectionRef.current) {
      setIceGatheringState(peerConnectionRef.current.iceGatheringState);
    }
  }, []);

  const onIceCandidate = useCallback((event: RTCPeerConnectionIceEvent) => {
    console.log('onIceCandidate', event);
    if (event.candidate) {
      const { candidate, sdpMid, sdpMLineIndex } = event.candidate;
      sendMessage(webSocketRef.current, {
        type: 'ice',
        payload: {
          session_id: sessionId,
          candidate,
          sdpMid,
          sdpMLineIndex,
        },
      });
    } else {
      sendMessage(webSocketRef.current, {
        type: 'ice',
        payload: {
          stream_id: streamId,
          session_id: sessionId,
          presenter_type: 'clip',
        },
      });
    }
  }, [sessionId, streamId]);

  const onIceConnectionStateChange = useCallback(() => {
    if (peerConnectionRef.current) {
      const state = peerConnectionRef.current.iceConnectionState;
      setIceConnectionState(state);
      if (state === 'failed' || state === 'closed') {
        stopAllStreams();
        closePC();
      }
    }
  }, []);

  const onConnectionStateChange = useCallback(() => {
    if (peerConnectionRef.current) {
      const state = peerConnectionRef.current.connectionState;
      setConnectionState(state);
      
      if (state === 'connected') {
        setIsStreamReady(true);
        // Fallback mechanism for stream ready
        setTimeout(() => {
          if (!isStreamReady) {
            console.log('forcing stream/ready');
            setIsStreamReady(true);
            setStreamEvent('ready');
          }
        }, 5000);
      }
    }
  }, [isStreamReady]);

  const onSignalingStateChange = useCallback(() => {
    if (peerConnectionRef.current) {
      setSignalingState(peerConnectionRef.current.signalingState);
    }
  }, []);

  const onVideoStatusChange = useCallback((videoIsPlaying: boolean, stream?: MediaStream) => {
    let status: 'empty' | 'streaming' = videoIsPlaying ? 'streaming' : 'empty';
    
    if (videoIsPlaying && stream && videoRef.current) {
      const video = videoRef.current;
      
      // Avoid interrupting existing playback
      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }
      
      video.muted = false;
      video.playsInline = true;
      video.autoplay = true;
      
      // Use a more robust play mechanism
      const playVideo = async () => {
        try {
          if (video.paused && video.readyState >= 2) {
            await video.play();
          }
        } catch (error: any) {
          if (error.name !== 'AbortError') {
            console.log('Video play failed:', error);
          }
          // Retry after a short delay for non-abort errors
          if (error.name !== 'AbortError') {
            setTimeout(() => {
              if (video.paused) {
                video.play().catch(() => {});
              }
            }, 100);
          }
        }
      };
      
      if (video.readyState >= 2) {
        playVideo();
      } else {
        video.addEventListener('loadeddata', playVideo, { once: true });
      }
    }

    setStreamingState(status as 'empty' | 'streaming');
  }, []);

  const onTrack = useCallback((event: RTCTrackEvent) => {
    if (!event.track) return;

    statsIntervalRef.current = setInterval(async () => {
      if (peerConnectionRef.current) {
        const stats = await peerConnectionRef.current.getStats(event.track);
        stats.forEach((report) => {
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            const currentVideoIsPlaying = report.bytesReceived > lastBytesReceived;
            const videoStatusChanged = videoIsPlaying !== currentVideoIsPlaying;

            if (videoStatusChanged) {
              setVideoIsPlaying(currentVideoIsPlaying);
              onVideoStatusChange(currentVideoIsPlaying, event.streams[0]);
            }
            setLastBytesReceived(report.bytesReceived);
          }
        });
      }
    }, 500);
  }, [lastBytesReceived, videoIsPlaying, onVideoStatusChange]);

  const onStreamEvent = useCallback((message: MessageEvent) => {
    if (dataChannelRef.current?.readyState === 'open') {
      let status;
      const [event] = message.data.split(':');

      switch (event) {
        case 'stream/started':
          status = 'started';
          setStreamingState('streaming');
          break;
        case 'stream/done':
          status = 'done';
          setStreamingState('empty'); // Update state immediately
          console.log('🔄 Stream state updated to empty via stream/done');
          // Libera promesas que esperaban el 'done'
          pendingDoneResolvers.current.forEach(r => r());
          pendingDoneResolvers.current = [];
          break;
        case 'stream/ready':
          status = 'ready';
          break;
        case 'stream/error':
          status = 'error';
          setStreamingState('empty'); // Update state immediately
          // Libera promesas que esperaban el 'done'
          pendingDoneResolvers.current.forEach(r => r());
          pendingDoneResolvers.current = [];
          break;
        default:
          status = 'dont-care';
          break;
      }

      if (status === 'ready') {
        setTimeout(() => {
          console.log('stream/ready');
          setIsStreamReady(true);
          setStreamEvent('ready');
        }, 1000);
      } else {
        console.log(event);
        setStreamEvent(status === 'dont-care' ? event : status);
      }
    }
  }, []);

  const createPeerConnection = useCallback(async (offer: RTCSessionDescriptionInit, iceServers: RTCIceServer[]) => {
    if (!peerConnectionRef.current) {
      peerConnectionRef.current = new RTCPeerConnection({ iceServers });
      dataChannelRef.current = peerConnectionRef.current.createDataChannel('JanusDataChannel');
      
      peerConnectionRef.current.addEventListener('icegatheringstatechange', onIceGatheringStateChange);
      peerConnectionRef.current.addEventListener('icecandidate', onIceCandidate);
      peerConnectionRef.current.addEventListener('iceconnectionstatechange', onIceConnectionStateChange);
      peerConnectionRef.current.addEventListener('connectionstatechange', onConnectionStateChange);
      peerConnectionRef.current.addEventListener('signalingstatechange', onSignalingStateChange);
      peerConnectionRef.current.addEventListener('track', onTrack);
      dataChannelRef.current.addEventListener('message', onStreamEvent);
    }

    await peerConnectionRef.current.setRemoteDescription(offer);
    console.log('set remote sdp OK');

    const sessionClientAnswer = await peerConnectionRef.current.createAnswer();
    console.log('create local sdp OK');

    await peerConnectionRef.current.setLocalDescription(sessionClientAnswer);
    console.log('set local sdp OK');

    return sessionClientAnswer;
  }, [onIceGatheringStateChange, onIceCandidate, onIceConnectionStateChange, onConnectionStateChange, onSignalingStateChange, onTrack, onStreamEvent]);

  const stopAllStreams = useCallback(() => {
    if (videoRef.current?.srcObject) {
      console.log('stopping video streams');
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  }, []);

  const closePC = useCallback(() => {
    if (!peerConnectionRef.current) return;
    
    console.log('stopping peer connection');
    peerConnectionRef.current.close();
    peerConnectionRef.current.removeEventListener('icegatheringstatechange', onIceGatheringStateChange);
    peerConnectionRef.current.removeEventListener('icecandidate', onIceCandidate);
    peerConnectionRef.current.removeEventListener('iceconnectionstatechange', onIceConnectionStateChange);
    peerConnectionRef.current.removeEventListener('connectionstatechange', onConnectionStateChange);
    peerConnectionRef.current.removeEventListener('signalingstatechange', onSignalingStateChange);
    peerConnectionRef.current.removeEventListener('track', onTrack);
    
    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
    }
    
    // Reset states
    setIceGatheringState('');
    setSignalingState('');  
    setIceConnectionState('');
    setConnectionState('');
    
    peerConnectionRef.current = null;
    dataChannelRef.current = null;
  }, [onIceGatheringStateChange, onIceCandidate, onIceConnectionStateChange, onConnectionStateChange, onSignalingStateChange, onTrack]);

  const connect = useCallback(async (apiConfig: any) => {
    stopAllStreams();
    closePC();

    try {
      // Connect to D-ID WebSocket
      const ws = await connectToWebSocket(apiConfig.websocketUrl, apiConfig.key);
      webSocketRef.current = ws;

      // Initialize stream
      const initStreamMessage = {
        type: 'init-stream',
        payload: {
          presenter_id: 'v2_public_alex@qcvo4gupoy',
          driver_id: 'e3nbserss8',
          presenter_type: 'clip'
        }
      };
      sendMessage(ws, initStreamMessage);

      // Handle WebSocket messages
      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.messageType) {
          case 'init-stream':
            const { id: newStreamId, offer, ice_servers: iceServers, session_id: newSessionId } = data;
            setStreamId(newStreamId);
            setSessionId(newSessionId);
            console.log('D-ID stream initialized:', newStreamId, newSessionId);
            
            try {
              const sessionClientAnswer = await createPeerConnection(offer, iceServers);
              
              const sdpMessage = {
                type: 'sdp',
                payload: {
                  answer: sessionClientAnswer,
                  session_id: newSessionId,
                  presenter_type: 'clip'
                }
              };
              sendMessage(ws, sdpMessage);
              console.log('SDP answer sent to D-ID');
            } catch (e) {
              console.error('Error during streaming setup', e);
              stopAllStreams();
              closePC();
            }
            break;

          case 'sdp':
            console.log('SDP message received from D-ID');
            break;

          case 'delete-stream':
            console.log('Stream deleted from D-ID');
            break;
        }
      };

      return true;
    } catch (error) {
      console.error('Connection failed:', error);
      throw error;
    }
  }, [createPeerConnection, stopAllStreams, closePC]);

  const disconnect = useCallback(() => {
    if (webSocketRef.current) {
      const deleteMessage = {
        type: 'delete-stream',
        payload: {
          session_id: sessionId,
          stream_id: streamId
        }
      };
      sendMessage(webSocketRef.current, deleteMessage);
      
      webSocketRef.current.close();
      webSocketRef.current = null;
    }

    stopAllStreams();
    closePC();

    // Reset state
    setStreamId(null);
    setSessionId(null);
    setIsStreamReady(false);
    setStreamEvent('');
    setStreamingState('empty');
  }, [sessionId, streamId, stopAllStreams, closePC]);

  const sendStreamText = useCallback((text: string) => {
    if (cancellingRef.current || streamingState !== 'empty') {
      console.warn('Stream todavía cancelándose o no vacío, omite envío.');
      return;
    }

    if (!webSocketRef.current || !streamId || !sessionId) {
      console.error('D-ID connection not ready');
      return;
    }

    console.log('Sending text to D-ID avatar:', text);

    const streamMessage = {
      type: 'stream-text',
      payload: {
        script: {
          type: 'text',
          input: text,
          provider: {
            type: 'elevenlabs',
            voice_id: 'ucWwAruuGtBeHfnAaKcJ'
          },
          ssml: true
        },
        config: {
          stitch: true
        },
        background: {
          color: '#FFFFFF'
        },
        session_id: sessionId,
        stream_id: streamId,
        presenter_type: 'clip'
      }
    };

    sendMessage(webSocketRef.current, streamMessage);
    console.log('Text message sent to D-ID');
  }, [streamId, sessionId]);

  // Array to store pending stream completion resolvers
  const pendingDoneResolvers = useRef<(() => void)[]>([]);

  // Wait for real stream/done event - simplified and robust
  const waitForRealDone = useCallback((): Promise<void> => {
    // If already not streaming, resolve immediately
    if (streamingStateRef.current !== 'streaming') {
      console.log('Stream already finished, resolving immediately');
      return Promise.resolve();
    }

    return new Promise(resolve => {
      pendingDoneResolvers.current.push(resolve);
    });
  }, []);

  const cancelCurrentStream = useCallback(async (): Promise<void> => {
    if (!webSocketRef.current || !streamId || !sessionId || 
        cancellingRef.current || streamingStateRef.current !== 'streaming') {
      console.log('[cancel] No hay stream activo; omite.');
      return;
    }

    cancellingRef.current = true;
    console.log('🗑️ Cancelling current D-ID stream');

    // ⏹️ 1) Detén audio + video YA mismo
    if (peerConnectionRef.current) {
      peerConnectionRef.current.getReceivers()
        .forEach(r => r.track?.stop());
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // 🔄 Limpia el elemento <video> para que no quede congelado
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (idleVideoRef.current) {
      idleVideoRef.current.srcObject = null;
    }

    setStreamingState('empty'); // Set to empty after stopping tracks
    
    try {
      const deleteMessage = {
        type: 'delete-stream',
        payload: {
          session_id: sessionId,
          stream_id: streamId
        }
      };
      
      sendMessage(webSocketRef.current, deleteMessage);
      setStreamEvent('cancelled');
      
      // Wait for real stream/done event
      await waitForRealDone();
      console.log('✅ Stream cancellation confirmed');
    } catch (error) {
      console.error('Error during stream cancellation:', error);
    } finally {
      cancellingRef.current = false;
    }
  }, [streamId, sessionId, waitForRealDone]);

  return {
    connect,
    disconnect,
    sendStreamText,
    cancelCurrentStream,
    connectionState,
    iceConnectionState,
    iceGatheringState,
    signalingState,
    streamingState,
    streamEvent,
    isStreamReady,
    videoRef,
    idleVideoRef,
    currentStreamId: streamId,
    cancellingRef,
    streamingStateRef
  };
}
