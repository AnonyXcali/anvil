import { Job } from 'bullmq';
import { Messages } from 'src/types/types';
/**
 * Interface: Conversation
 * Responsibility: Handles the response generation of instant queries by users.
 */

export interface Conversation {
  handleConversation(query: string, conversationId: string): Promise<void>;
}

export type CONVERSATION_TYPE = {
  query: string;
  messages: Messages;
  conversation_id: string;
};

export type CONVERSATION_JOB = Job<CONVERSATION_TYPE>;

export type CONVERSATION_JOB_DTO = Job<{
  message: string | undefined;
  conversationId: string | undefined;
  status: 'done' | 'error';
}>;
