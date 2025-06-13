import { useRef, useState, useCallback, useEffect } from 'react';
import { connectToWebSocket, sendMessage } from '@/lib/didApi';

export function useWebRTC() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const idleVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const webSocketRef = useRef<WebSocket | null>(null);
  const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingMsgRef = useRef<string | null>(null);
  const pendingDoneResolvers = useRef<(() => void)[]>([]);
  const apiConfigRef = useRef<any>(null);
  const didAbortController = useRef<AbortController | null>(null);
  
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
  
  // Remote video stream management
  const currentRemoteStream = useRef<MediaStream | null>(null);
  const connStateRef = useRef<string>('idle'); // Evita race conditions

  const detachRemoteVideo = useCallback((force = false) => {
    if (!force) return; // SOLO limpia cuando realmente cierras el PeerConnection
    
    if (currentRemoteStream.current) {
      currentRemoteStream.current.getTracks().forEach(t => t.stop());
      currentRemoteStream.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const setConnectionStateSync = useCallback((state: string) => {
    connStateRef.current = state;
    setConnectionState(state);
  }, []);



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

  const onIceConnectionStateChange = useCallback(async () => {
    const pc = peerConnectionRef.current;
    if (!pc) return;

    const state = pc.iceConnectionState;
    setIceConnectionState(state);

    /* 1️⃣ Primero intenta restartIce (rápido y sin renegociar) */
    if (state === 'disconnected') {
      console.warn('🔄 ICE disconnected – trying restartIce');
      
      // Feature test para compatibilidad
      if (typeof pc.restartIce === 'function') {
        try {
          await pc.restartIce();
          return; // 🎉 se recuperó, no hacemos más
        } catch {
          console.warn('restartIce() failed, proceeding with full reconnection');
        }
      } else {
        console.warn('restartIce() not supported in this browser');
      }
    }

    /* 2️⃣ Reconexión completa sólo si restartIce no funcionó */
    if (state === 'failed' || state === 'disconnected') {
      console.warn('❌ ICE', state, '– reconnecting WebRTC');

      // 🔒 Evita doble reconexión usando ref (sin race conditions)
      if (connStateRef.current === 'reconnecting') {
        console.log('Already reconnecting, skipping duplicate attempt');
        return;
      }
      setConnectionStateSync('reconnecting');

      // a) Limpia controladores vivos
      didAbortController.current?.abort();
      didAbortController.current = null;

      // b) Cierra la conexión actual (sin detachRemoteVideo - será reemplazado en onTrack)
      if (webSocketRef.current) {
        webSocketRef.current.close();
        webSocketRef.current = null;
      }
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }

      // c) Pequeño respiro para liberar puertos
      await new Promise(r => setTimeout(r, 800));

      // d) Reconecta con la misma config
      if (apiConfigRef.current) {
        try {
          // Llamar directamente a la lógica de conexión sin referencias circulares
          const ws = await connectToWebSocket(apiConfigRef.current.websocketUrl, apiConfigRef.current.key, cleanupWebSocketListeners);
          if (ws) {
            webSocketRef.current = ws;
            
            // Initialize stream again
            const initStreamMessage = {
              type: 'init-stream',
              payload: {
                presenter_id: 'v2_public_alex@qcvo4gupoy',
                driver_id: 'e3nbserss8',
                presenter_type: 'clip'
              }
            };
            sendMessage(ws, initStreamMessage);
            
            setConnectionStateSync('connected');
            console.log('✅ ICE reconnection successful');
          }
        } catch (error) {
          console.error('❌ Failed to reconnect:', error);
          setConnectionStateSync('needs-reconnect');
        }
      } else {
        console.error('No apiConfig – manual reconnect needed');
        setConnectionStateSync('needs-reconnect');
      }
    }
  }, [detachRemoteVideo, setConnectionStateSync]);

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

  // Función para limpiar video durante interrupciones
  const clearCurrentVideo = useCallback(() => {
    console.log('[CLEAR-VIDEO] Attempting cleanup during interruption');
    
    if (currentRemoteStream.current && videoRef.current) {
      const trackCount = currentRemoteStream.current.getVideoTracks().length;
      console.log('[CLEAR-VIDEO] Video tracks found:', trackCount);
      
      if (trackCount > 1) {
        console.log('[CLEAR-VIDEO] Multiple tracks detected, cleaning up');
        videoRef.current.pause();
        
        // Detener pistas anteriores (mantener solo la última)
        const videoTracks = currentRemoteStream.current.getVideoTracks();
        videoTracks.slice(0, -1).forEach(track => {
          track.stop();
          currentRemoteStream.current!.removeTrack(track);
        });
      } else if (trackCount === 1) {
        // Si solo hay una pista, pausar para evitar overlapping
        console.log('[CLEAR-VIDEO] Single track, pausing to prevent overlap');
        videoRef.current.pause();
      }
    }
  }, [videoRef]);

  const onTrack = useCallback((event: RTCTrackEvent) => {
    if (!event.track) return;
    if (event.track.kind !== 'video') return; // Solo procesar video tracks

    const inbound = event.streams[0] || new MediaStream([event.track]);

    // 1️⃣ Eliminar cualquier video-track previa del MISMO stream
    inbound.getVideoTracks().forEach(track => {
      if (track.id !== event.track.id) {     // Pista vieja detectada
        track.stop();                        // Detener decodificación
        inbound.removeTrack(track);          // Sacar del stream
      }
    });

    // 2️⃣ Asignar el stream (solo si aún no está)
    if (videoRef.current?.srcObject !== inbound) {
      if (videoRef.current) {
        videoRef.current.srcObject = inbound;
        videoRef.current.muted = false;
      }
    }

    // 3️⃣ Asegurar reproducción (por si algún flujo previo lo pausó)
    // Solo reanudar si NO estamos en proceso de cancelación
    setTimeout(() => {
      if (streamingStateRef.current !== 'cancelling') {
        videoRef.current?.play().catch(() => {});
      }
    }, 20);

    currentRemoteStream.current = inbound;

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
  }, [lastBytesReceived, videoIsPlaying, onVideoStatusChange, detachRemoteVideo, videoRef]);

  const onStreamEvent = useCallback((message: MessageEvent) => {
    if (dataChannelRef.current?.readyState === 'open') {
      let status;
      const [event] = message.data.split(':');

      switch (event) {
        case 'stream/started':
          status = 'started';
          setStreamingState('streaming');
          streamingStateRef.current = 'streaming';
          console.log('[STREAM-started]', 'state updated to:', streamingStateRef.current);
          break;
        case 'stream/done':
          status = 'done';
          setStreamingState('empty'); // Update state immediately
          streamingStateRef.current = 'empty';
          console.log('🔄 Stream state updated to empty via stream/done');
          // Libera promesas que esperaban el 'done'
          pendingDoneResolvers.current.forEach(r => r());
          pendingDoneResolvers.current = [];
          break;
        case 'stream/ready':
          status = 'ready';
          // Process pending message with ICE stabilization buffer
          if (pendingMsgRef.current) {
            const pendingMsg = pendingMsgRef.current;
            pendingMsgRef.current = null;
            console.log('📤 Flushing queued message after 200ms buffer:', pendingMsg.substring(0, 50) + '...');
            setTimeout(() => flushPendingMessage(pendingMsg), 200);
          }
          break;
        case 'stream/error':
          status = 'error';
          setStreamingState('empty'); // Update state immediately
          // Libera promesas que esperaban el 'done'
          pendingDoneResolvers.current.forEach(r => r());
          pendingDoneResolvers.current = [];
          break;
        case 'chat/partial':
          status = 'chat/partial';
          // Transition from 'cancelling' to normal flow
          if (streamingStateRef.current === 'cancelling') {
            setStreamingState('empty');
            streamingStateRef.current = 'empty';
          }
          break;
        case 'chat/answer':
          status = 'chat/answer';
          // Ensure state transitions properly after cancellation
          if (streamingStateRef.current === 'cancelling') {
            setStreamingState('empty');
            streamingStateRef.current = 'empty';
          }
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
  }, [detachRemoteVideo]);

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
    
    // Store API config for HTTP requests
    apiConfigRef.current = apiConfig;

    try {
      // Connect to D-ID WebSocket
      const ws = await connectToWebSocket(apiConfig.websocketUrl, apiConfig.key, cleanupWebSocketListeners);
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
    detachRemoteVideo(true); // Cierre definitivo con force=true
    
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
  }, [sessionId, streamId, stopAllStreams, closePC, detachRemoteVideo]);

  const sendStreamText = useCallback(async (text: string) => {
    if (cancellingRef.current || (streamingState !== 'empty' && streamingState !== 'cancelling')) {
      console.warn('Stream todavía cancelándose o no vacío, omite envío.');
      return;
    }

    // Check if peerConnection is missing and needs reconnection
    if (!peerConnectionRef.current || connectionState === 'needs-reconnect') {
      console.log('🔄 RTCPeerConnection missing, reconnecting...');
      if (apiConfigRef.current) {
        await connect(apiConfigRef.current);
        return; // Message will be queued and sent after reconnection
      } else {
        console.error('No API config available for reconnection');
        return;
      }
    }

    if (!webSocketRef.current || !streamId || !sessionId) {
      console.error('D-ID connection not ready', {
        hasWebSocket: !!webSocketRef.current,
        streamId,
        sessionId,
        wsReadyState: webSocketRef.current?.readyState
      });
      pendingMsgRef.current = text; // Sobrescribe anterior
      console.log('📦 Message queued (latest wins):', text.substring(0, 50) + '...');
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





  // Cleanup WebSocket listeners to prevent memory leaks
  const cleanupWebSocketListeners = useCallback(() => {
    if (webSocketRef.current) {
      webSocketRef.current.onmessage = null;
      webSocketRef.current.onopen = null;
      webSocketRef.current.onclose = null;
      webSocketRef.current.onerror = null;
    }
  }, []);

  // Flush single pending message with safety checks
  const flushPendingMessage = useCallback((text: string) => {
    if (webSocketRef.current?.readyState !== WebSocket.OPEN) return;
    if (!streamId || !sessionId) return; // Prevent send before stream initialization
    
    console.log('Sending flushed message to D-ID avatar:', text);
    
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
    console.log('✅ Flushed message sent to D-ID');
  }, [streamId, sessionId]);

  const cancelCurrentStream = useCallback(async (): Promise<void> => {
    if (!webSocketRef.current || !streamId || !sessionId || 
        cancellingRef.current || streamingStateRef.current !== 'streaming') {
      console.log('[cancel] No hay stream activo; omite.');
      return;
    }

    cancellingRef.current = true;
    console.log('🗑️ Cancelling current D-ID stream');

    // NUEVO: Limpiar video inmediatamente
    clearCurrentVideo();

    setStreamingState('empty'); // Set to empty after stopping tracks
    
    try {
      // Send WebSocket delete-stream message to D-ID
      if (webSocketRef.current?.readyState === WebSocket.OPEN) {
        webSocketRef.current.send(JSON.stringify({ 
          type: 'delete-stream', 
          streamId: streamId 
        }));
        console.log('🗑️ WebSocket delete-stream message sent');
      }
      
      // Grace period for SRTP cleanup
      await new Promise(resolve => setTimeout(resolve, 120));
      console.log('✅ Stream deletion grace period complete');

      // NUEVO: Pausar definitivamente después del grace period
      if (videoRef.current) {
        videoRef.current.pause();
        console.log('🎬 Video paused after grace period to prevent resume');
      }

      // Video stream will be maintained - no detachRemoteVideo() call needed
      
      // Clear any pending resolvers
      pendingDoneResolvers.current = [];
      setStreamEvent('cancelled');
      
    } catch (error) {
      console.error('Error during WebSocket delete:', error);
    } finally {
      // Mantener streamId y sessionId para permitir futuras interrupciones
      // Solo resetear estado de streaming
      setStreamingState('cancelling');
      streamingStateRef.current = 'cancelling';
      cancellingRef.current = false;
      
      console.log('🔄 Stream cancellation complete, RTCPeerConnection maintained');
      console.log('[CANCEL-finally]', 'cancellingRef.current:', cancellingRef.current, 'state:', streamingStateRef.current, 'streamId preserved:', streamId);
    }
  }, [streamId, sessionId, detachRemoteVideo, clearCurrentVideo]);

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
    streamId,
    cancellingRef,
    streamingStateRef,
    clearCurrentVideo,
    pendingMessagesCount: pendingMsgRef.current ? 1 : 0
  };
}
