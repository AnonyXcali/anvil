import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SshService } from '../ssh/ssh.service';
import { Kysely } from 'kysely';
import { KYSELY_DB } from 'src/tokens';
import type { DB } from 'src/db/db.types';
import { Logger, Inject } from '@nestjs/common';
import { JobService } from 'src/job/job.service';
import { MastraService } from '@mastra/nestjs';
import { AGENT_DIRECTORY } from 'src/agent.directory';
import { ProjectNameSchema } from 'src/project/project-name.types';
import { CoreService } from 'src/core/core.service';

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
    private readonly jobService: JobService,
    private readonly mastraService: MastraService,
    private readonly coreService: CoreService,
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

    const project = await this.db
      .selectFrom('preview_platform.project')
      .select(['description'])
      .where('id', '=', projectId)
      .executeTakeFirstOrThrow();

    let projectName = `anvil-project-${projectId.slice(0, 8)}`;
    try {
      const result = await this.mastraService
        .getAgent(AGENT_DIRECTORY.anvilProjectNameAgent)
        .generate(project.description, {
          structuredOutput: { schema: ProjectNameSchema },
        });
      const parsed = ProjectNameSchema.safeParse(result.object);
      if (parsed.success && parsed.data.name.trim()) {
        projectName = parsed.data.name.trim();
      } else {
        this.logger.warn(
          `Project name agent returned an invalid name for ${projectId}`,
        );
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Project name inference failed for ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    await this.db
      .updateTable('preview_platform.project')
      .set({ name: projectName })
      .where('id', '=', projectId)
      .execute();

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

    await this.coreService.enqueueIntentJob(
      project.description,
      conversationId,
      projectId,
    );

    return {
      conversationId,
    };
  }

  @OnWorkerEvent('completed')
  async onWorkerCompletion(
    job: Job<TaskJobData>,
    result: { conversationId: string },
  ) {
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
