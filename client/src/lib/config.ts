export interface ApiConfig {
  key: string;
  url: string;
  websocketUrl: string;
  service: string;
  elevenlabsKey: string;
}

export async function loadApiConfig(): Promise<ApiConfig> {
  try {
    // Try environment variables first
    const didKey = import.meta.env.VITE_DID_API_KEY;
    const groqKey = import.meta.env.VITE_GROQ_API_KEY;
    const elevenlabsKey = import.meta.env.VITE_ELEVENLABS_API_KEY;
    
    if (didKey && didKey !== 'your_d_id_api_key_here') {
      return {
        key: didKey,
        url: 'https://api.d-id.com',
        websocketUrl: 'wss://ws-api.d-id.com',
        service: 'clips',
        elevenlabsKey: elevenlabsKey || ''
      };
    }
    
    // Try server environment variables (for secrets)
    try {
      const configResponse = await fetch('/api/config');
      if (configResponse.ok) {
        const serverConfig = await configResponse.json();
        if (serverConfig.DID_API_KEY) {
          return {
            key: serverConfig.DID_API_KEY,
            url: 'https://api.d-id.com',
            websocketUrl: 'wss://ws-api.d-id.com',
            service: 'clips',
            elevenlabsKey: serverConfig.ELEVENLABS_API_KEY || ''
          };
        }
      }
    } catch (error) {
      console.log('Server config not available, trying fallback');
    }
    
    // Fallback to api.json file
    const jsonResponse = await fetch('/api.json');
    if (!jsonResponse.ok) {
      throw new Error('Failed to load API configuration');
    }
    
    const config = await jsonResponse.json();
    
    if (config.key === '🤫' || config.key === 'TU_D_ID_API_KEY_AQUI') {
      throw new Error('Please configure your API keys in .env file or api.json');
    }
    
    return {
      key: config.key,
      url: config.url || 'https://api.d-id.com',
      websocketUrl: config.websocketUrl || 'wss://ws-api.d-id.com',
      service: config.service || 'clips',
      elevenlabsKey: config.elevenlabsKey || ''
    };
  } catch (error) {
    console.error('Failed to load API configuration:', error);
    throw error;
  }
}

export const CONFIG = {
  AVATAR: {
    presenter_id: 'v2_public_alex@qcvo4gupoy',
    driver_id: 'e3nbserss8',
    idleVideo: '/alex_v2_idle.mp4'
  },
  AUDIO: {
    sampleRate: 16000,
    bufferSize: 20 // ms
  },
  ELEVENLABS: {
    voiceId: 'ucWwAruuGtBeHfnAaKcJ'
  },
  SPEECH: {
    silenceDetectionMs: 800,
    language: 'es'
  }
};
