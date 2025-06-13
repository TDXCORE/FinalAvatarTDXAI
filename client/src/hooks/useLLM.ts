import { useCallback, useRef } from 'react';
import { sendToGroqLLM } from '@/lib/groqApi';

interface UseLLMProps {
  onResponse: (response: string) => void;
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export function useLLM({ onResponse }: UseLLMProps) {
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (messages: Message[]) => {
    try {
      // Create new AbortController for this request
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const response = await sendToGroqLLM(messages, 'llama-3.3-70b-versatile', controller.signal);
      
      // Only process if not aborted
      if (!controller.signal.aborted) {
        onResponse(response);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('🛑 LLM request aborted');
        return;
      }
      console.error('LLM processing failed:', error);
      onResponse('Disculpa, encontré un error al procesar tu mensaje. Por favor intenta de nuevo.');
    } finally {
      abortControllerRef.current = null;
    }
  }, [onResponse]);

  const abortCurrentRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      console.log('🚫 Aborting current LLM request');
    }
  }, []);

  return { sendMessage, abortCurrentRequest };
}
