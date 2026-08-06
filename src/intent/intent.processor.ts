import { Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { type INTENT_JOB } from './intent.types';
import { ConversationService } from 'src/conversation/conversation.service';
import { IntentService } from './intent.service';
import { JobService } from 'src/job/job.service';
import { AnvilAgentSupervisorService } from 'src/anvil-agent-supervisor/anvil-agent-supervisor.service';
import { AnvilAgentStreamPublisher } from 'src/anvil-agent/anvil-agent-stream-publisher.service';

const INVALID_INTENT_MESSAGE =
  "I'm sorry, I couldn't determine how to handle that request.";

@Processor('intent-execution', {
  concurrency: 1,
})
export class IntentProcessor extends WorkerHost {
  private readonly logger = new Logger(IntentProcessor.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly intentService: IntentService,
    private readonly jobService: JobService,
    private readonly anvilAgentSupervisorService: AnvilAgentSupervisorService,
    private readonly streamPublisher: AnvilAgentStreamPublisher,
  ) {
    super();
  }
  async process(job: INTENT_JOB) {
    this.logger.log(`Job picked up for query: ${job.data.query}`);
    await job.updateProgress(10);

    const intent = await this.intentService.classifyIntent(
      job.data.query,
      job.data.conversation_id,
    );
    const streamId = job.data.stream_id ?? `${job.id}:intent`;

    if (intent !== 'instant' && intent !== 'offload') {
      this.logger.error(
        `Invalid intent "${intent}" for conversation ${job.data.conversation_id}, intent job ${job.id}`,
      );

      try {
        await this.streamPublisher.publish({
          chunk: {
            type: 'text-delta',
            payload: { text: INVALID_INTENT_MESSAGE },
          },
          conversationId: job.data.conversation_id,
          jobId: `${job.id}:intent`,
          source: 'intent',
          streamId,
        });
      } catch (error: unknown) {
        this.logger.error(
          `Failed to publish invalid-intent fallback for conversation ${job.data.conversation_id}, intent job ${job.id}: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }

      throw new Error('Invalid query by user');
    }

    if (intent === 'instant') {
      //this flow would go to the conversation service
      await this.conversationService.handleConversation(
        job.data.query,
        job.data.conversation_id,
        job.data.project_id,
        streamId,
      );
    } else if (intent === 'offload') {
      await this.anvilAgentSupervisorService.anvilSupervisorAgentQueue(
        job.data.conversation_id,
        job.data.query,
        job.data.project_id,
      );
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
        job.id + ':' + 'intent',
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
      job.id + ':' + 'intent',
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
      job.id + ':' + 'intent',
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
