import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { JobService } from 'src/job/job.service';
import { AnvilAgentSupervisorService } from './anvil-agent-supervisor.service';
import { ANVIL_SUPERVISOR_AGENT_JOB_DATA } from './anvil-agent-supervisor.types';

type AnvilSupervisorAgentJob = Job<ANVIL_SUPERVISOR_AGENT_JOB_DATA>;

@Processor('anvil-supervisor-agent-processor', {
  concurrency: 1,
})
export class AnvilSupervisorAgentProcessor extends WorkerHost {
  private readonly logger = new Logger(AnvilSupervisorAgentProcessor.name);

  constructor(
    private readonly anvilAgentSupervisorService: AnvilAgentSupervisorService,
    private readonly jobService: JobService,
  ) {
    super();
  }

  async process(job: AnvilSupervisorAgentJob) {
    this.logger.log('=========ANVIL SUPERVISOR==========');
    this.logger.log('JOB PICKED UP IN ANVIL SUPERVISOR PROCESSOR');
    this.logger.log('=========ANVIL SUPERVISOR==========');

    await job.updateProgress(10);

    const {
      id,
      data: {
        conversation_id: conversationId,
        messages,
        project_id: projectId,
        stream_id: streamId,
      } = {},
    } = job || {};

    if (!messages) {
      throw new Error('no messages');
    }

    if (!conversationId) {
      throw new Error('no conversationId');
    }

    if (!id) {
      throw new Error('no job id');
    }

    if (!projectId) {
      throw new Error('no project id');
    }

    if (!streamId) {
      throw new Error('no stream id');
    }

    await this.anvilAgentSupervisorService.askSupervisorAgent(
      messages,
      conversationId,
      String(id),
      projectId,
      streamId,
    );

    await job.updateProgress(100);

    return {
      success: true,
      conversationId,
    };
  }

  @OnWorkerEvent('active')
  async onWorkerActive(job: AnvilSupervisorAgentJob) {
    if (!job.id) {
      return;
    }

    await this.jobService.updateJobStatus(
      String(job.id) + ':' + 'supervisor',
      job.data.conversation_id,
      'active',
      'supervisor',
    );
  }

  @OnWorkerEvent('completed')
  async onWorkerCompletion(job: AnvilSupervisorAgentJob) {
    if (!job.id) {
      return;
    }

    await this.jobService.updateJobStatus(
      String(job.id) + ':' + 'supervisor',
      job.data.conversation_id,
      'completed',
      'supervisor',
    );
  }

  @OnWorkerEvent('failed')
  async handleFailure(job: AnvilSupervisorAgentJob, failed: Error) {
    if (!job.id) {
      this.logger.error(
        `Job failed before job was available: ${failed.message}`,
      );
      return;
    }

    await this.jobService.updateJobStatus(
      String(job.id) + ':' + 'supervisor',
      job.data.conversation_id,
      'failed',
      'supervisor',
      failed.message,
    );
  }

  @OnWorkerEvent('error')
  onWorkerErrored(failedReason: Error) {
    this.logger.error(failedReason.message);
  }
}
