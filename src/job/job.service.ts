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
      type: string;
      state: PreviewPlatformJobStatus;
      error?: string;
    } = {
      id: jobId,
      type,
      state: state,
    };

    if (errorMessage) {
      payload.error = errorMessage;
    }

    await this.db
      .updateTable('preview_platform.jobs')
      .where('id', '=', jobId)
      .where('conversation_id', '=', conversationId)
      .set(payload)
      .execute();
  }

  async updateProjectJobStatus(
    jobId: string,
    projectId: string,
    state: PreviewPlatformJobStatus,
    type: string,
    errorMessage?: string,
  ) {
    const payload: {
      type: string;
      state: PreviewPlatformJobStatus;
      error?: string;
    } = {
      type,
      state: state,
    };

    if (errorMessage) {
      payload.error = errorMessage;
    }

    await this.db
      .updateTable('preview_platform.project_jobs')
      .where('id', '=', jobId)
      .where('project_id', '=', projectId)
      .set(payload)
      .execute();
  }

  async insertIntoProjectJobs(jobId: string, projectId: string, type: string) {
    await this.db
      .insertInto('preview_platform.project_jobs')
      .values({
        id: jobId,
        project_id: projectId,
        state: 'queued',
        type,
      })
      .execute();
  }

  async insert(jobId: string, conversationId: string, type: string) {
    await this.db
      .insertInto('preview_platform.jobs')
      .values({
        id: jobId,
        conversation_id: conversationId,
        state: 'queued',
        type,
      })
      .execute();
  }
}
