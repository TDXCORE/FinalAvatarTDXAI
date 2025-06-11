export interface ApiConfig {
  key: string;
  url: string;
  websocketUrl: string;
  service: string;
  elevenlabsKey: string;
}

export async function loadApiConfig(): Promise<ApiConfig> {
  try {
    const response = await fetch('/api.json');
    if (!response.ok) {
      throw new Error('Failed to load API configuration');
    }
    
    const config = await response.json();
    
    if (config.key === '🤫') {
      throw new Error('Please configure your API keys in api.json');
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
    voiceId: '21m00Tcm4TlvDq8ikWAM'
  }
};
