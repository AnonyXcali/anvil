import { Logger, Inject } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { JobService } from 'src/job/job.service';
import { type PROJECT_PROCESS_JOB } from './project.types';
import { SshService } from 'src/ssh/ssh.service';
import { Kysely } from 'kysely';
import { DB } from 'src/db/db.types';
import { KYSELY_DB } from 'src/tokens';

const STOP_CONTAINER = 'stop-container';

@Processor('stop-project-queue', {
  concurrency: 1,
})
export class ProjectStopProcessor extends WorkerHost {
  private readonly logger = new Logger(ProjectStopProcessor.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    private readonly jobService: JobService,
    private readonly sshService: SshService,
  ) {
    super();
  }
  async process(job: PROJECT_PROCESS_JOB) {
    await job.updateProgress(10);

    const jobId = job.id;

    if (!jobId) {
      throw new Error('No job id is present');
    }

    //stop the container
    const res = await this.sshService.stopPreviewContainer(
      job.data.container_name,
    );

    if (!res) {
      throw new Error('Job failed check stack');
    }

    await job.updateProgress(100);
  }

  @OnWorkerEvent('active')
  async onWorkerActive(job: PROJECT_PROCESS_JOB) {
    if (!job.id) {
      return;
    }

    await this.jobService.updateProjectJobStatus(
      job.id + ':' + STOP_CONTAINER,
      job.data.project_id,
      'active',
      STOP_CONTAINER,
    );

    await this.db
      .updateTable('preview_platform.project')
      .where('id', '=', job.data.project_id)
      .set({
        status: 'processing',
      })
      .execute();
  }

  @OnWorkerEvent('completed')
  async onWorkerCompletion(job: PROJECT_PROCESS_JOB) {
    if (!job.id) return;

    await this.jobService.updateProjectJobStatus(
      job.id + ':' + STOP_CONTAINER,
      job.data.project_id,
      'completed',
      STOP_CONTAINER,
    );

    await this.db
      .updateTable('preview_platform.project')
      .where('id', '=', job.data.project_id)
      .set({
        status: 'stopped',
      })
      .execute();
  }

  @OnWorkerEvent('failed')
  async handleFailure(job: PROJECT_PROCESS_JOB, failed: Error) {
    if (!job.id) {
      this.logger.error(
        `Job failed before job was available: ${failed.message}`,
      );
      return;
    }

    await this.jobService.updateProjectJobStatus(
      job.id + ':' + STOP_CONTAINER,
      job.data.project_id,
      'failed',
      STOP_CONTAINER,
      failed.message,
    );

    await this.db
      .updateTable('preview_platform.project')
      .where('id', '=', job.data.project_id)
      .set({
        status: 'errored',
      })
      .execute();
  }

  @OnWorkerEvent('error')
  onWorkerErrored(failedReason: Error) {
    this.logger.error(failedReason.message);
  }
}
