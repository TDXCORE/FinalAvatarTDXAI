const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || process.env.GROQ_API_KEY || '';

export async function connectToGroqSTT(model: string = 'whisper-large-v3'): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://api.groq.com/v1/speech:stream?model=${model}`);
    
    ws.onopen = () => {
      console.log('Groq STT WebSocket connected');
      resolve(ws);
    };
    
    ws.onerror = (error) => {
      console.error('Groq STT WebSocket error:', error);
      reject(error);
    };
    
    ws.onclose = () => {
      console.log('Groq STT WebSocket closed');
    };
  });
}

export async function sendToGroqLLM(messages: Array<{role: string, content: string}>, model: string = 'llama-3-70b-8192') {
  try {
    const response = await fetch('https://api.groq.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 150
      })
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
  } catch (error) {
    console.error('Groq LLM API error:', error);
    throw error;
  }
}
