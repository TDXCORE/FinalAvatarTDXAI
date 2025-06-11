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
      // In production, send to actual Groq LLM
      // For now, generate mock response
      const userMessage = messages[messages.length - 1]?.content || '';
      const mockResponse = generateMockResponse(userMessage);
      
      // Simulate processing delay
      setTimeout(() => {
        onResponse(mockResponse);
      }, 300);
      
    } catch (error) {
      console.error('LLM processing failed:', error);
      onResponse('I apologize, but I encountered an error processing your message. Please try again.');
    }
  }, [onResponse]);

  return { sendMessage };
}

function generateMockResponse(userMessage: string): string {
  const responses = {
    greeting: [
      "Hello! I'm Alex, your AI assistant. How can I help you today?",
      "Hi there! Great to meet you. What would you like to talk about?",
      "Hello! I'm doing well, thank you for asking. How are you doing today?"
    ],
    ai: [
      "Artificial Intelligence is a fascinating field that focuses on creating systems that can perform tasks requiring human-like intelligence. It includes machine learning, natural language processing, and computer vision.",
      "AI has many applications today, from virtual assistants like me to autonomous vehicles and medical diagnosis systems. It's rapidly transforming many industries.",
      "The field of AI is constantly evolving, with new breakthroughs in areas like neural networks, deep learning, and generative models happening regularly."
    ],
    learning: [
      "Machine learning is a subset of AI that enables systems to learn and improve from data without being explicitly programmed for every task.",
      "There are different types of machine learning: supervised learning uses labeled data, unsupervised learning finds patterns in unlabeled data, and reinforcement learning learns through trial and error.",
      "Neural networks are inspired by how the human brain works, using interconnected nodes to process information and recognize patterns in data."
    ],
    default: [
      "That's an interesting question! I'd be happy to help you explore that topic further.",
      "I understand what you're asking about. Let me share some insights on that.",
      "That's a great topic to discuss. Here's what I can tell you about it.",
      "I'm here to help with any questions you have. What specific aspect interests you most?"
    ]
  };

  const lowerMessage = userMessage.toLowerCase();
  
  if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('how are you')) {
    return responses.greeting[Math.floor(Math.random() * responses.greeting.length)];
  } else if (lowerMessage.includes('ai') || lowerMessage.includes('artificial intelligence')) {
    return responses.ai[Math.floor(Math.random() * responses.ai.length)];
  } else if (lowerMessage.includes('learn') || lowerMessage.includes('machine') || lowerMessage.includes('neural')) {
    return responses.learning[Math.floor(Math.random() * responses.learning.length)];
  } else {
    return responses.default[Math.floor(Math.random() * responses.default.length)];
  }
}
