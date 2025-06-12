import { useCallback } from 'react';
import { sendToGroqLLM } from '@/lib/groqApi';

interface UseLLMProps {
  onResponse: (response: string) => void;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function useLLM({ onResponse }: UseLLMProps) {
  const sendMessage = useCallback(async (messages: Message[], abortController?: AbortController) => {
    try {
      console.log('🧠 Sending to LLM with controller:', !!abortController);
      const response = await sendToGroqLLM(messages, 'llama-3.3-70b-versatile', abortController);
      console.log('🧠 LLM Response received:', response);
      onResponse(response);
      console.log('🧠 LLM onResponse callback called');
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('🛑 LLM request aborted');
        return;
      }
      console.error('LLM processing failed:', error);
      onResponse('Disculpa, encontré un error al procesar tu mensaje. Por favor intenta de nuevo.');
    }
  }, [onResponse]);

  return { sendMessage };
}
