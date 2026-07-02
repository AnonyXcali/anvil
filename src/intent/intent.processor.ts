import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type INTENT_JOB } from './intent.types';
import { LlmService } from 'src/llm/llm.service';
import { ConversationService } from 'src/conversation/conversation.service';
import { IntentService } from './intent.service';
import { JobService } from 'src/job/job.service';

@Processor('intent-execution', {
  concurrency: 1,
})
export class IntentProcessor extends WorkerHost {
  private readonly logger = new Logger(IntentProcessor.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly conversationService: ConversationService,
    private readonly intentService: IntentService,
    private readonly jobService: JobService,
  ) {
    super();
  }
  async process(job: INTENT_JOB) {
    this.logger.log(`Job picked up for query: ${job.data.query}`);
    await job.updateProgress(10);

    //call lightweight llm
    const intent = await this.llmService.intent(job.data.query);

    if (intent !== 'instant' && intent !== 'offload') {
      throw new Error('Invalid query by user');
    }

    if (intent === 'instant') {
      //this flow would go to the conversation service
      await this.conversationService.handleConversation(
        job.data.query,
        job.data.conversation_id,
      );
    } else if (intent === 'offload') {
      //this flow would go to the code-gen or offload module (yet to decide)
    }

    await job.updateProgress(100);

    return {
      job: job.id,
      conversationId: job.data.conversation_id,
    };
  }

  @OnWorkerEvent('active')
  async handleActive(job: INTENT_JOB) {
    if (job.id) {
      await this.jobService.updateJobStatus(
        job.id,
        job.data.conversation_id,
        'active',
        'intent',
      );
    }
  }

  @OnWorkerEvent('completed')
  async handleCompleted(job: INTENT_JOB) {
    if (!job.id) return;

    await this.jobService.updateJobStatus(
      job.id,
      job.data.conversation_id,
      'completed',
      'intent',
    );
  }

  @OnWorkerEvent('failed')
  async handleFailure(job: INTENT_JOB, failed: Error) {
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
      'intent',
      failed.message,
    );
  }

  @OnWorkerEvent('error')
  handleError(error: Error) {
    this.logger.error(error.message);
  }
}
