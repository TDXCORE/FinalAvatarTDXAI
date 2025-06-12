const GROQ_API_KEY = import.meta.env.VITE_GROQ_API_KEY || '';

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

export async function sendToGroqLLM(messages: Array<{role: string, content: string}>, model: string = 'llama-3.3-70b-versatile', abortController?: AbortController) {
  try {
    if (!GROQ_API_KEY) {
      throw new Error('GROQ API key not configured');
    }

    console.log('Groq LLM Request:', { model, messages });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 120,  // Reduced for faster responses
        top_p: 0.9,       // Optimized for conversation
        stream: false,    // Keep simple for now
        stop: ["\n\n", "Usuario:", "User:"] // Stop tokens for conversation
      }),
      signal: abortController?.signal
    });

    console.log('Groq LLM Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Groq LLM API error response:', errorText);
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('🧠 Groq LLM Full Response:', data);
    const content = data.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
    console.log('🧠 Extracted content:', content);
    return content;
  } catch (error) {
    console.error('Groq LLM API error:', error);
    throw error;
  }
}
