import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { LlmService } from 'src/llm/llm.service';
import { type CONVERSATION_JOB } from './convesation.types';
import { ConversationService } from './conversation.service';
import { JobService } from 'src/job/job.service';

@Processor('conversation-processor', {
  concurrency: 1,
})
export class ConversationProcessor extends WorkerHost {
  //TODO: add active and failed event listeners
  private readonly logger = new Logger(ConversationProcessor.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly conversationService: ConversationService,
    private readonly jobService: JobService,
  ) {
    super();
  }
  async process(job: CONVERSATION_JOB) {
    await job.updateProgress(10);

    const jobId = job.id;

    if (!jobId) {
      throw new Error('No job id is present');
    }

    const message = await this.llmService.conversational(
      job.data.query,
      job.data.conversation_id,
      jobId,
      job.data.messages,
    );

    await job.updateProgress(100);
    return {
      status: 'done',
      message,
      conversationId: job.data.conversation_id,
    };
  }

  @OnWorkerEvent('active')
  async onWorkerActive(job: CONVERSATION_JOB) {
    if (!job.id) {
      return;
    }

    await this.jobService.updateJobStatus(
      job.id,
      job.data.conversation_id,
      'active',
      'conversation',
    );
  }

  @OnWorkerEvent('completed')
  async onWorkerCompletion(
    job: CONVERSATION_JOB,
    result: { status: string; message: string; conversationId: string },
  ) {
    if (!job.id) return;

    const { message, conversationId } = result || {};
    //add job status
    if (message && conversationId) {
      await this.conversationService.storeConstructedMessageToDb(
        message,
        conversationId,
      );
    }

    await this.jobService.updateJobStatus(
      job.id,
      conversationId,
      'completed',
      'conversation',
    );
  }

  @OnWorkerEvent('failed')
  async handleFailure(job: CONVERSATION_JOB, failed: Error) {
    if (!job.id) {
      this.logger.error(
        `Job failed before job was available: ${failed.message}`,
      );
      return;
    }
    await this.jobService.updateJobStatus(
      job.id,
      job.data.conversation_id,
      'failed',
      'conversation',
      failed.message,
    );
  }

  @OnWorkerEvent('error')
  onWorkerErrored(failedReason: Error) {
    this.logger.error(failedReason.message);
  }
}
