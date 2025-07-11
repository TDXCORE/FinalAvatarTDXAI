export async function connectToWebSocket(url: string, apiKey: string, cleanup?: () => void): Promise<WebSocket> {
  if (cleanup) {
    cleanup(); // Clean previous listeners before creating new connection
  }
  return new Promise((resolve, reject) => {
    // D-ID WebSocket connection with authorization
    const wsUrl = `${url}?authorization=Basic+${btoa(apiKey + ':')}`;
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      console.log('D-ID WebSocket connected');
      resolve(ws);
    };
    
    ws.onerror = (error) => {
      console.error('D-ID WebSocket error:', error);
      reject(error);
    };
    
    ws.onclose = () => {
      console.log('D-ID WebSocket closed');
    };
  });
}

export function sendMessage(ws: WebSocket | null, message: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
    console.error('WebSocket not ready for message:', message);
  }
}
