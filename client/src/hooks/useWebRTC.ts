import { useRef, useState, useCallback } from 'react';
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
  const [streamingState, setStreamingState] = useState('empty');
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
    if (webSocketRef.current && streamId && sessionId) {
      const interruptMessage = {
        type: 'stream-interrupt',
        payload: {
          session_id: sessionId,
          stream_id: streamId
        }
      };
      sendMessage(webSocketRef.current, interruptMessage);
      console.log('Stream interrupt sent to D-ID');
    }
  }, [streamId, sessionId, stopVideo]);

  return {
    connect,
    disconnect,
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
