import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  type ANVIL_AGENT_JOB,
  SEARCH_STRUCTURED_OUTPUT,
} from './anvil-agent.types';
import { AnvilAgentService } from './anvil-agent.service';
import { JobService } from 'src/job/job.service';

@Processor('anvil-agent-processor', {
  concurrency: 1,
})
export class AnvilAgentProcessor extends WorkerHost {
  private readonly logger = new Logger(AnvilAgentProcessor.name);
  constructor(
    private readonly anvilAgentService: AnvilAgentService,
    private readonly jobService: JobService,
  ) {
    super();
  }

  async process(job: ANVIL_AGENT_JOB) {
    this.logger.log('=========ANVIL==========');
    this.logger.log('JOB PICKED UP IN ANVIL PROCESSOR ');
    this.logger.log('=========ANVIL==========');

    await job.updateProgress(10);
    const {
      id,
      data: {
        conversation_id: conversationId,
        messages,
        project_id: projectId,
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

    this.logger.log('=========ANVIL==========');
    this.logger.log('ABOUT TO START LLM CALL');
    this.logger.log('=========ANVIL==========');
    const message: SEARCH_STRUCTURED_OUTPUT | undefined =
      await this.anvilAgentService.askAnvilAgent(
        messages,
        conversationId,
        id,
        projectId,
      );

    await job.updateProgress(100);
    return {
      success: true,
      message,
      conversationId,
    };
  }

  @OnWorkerEvent('active')
  async onWorkerActive(job: ANVIL_AGENT_JOB) {
    if (!job.id) {
      return;
    }

    await this.jobService.updateJobStatus(
      job.id + ':' + 'offload',
      job.data.conversation_id,
      'active',
      'offload',
    );
  }

  @OnWorkerEvent('completed')
  async onWorkerCompletion(
    job: ANVIL_AGENT_JOB,
    result: {
      success: boolean;
      message: SEARCH_STRUCTURED_OUTPUT | undefined;
      conversationId: string;
    },
  ) {
    if (!job.id || !result.message) return;

    const { message, conversationId } = result || {};
    //add job status
    if (message && conversationId) {
      await this.anvilAgentService.storeConstructedMessageToDb(
        JSON.stringify(message),
        conversationId,
      );
    }

    await this.jobService.updateJobStatus(
      job.id + ':' + 'offload',
      conversationId,
      'completed',
      'offload',
    );
  }

  @OnWorkerEvent('failed')
  async handleFailure(job: ANVIL_AGENT_JOB, failed: Error) {
    if (!job.id) {
      this.logger.error(
        `Job failed before job was available: ${failed.message}`,
      );
      return;
    }
    await this.jobService.updateJobStatus(
      job.id + ':' + 'offload',
      job.data.conversation_id,
      'failed',
      'offload',
      failed.message,
    );
  }

  @OnWorkerEvent('error')
  onWorkerErrored(failedReason: Error) {
    this.logger.error(failedReason.message);
  }
}
