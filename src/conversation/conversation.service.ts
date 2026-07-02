import { Injectable, Logger, Inject } from '@nestjs/common';
import { Conversation } from './convesation.types';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { KYSELY_DB } from 'src/tokens';
import { Kysely } from 'kysely';
import type { DB } from 'src/db/db.types';

@Injectable()
export class ConversationService implements Conversation {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectQueue('conversation-processor')
    private readonly conversationProcessor: Queue<{
      conversation_id: string;
      messages: Array<Record<string, string>>;
      query: string;
    }>,
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
  ) {}

  async handleConversation(
    query: string,
    conversationId: string,
  ): Promise<void> {
    this.logger.log('Queueing normal query to conversation worker');

    const messages = (await this.retrieveMessages(conversationId)).map(
      (item) => ({ role: item.role, content: item.message }),
    );

    const job = await this.conversationProcessor.add(
      'process-query',
      {
        conversation_id: conversationId,
        query,
        messages,
      },
      {
        attempts: 1,
        removeOnComplete: {
          age: 60 * 60,
          count: 100,
        },
        removeOnFail: {
          age: 24 * 60 * 60,
          count: 100,
        },
      },
    );

    if (!job.id) {
      throw new Error('Job id is null');
    }

    await this.db
      .insertInto('preview_platform.jobs')
      .values({
        id: job.id,
        conversation_id: conversationId,
        type: 'conversation',
      })
      .execute();
  }

  async storeConstructedMessageToDb(message: string, conversationId: string) {
    await this.db
      .insertInto('preview_platform.message')
      .values({
        message,
        role: 'assistant',
        conversation_id: conversationId,
      })
      .execute();
  }

  async retrieveMessages(conversationId: string) {
    this.logger.log('Retreiving existing messages');
    return await this.db
      .selectFrom('preview_platform.message')
      .select(['role', 'message'])
      .where('conversation_id', '=', conversationId)
      .execute();
  }
}
