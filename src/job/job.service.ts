import { Injectable, Inject } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from 'src/tokens';
import type { DB, PreviewPlatformJobStatus } from 'src/db/db.types';

@Injectable()
export class JobService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}
  async updateJobStatus(
    jobId: string,
    conversationId: string,
    state: PreviewPlatformJobStatus,
    type: string,
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
      type,
      state: state,
    };

    if (errorMessage) {
      payload.error = errorMessage;
    }

    await this.db.updateTable('preview_platform.jobs').set(payload).execute();
  }
}
