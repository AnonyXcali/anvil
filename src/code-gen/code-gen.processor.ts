import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SshService } from '../ssh/ssh.service';
import { generateKeys } from '../utils';
import { Kysely } from 'kysely';
import { KYSELY_DB } from 'src/tokens';
import type { DB } from 'src/db/db.types';
import { Logger, Inject } from '@nestjs/common';
import { ChannelsService } from 'src/channels/channels.service';
import { JobService } from 'src/job/job.service';

type TaskJobData = {
  projectId: string;
  port: number;
  conversationId: string;
};

//TODO: see below
/**
 * Cloudflare / Traefik
 *   -> only expose 80/443
 *   -> route preview domains to containers
 */

@Processor('code-execution', {
  concurrency: 1,
})
export class CodeGenProcessor extends WorkerHost {
  private readonly logger = new Logger(CodeGenProcessor.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    private readonly sshService: SshService,
    private readonly channelService: ChannelsService,
    private readonly jobService: JobService,
  ) {
    super();
  }

  async process(job: Job<TaskJobData>) {
    this.logger.log(`Processing job ${job.id}`);
    return await this.scaffoldProject(job);
  }

  private async scaffoldProject(job: Job<TaskJobData>) {
    // TODO: Publish structured scaffold queued/active/failed lifecycle events
    // so the UI does not need to infer scaffold state from preview messages.
    await job.updateProgress(25);

    if (!job.id) {
      throw new Error('No job id');
    }

    const { conversationId, port, projectId } = job.data || {};

    await this.sshService.previewBuild(
      port,
      `preview-dev-${projectId}`,
      `preview-${projectId}`,
      projectId,
    );

    await this.db
      .updateTable('preview_platform.project')
      .set({
        preview_url: `http://${process.env.SSH_HOST}:${port}/`,
        status: 'active',
        container_name: `preview-${projectId}`,
      })
      .where('id', '=', job.data.projectId)
      .execute();

    const { seqKey, listKey, metaKey, channelKey } = generateKeys(
      conversationId,
      job.id,
    );

    // TODO(security): Do not expose previews through direct unauthenticated HTTP URLs.
    // Route them through an authenticated HTTPS proxy or enforce network allowlists.
    const message = `The preview is on http://${process.env.SSH_HOST}:${port}/`;

    await this.channelService.publishAndStoreChunk(
      message,
      seqKey,
      listKey,
      metaKey,
      channelKey,
      { streamId: `${job.id}:scaffold-project` },
    );

    return {
      message,
      conversationId,
    };
  }

  @OnWorkerEvent('completed')
  async onWorkerCompletion(
    job: Job<TaskJobData>,
    result: { message: string; conversationId: string },
  ) {
    await this.db
      .insertInto('preview_platform.message')
      .values({
        message: result.message,
        role: 'system',
        conversation_id: result.conversationId,
      })
      .execute();

    if (!job.id) {
      throw new Error('Failed to update job status');
    }

    await this.jobService.updateJobStatus(
      job.id + ':' + 'scaffold-project',
      result.conversationId,
      'completed',
      'scaffold-project',
    );
  }

  @OnWorkerEvent('active')
  async onWorkerActive(job: Job<TaskJobData>) {
    if (!job.id) {
      return;
    }

    await this.jobService.updateJobStatus(
      job.id + ':' + 'scaffold-project',
      job.data.conversationId,
      'active',
      'scaffold-project',
    );
  }

  @OnWorkerEvent('failed')
  async handleFailure(job: Job<TaskJobData>, failed: Error) {
    if (!job.id) {
      this.logger.error(
        `Job failed before job was available: ${failed.message}`,
      );
      return;
    }

    this.logger.error(failed.message);

    await this.jobService.updateJobStatus(
      job.id + ':' + 'scaffold-project',
      job.data.conversationId,
      'failed',
      'scaffold-project',
      failed.message,
    );

    await this.db
      .updateTable('preview_platform.project')
      .where('id', '=', job.data.projectId)
      .set({
        status: 'errored',
      })
      .executeTakeFirstOrThrow();
  }

  @OnWorkerEvent('error')
  onWorkerErrored(failedReason: Error) {
    this.logger.error(failedReason.message);
  }
}
