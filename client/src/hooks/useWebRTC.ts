import { useRef, useState, useCallback } from 'react';
import { connectToWebSocket, sendMessage } from '@/lib/didApi';

// Helper function to ensure WebSocket connection is open
export async function ensureSocketOpen(webSocketRef: React.MutableRefObject<WebSocket | null>, connectFn: () => Promise<void>) {
  if (!webSocketRef.current || webSocketRef.current.readyState !== WebSocket.OPEN) {
    await connectFn();
  }
}

// Wait for stream ready state
async function waitForReady(isStreamReadyRef: React.MutableRefObject<boolean>, timeout = 4000): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (isStreamReadyRef.current) return resolve(true);
      if (Date.now() - start > timeout) return reject(new Error('ready timeout'));
      requestAnimationFrame(check);
    };
    check();
  });
}

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
  const [streamingState, setStreamingState] = useState('empty');
  const [streamEvent, setStreamEvent] = useState('');
  const [isStreamReady, setIsStreamReady] = useState(false);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const isStreamReadyRef = useRef<boolean>(false);
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
        // Removed forced stream ready fallback - wait for real events only
      }
    }
  }, [isStreamReady]);

  const onSignalingStateChange = useCallback(() => {
    if (peerConnectionRef.current) {
      setSignalingState(peerConnectionRef.current.signalingState);
    }
  }, []);

  const onVideoStatusChange = useCallback((videoIsPlaying: boolean, stream?: MediaStream) => {
    let status = videoIsPlaying ? 'streaming' : 'empty';
    
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

    setStreamingState(status);
  }, []);

  const onTrack = useCallback((event: RTCTrackEvent) => {
    if (!event.track) return;

    // Set video stream source and ensure it's ready for playback
    if (event.streams && event.streams[0] && videoRef.current) {
      console.log('🎥 Setting video stream source');
      videoRef.current.srcObject = event.streams[0];
      
      // Ensure video element is properly configured for new stream
      videoRef.current.style.opacity = '1';
      videoRef.current.style.display = 'block';
      
      // Hide idle video when new stream arrives
      if (idleVideoRef.current) {
        idleVideoRef.current.style.opacity = '0';
      }
      
      // Force video to load new stream
      videoRef.current.load();
      
      console.log('🎥 Video element prepared for new stream');
    }

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
          break;
        case 'stream/done':
          status = 'done';
          break;
        case 'stream/ready':
          status = 'ready';
          break;
        case 'stream/error':
          status = 'error';
          break;
        default:
          status = 'dont-care';
          break;
      }

      if (status === 'ready') {
        console.log('stream/ready');
        isStreamReadyRef.current = true;
        setIsStreamReady(true);
        setStreamEvent('ready');
      } else if (status === 'started') {
        isStreamReadyRef.current = false;
        setIsStreamReady(false);
        setStreamEvent(status);
      } else if (['done', 'error'].includes(status)) {
        isStreamReadyRef.current = true;
        setIsStreamReady(true);
        setStreamEvent(status);
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
      
      // Add WebSocket event listeners for debugging and prevent unwanted closures
      ws.onclose = (event) => {
        console.log('🔌 D-ID WebSocket closed:', event.code, event.reason);
        // Mark WebSocket as null to prevent further usage
        webSocketRef.current = null;
      };
      
      ws.onerror = (error) => {
        console.error('🔌 D-ID WebSocket error:', error);
      };
      
      // Keep connection alive with periodic heartbeat
      const heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        } else {
          clearInterval(heartbeatInterval);
        }
      }, 30000); // Send ping every 30 seconds

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
            streamIdRef.current = newStreamId;
            setSessionId(newSessionId);
            console.log('D-ID stream initialized:', newStreamId, newSessionId);
            // Set ready state immediately after getting new streamId
            isStreamReadyRef.current = true;
            setIsStreamReady(true);
            
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
            
          case 'stream/ready':
            console.log('Stream ready event received from WebSocket');
            streamIdRef.current = data.streamId || streamId;
            isStreamReadyRef.current = true;
            setIsStreamReady(true);
            break;
            
          case 'stream/started':
            console.log('Stream started from WebSocket');
            isStreamReadyRef.current = false;
            setIsStreamReady(false);
            break;
            
          case 'stream/done':
          case 'stream/stopped':
          case 'stream/error':
            console.log('Stream finished from WebSocket:', data.messageType);
            isStreamReadyRef.current = true;
            setIsStreamReady(true);
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
    console.log('🔌 Disconnect initiated - closing D-ID session');
    if (webSocketRef.current && streamIdRef.current) {
      const deleteMessage = {
        type: 'delete-stream',
        payload: {
          session_id: sessionId,
          stream_id: streamIdRef.current
        }
      };
      sendMessage(webSocketRef.current, deleteMessage);
      streamIdRef.current = null;
      
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
  }, [sessionId, stopAllStreams, closePC]);

  // Soft reset for maintaining connection between conversations
  const softReset = useCallback(() => {
    console.log('🔄 Soft reset - maintaining D-ID connection');
    console.log('🔄 Preserving session:', sessionId, 'stream:', streamId);
    // Only reset UI state, preserve session/stream IDs for continuous conversation
    setStreamEvent('');
    setStreamingState('empty');
    // Don't reset isStreamReady - keep it true to allow immediate next response
    // setIsStreamReady(false); // Comment out to maintain readiness
  }, [sessionId, streamId]);

  const sendStreamText = useCallback(async (text: string, abortController?: AbortController) => {
    console.log('🎯 sendStreamText called with:', text);
    
    // Ensure WebSocket connection is open
    if (!webSocketRef.current || webSocketRef.current.readyState !== WebSocket.OPEN) {
      console.error('❌ D-ID WebSocket not open:', webSocketRef.current?.readyState);
      return;
    }
    
    if (!streamId || !sessionId) {
      console.error('❌ D-ID session not ready - missing:', {
        streamId: !!streamId,
        sessionId: !!sessionId
      });
      return;
    }

    // Clean previous stream and wait for new ready state
    if (streamIdRef.current) {
      console.log('🔒 Cleaning previous stream:', streamIdRef.current);
      const deleteMessage = {
        type: 'delete-stream',
        payload: {
          session_id: sessionId,
          stream_id: streamIdRef.current
        }
      };
      sendMessage(webSocketRef.current, deleteMessage);
      streamIdRef.current = null;
      setStreamId(null);
      isStreamReadyRef.current = false;
      setIsStreamReady(false);

      // NUEVO: solicita stream nuevo
      const initStreamMessage = {
        type: 'init-stream',
        payload: {
          source_url: 'https://cloudflare-ipfs.com/ipfs/QmQ6gV8o3LqMzjLHV7ivCEp5CGhmFyNvR4KQJfpfDgj1d6',
          voice_id: 'VJDM6h2UlTvT5qgGHZPj',
          voice: {
            type: 'voice_id',
            voice_id: 'VJDM6h2UlTvT5qgGHZPj',
            voice_config: {
              pitch: 1,
              speed: 1.2,
              volume: 1
            }
          },
          config: {
            stream_warmup: true,
            stitch: true,
            fluent: true
          },
          driver_id: 'e3nbserss8',
          presenter_type: 'clip'
        }
      };
      sendMessage(webSocketRef.current, initStreamMessage);
      
      try {
        await waitForReady(isStreamReadyRef);
        console.log('✅ New stream ready after cleanup');
      } catch (error) {
        console.error('❌ Timeout waiting for stream ready');
        return;
      }
    }

    console.log('🎯 Sending text to D-ID avatar:', text);
    
    // Ensure we have a valid streamId before proceeding
    if (!streamId) {
      console.error('❌ No streamId available - cannot send text');
      return;
    }
    
    // Check if stream is ready before sending
    if (!isStreamReadyRef.current) {
      console.warn('⏳ Stream busy, cannot send text');
      return;
    }

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

    // Store abort controller for potential interruption
    if (abortController && abortController.signal) {
      abortController.signal.addEventListener('abort', () => {
        console.log('🛑 D-ID stream aborted - stopping video immediately');
        
        // Immediately stop video playback but preserve srcObject
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.currentTime = 0;
          videoRef.current.style.opacity = '0';
          // Don't clear srcObject - keep connection for future streams
        }
        
        // Show idle video
        if (idleVideoRef.current) {
          idleVideoRef.current.style.opacity = '1';
        }
        
        // Only interrupt stream - no pause to avoid blocking future responses
        if (webSocketRef.current && sessionId && streamId) {
          const interruptMessage = {
            type: 'stream-interrupt',
            payload: {
              session_id: sessionId,
              stream_id: streamId
            }
          };
          sendMessage(webSocketRef.current, interruptMessage);
          // Removed manual setIsStreamReady - wait for proper stream/ready event
        }
        
        // Force stop all video streams
        if (peerConnectionRef.current) {
          const receivers = peerConnectionRef.current.getReceivers();
          receivers.forEach(receiver => {
            if (receiver.track) {
              receiver.track.stop();
            }
          });
        }
      });
    }

    sendMessage(webSocketRef.current, streamMessage);
    console.log('Text message sent to D-ID');
  }, [streamId, sessionId, videoRef, idleVideoRef]);

  const stopVideo = useCallback(() => {
    // Immediately stop video playback
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      console.log('🛑 Video playback stopped');
    }
    
    // Show idle video immediately
    if (idleVideoRef.current) {
      idleVideoRef.current.style.display = 'block';
      if (videoRef.current) {
        videoRef.current.style.display = 'none';
      }
    }
    
    setStreamingState('empty');
    setVideoIsPlaying(false);
  }, []);

  const interruptStream = useCallback(() => {
    console.log('🛑 Interrupting D-ID stream and video playback');
    
    // Immediately stop video playback
    stopVideo();
    
    // Send interrupt message to D-ID if connection is available
    if (webSocketRef.current && streamIdRef.current) {
      const interruptMessage = {
        type: 'stream-interrupt',
        payload: {
          session_id: sessionId,
          stream_id: streamIdRef.current
        }
      };
      sendMessage(webSocketRef.current, interruptMessage);
      console.log('Stream interrupt sent to D-ID');
      // Removed manual setIsStreamReady - wait for proper stream/ready event
    }
  }, [sessionId, stopVideo]);

  return {
    connect,
    disconnect,
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
  };
}
