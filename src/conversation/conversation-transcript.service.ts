import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import type { DB } from 'src/db/db.types';
import { KYSELY_DB } from 'src/tokens';

/** Owns idempotent persistence of completed, user-visible assistant text. */
@Injectable()
export class ConversationTranscriptService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async storeAssistantMessage(input: {
    conversationId: string;
    message: string;
    sourceId: string;
  }): Promise<void> {
    const message = input.message.trim();
    if (!message) return;

    await this.db
      .insertInto('preview_platform.message')
      .values({
        conversation_id: input.conversationId,
        role: 'assistant',
        message,
        source_id: input.sourceId,
      })
      .onConflict((oc) =>
        oc.columns(['conversation_id', 'source_id']).doUpdateSet({
          message,
          updated_at: new Date(),
        }),
      )
      .execute();
  }
}
