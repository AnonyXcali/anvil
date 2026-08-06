import { Injectable, Inject, Logger } from '@nestjs/common';
import { MastraService } from '@mastra/nestjs';
import type { Kysely } from 'kysely';
import { KYSELY_DB } from 'src/tokens';
import type { DB, PreviewPlatformJobStatus } from 'src/db/db.types';
import { AGENT_DIRECTORY } from 'src/agent.directory';
import {
  IntentClassificationSchema,
  type IntentClassification,
} from './intent.types';

type IntentHistoryMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    private readonly mastraService: MastraService,
  ) {}

  /**
   * Classifies the latest request using ordered application-database history.
   * This is intentionally non-streaming: the result is an internal routing
   * decision and must not create Redis or SSE chunks.
   */
  async classifyIntent(
    query: string,
    conversationId: string,
  ): Promise<IntentClassification> {
    const history = await this.db
      .selectFrom('preview_platform.message')
      .select(['role', 'message'])
      .where('conversation_id', '=', conversationId)
      .orderBy('sequence_number', 'asc')
      .execute();

    const messages: IntentHistoryMessage[] = history
      .filter(
        (
          message,
        ): message is typeof message & {
          role: 'user' | 'assistant' | 'system';
        } => message.role !== 'tool',
      )
      .map((message) => ({ role: message.role, content: message.message }));

    const latest = messages[messages.length - 1];
    if (latest?.role !== 'user' || latest.content !== query) {
      messages.push({ role: 'user', content: query });
    }

    const agent = this.mastraService.getAgent(AGENT_DIRECTORY.anvilIntentAgent);

    try {
      const result = await agent.generate(
        messages as unknown as Parameters<typeof agent.generate>[0],
        {
          structuredOutput: { schema: IntentClassificationSchema },
        },
      );
      return IntentClassificationSchema.parse(result.object).intent;
    } catch (error: unknown) {
      this.logger.error(
        `Intent agent classification failed for conversation ${conversationId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      return 'unknown';
    }
  }

  async updateIntentJobStatus(
    jobId: string,
    conversationId: string,
    state: PreviewPlatformJobStatus,
    errorMessage?: string,
  ) {
    const payload: {
      id: string;
      conversation_id: string;
      type: string;
      state: PreviewPlatformJobStatus;
      error?: string;
    } = {
      id: jobId,
      conversation_id: conversationId,
      type: 'intent',
      state: state,
    };

    if (errorMessage) {
      payload.error = errorMessage;
    }

    await this.db.updateTable('preview_platform.jobs').set(payload).execute();
  }
}
