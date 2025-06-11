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
  const sendMessage = useCallback(async (messages: Message[]) => {
    try {
      const response = await sendToGroqLLM(messages, 'llama-3.3-70b-versatile');
      onResponse(response);
    } catch (error) {
      console.error('LLM processing failed:', error);
      onResponse('I apologize, but I encountered an error processing your message. Please try again.');
    }
  }, [onResponse]);

  return { sendMessage };
}
