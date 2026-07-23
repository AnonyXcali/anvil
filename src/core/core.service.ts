import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  type MessageEvent,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Observable } from 'rxjs';
import { Kysely } from 'kysely';
import { KYSELY_DB } from 'src/tokens';
import type { DB, PreviewPlatformWorkflowJobStatus } from 'src/db/db.types';
import { Queue } from 'bullmq';
import { ChannelsService } from 'src/channels/channels.service';
import { MastraService } from '@mastra/nestjs';
import { generateKeys } from 'src/utils';
import { StreamEventType } from 'src/anvil-agent/anvil-agent-chunk.dictionary';
import {
  buildAppStreamEvent,
  buildStreamEnvelope,
  getWorkflowFinishStatus,
  getStreamChunkType,
  isEmptyStreamChunk,
} from 'src/anvil-agent/anvil-agent-streaming.helpers';
import type { Json } from 'src/db/db.types';

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
      project_id: string;
    }>,
    private readonly channelService: ChannelsService,
    private readonly mastraService: MastraService,
  ) {}

  async handleFlowInitiation(query: string, userId: string, projectId: string) {
    //create a conversation -> get conversation_id
    this.logger.log('Creating conversation id');
    const { id: conversationId } = await this.db
      .insertInto('preview_platform.conversation')
      .values({
        user_id: userId,
        project_id: projectId,
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
        project_id: projectId,
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

    //TODO: replace with job service insert method

    await this.db
      .insertInto('preview_platform.jobs')
      .values({
        id: job.id + ':' + 'intent',
        conversation_id: conversationId,
        type: 'intent',
      })
      .execute();

    //return the conversation_id and job_id
    return {
      job_id: job.id, //TODO: remove the job_id
      conversation_id: conversationId,
    };
  }

  handleRelay(conversationId: string) {
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

  async handleDecision(
    decision: 'accept' | 'deny',
    approvalRequestId: string,
    userId: string,
  ) {
    if (decision !== 'accept' && decision !== 'deny') {
      throw new BadRequestException('Invalid decision');
    }

    if (!approvalRequestId?.trim()) {
      throw new BadRequestException('Missing approvalRequestId');
    }

    if (!userId?.trim()) {
      throw new BadRequestException('Missing user id');
    }

    const workflowRun = await this.db
      .selectFrom('preview_platform.workflow_run')
      .innerJoin(
        'preview_platform.project',
        'preview_platform.project.id',
        'preview_platform.workflow_run.project_id',
      )
      .select([
        'preview_platform.workflow_run.id',
        'preview_platform.workflow_run.workflow_id',
        'preview_platform.workflow_run.run_id',
        'preview_platform.workflow_run.conversation_id',
        'preview_platform.workflow_run.project_id',
        'preview_platform.workflow_run.status',
      ])
      .where('preview_platform.workflow_run.id', '=', approvalRequestId)
      .where('preview_platform.project.user_id', '=', userId)
      .executeTakeFirst();

    if (!workflowRun) {
      throw new NotFoundException('Approval request not found');
    }

    if (
      workflowRun.status === 'completed' ||
      workflowRun.status === 'cancelled'
    ) {
      return { success: true };
    }

    // TODO: Keep this guard aligned with the UI button-disable behavior to prevent duplicate resume calls.
    if (workflowRun.status !== 'suspended') {
      throw new ConflictException('Workflow run is not suspended');
    }

    await this.updateWorkflowRunStatus(workflowRun.id, 'running');

    void this.resumeWorkflowRunAndRelay({
      approvalRequestId: workflowRun.id,
      workflowId: workflowRun.workflow_id,
      runId: workflowRun.run_id,
      conversationId: workflowRun.conversation_id,
      approved: decision === 'accept',
    });

    return { success: true };
  }

  async updateWorkflowRunStatus(
    workflowRunId: string,
    status: PreviewPlatformWorkflowJobStatus,
  ): Promise<void> {
    await this.db
      .updateTable('preview_platform.workflow_run')
      .set({ status })
      .where('id', '=', workflowRunId)
      .execute();
  }

  private async resumeWorkflowRunAndRelay({
    approvalRequestId,
    workflowId,
    runId,
    conversationId,
    approved,
  }: {
    approvalRequestId: string;
    workflowId: string;
    runId: string;
    conversationId: string;
    approved: boolean;
  }): Promise<void> {
    const { seqKey, listKey, metaKey, channelKey } = generateKeys(
      conversationId,
      `${approvalRequestId}:workflow-resume`,
    );
    const streamId = `${approvalRequestId}:workflow-resume`;

    const publishChunk = async (chunk: unknown) => {
      if (isEmptyStreamChunk(chunk)) {
        return;
      }

      await this.channelService.publishAndStoreChunk(
        JSON.stringify(
          buildStreamEnvelope({
            chunk,
            conversationId,
            source: 'workflow-resume',
            approvalRequestId,
          }),
        ),
        seqKey,
        listKey,
        metaKey,
        channelKey,
        { streamId },
      );
    };
    const publishAppEvent = async (chunk: unknown) => {
      const appEvent = buildAppStreamEvent(chunk);

      if (!appEvent) {
        return;
      }

      await publishChunk(appEvent);
    };

    try {
      await publishChunk({
        type: 'workflow-resume-start',
        payload: {
          workflowId,
          runId,
          approved,
        },
      });

      const mastra = this.mastraService.getMastra();
      const workflow = mastra.getWorkflowById(workflowId);
      const run = await workflow.createRun({ runId });
      const stream = run.resumeStream({
        resumeData: { approved },
      });

      for await (const chunk of stream.fullStream) {
        await publishChunk(chunk);
        await publishAppEvent(chunk);

        switch (getStreamChunkType(chunk)) {
          case 'workflow-execution-suspended':
          case 'workflow-step-suspended':
            await this.updateWorkflowRunSuspension(
              approvalRequestId,
              await this.loadWorkflowSnapshot(workflowId, runId),
            );
            await publishChunk({
              type: StreamEventType.APPROVAL_REQUIRED,
              payload: {
                approvalId: approvalRequestId,
                title: 'Apply proposed changes?',
                message:
                  'The AI has prepared a set of changes that require your approval.',
              },
            });
            this.logger.log(
              `Workflow ${workflowId} run ${runId} suspended again`,
            );
            continue;
          case 'workflow-finish':
            if (getWorkflowFinishStatus(chunk) === 'failed') {
              await publishChunk({
                type: StreamEventType.ERROR,
                payload: {
                  message: 'Something went wrong.',
                },
              });
            }
            continue;
          default:
            this.logger.debug(
              `Workflow resume chunk: ${getStreamChunkType(chunk)}`,
            );
            continue;
        }
      }

      const result = await stream.result;

      if (result.status === 'suspended') {
        await this.updateWorkflowRunSuspension(
          approvalRequestId,
          await this.loadWorkflowSnapshot(workflowId, runId),
        );
        return;
      }

      if (result.status === 'failed') {
        await this.updateWorkflowRunStatus(approvalRequestId, 'failed');
        await publishChunk({
          type: StreamEventType.ERROR,
          payload: {
            message: 'Something went wrong.',
          },
        });
        return;
      }

      if (!approved) {
        await this.updateWorkflowRunStatus(approvalRequestId, 'cancelled');
        await publishChunk({
          type: 'workflow-resume-cancelled',
          payload: {
            message: 'No changes were applied.',
          },
        });
        return;
      }

      await this.updateWorkflowRunStatus(approvalRequestId, 'completed');
      await publishChunk({
        type: 'workflow-resume-completed',
        payload: {
          message: 'Workflow completed.',
        },
      });
    } catch (error) {
      await this.updateWorkflowRunStatus(approvalRequestId, 'failed');
      await publishChunk({
        type: StreamEventType.ERROR,
        payload: {
          message: 'Something went wrong.',
        },
      });
      this.logger.error(error);
    }
  }

  private async loadWorkflowSnapshot(
    workflowId: string,
    runId: string,
  ): Promise<Json | null> {
    const workflowStore = await this.mastraService
      .getMastra()
      .getStorage()
      ?.getStore('workflows');
    const snapshot = await workflowStore?.loadWorkflowSnapshot({
      workflowName: workflowId,
      runId,
    });

    return (snapshot ?? null) as Json | null;
  }

  private async updateWorkflowRunSuspension(
    workflowRunId: string,
    suspendedStep: Json | null,
  ): Promise<void> {
    await this.db
      .updateTable('preview_platform.workflow_run')
      .set({
        status: 'suspended',
        suspended_step: suspendedStep,
      })
      .where('id', '=', workflowRunId)
      .execute();
  }

  async talk(
    query: string,
    conversationId: string,
    projectId: string,
    userId?: string,
  ) {
    if (!userId?.trim()) {
      throw new BadRequestException('Missing user id');
    }

    const ownedConversation = await this.db
      .selectFrom('preview_platform.conversation')
      .innerJoin(
        'preview_platform.project',
        'preview_platform.project.id',
        'preview_platform.conversation.project_id',
      )
      .select('preview_platform.conversation.id')
      .where('preview_platform.conversation.id', '=', conversationId)
      .where('preview_platform.project.user_id', '=', userId)
      .executeTakeFirst();

    if (!ownedConversation) {
      throw new NotFoundException('Conversation not found');
    }

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
    const job = await this.intentQueue.add(
      'classify-intent',
      {
        conversation_id: conversationId,
        query,
        project_id: projectId,
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
      throw new Error('Job id is not received');
    }

    const jobId = job.id + ':' + 'intent';

    await this.db
      .insertInto('preview_platform.jobs')
      .values({
        id: jobId,
        conversation_id: conversationId,
        type: 'intent',
      })
      .execute();

    return {
      conversation_id: conversationId,
    };
  }
}
