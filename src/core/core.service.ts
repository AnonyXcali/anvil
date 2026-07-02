import { Injectable, Inject, Logger, type MessageEvent } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Observable } from 'rxjs';
import { Kysely } from 'kysely';
import { KYSELY_DB } from 'src/tokens';
import type { DB } from 'src/db/db.types';
import { Queue } from 'bullmq';
import { ChannelsService } from 'src/channels/channels.service';

/**
 * One gotcha: if you're behind Azure Container Apps or any reverse proxy/load balancer
 * ,make sure idle timeouts and buffering are configured, to not kill long-lived SSE connections,
 * since some proxies buffer responses by default and break streaming.
 */
@Injectable()
export class CoreService {
  private readonly logger = new Logger(CoreService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    @InjectQueue('intent-execution')
    private readonly intentQueue: Queue<{
      conversation_id: string;
      query: string;
    }>,
    private readonly channelService: ChannelsService,
  ) {}

  async handleFlowInitiation(query: string, userId: string) {
    //create a conversation -> get conversation_id
    this.logger.log('Creating conversation id');
    const { id: conversationId } = await this.db
      .insertInto('preview_platform.conversation')
      .values({
        user_id: userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    this.logger.log('Conversation Id created :' + conversationId);

    //store the message in the message
    this.logger.log('Storing message in db by user');
    await this.db
      .insertInto('preview_platform.message')
      .values({
        message: query,
        role: 'user',
        conversation_id: conversationId,
      })
      .execute();

    //create a job to intent processor and queue it
    //the job takes the query and the conversation_id futher.
    this.logger.log('Queueing job.....');
    const job = await this.intentQueue.add(
      'classify-intent',
      {
        conversation_id: conversationId,
        query,
      },
      {
        attempts: 1,
        removeOnComplete: {
          age: 60 * 60,
          count: 100,
        },
        removeOnFail: {
          age: 24 * 60 * 60,
          count: 100,
        },
      },
    );

    if (!job.id) {
      throw new Error('Job id is null');
    }

    await this.db
      .insertInto('preview_platform.jobs')
      .values({
        id: job.id,
        conversation_id: conversationId,
        type: 'intent',
      })
      .execute();

    //return the conversation_id and job_id
    return {
      job_id: job.id,
      conversation_id: conversationId,
    };
  }

  private async getLatestJob(conversationId: string) {
    return await this.db
      .selectFrom('preview_platform.jobs')
      .select(['id'])
      .where('conversation_id', '=', conversationId)
      .orderBy('updated_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  private constructKey(conversationId: string, jobId: string) {
    return `conversation:${conversationId}:job:${jobId}`;
  }

  handleRelay(conversationId: string) {
    // const job = await this.getLatestJob(conversationId);
    // if (!job || !job.id) {
    //   throw new Error('No Job Id Found');
    // }
    // const channelKey = this.constructKey(conversationId, job.id);

    let cleanup: (() => Promise<void>) | undefined;
    return new Observable<MessageEvent>((observer) => {
      this.channelService
        .subscribe(conversationId, (message) => {
          observer.next({ data: message });
        })
        .then((unsubscribe) => {
          cleanup = unsubscribe;
        })
        .catch((error) => observer.error(error));

      return () => {
        void cleanup?.();
      };
    });
  }

  async test(conversationId: string): Promise<void> {
    await this.channelService.publish(conversationId, 'hello!');
  }

  async talk(query: string, conversationId: string) {
    this.logger.log('Storing message in db by user');
    await this.db
      .insertInto('preview_platform.message')
      .values({
        message: query,
        role: 'user',
        conversation_id: conversationId,
      })
      .execute();

    //use the conversationId to get existing messages
    this.logger.log('Queueing job.....');
    await this.intentQueue.add(
      'classify-intent',
      {
        conversation_id: conversationId,
        query,
      },
      {
        attempts: 1,
        removeOnComplete: {
          age: 60 * 60,
          count: 100,
        },
        removeOnFail: {
          age: 24 * 60 * 60,
          count: 100,
        },
      },
    );

    return {
      conversation_id: conversationId,
    };
  }
}
