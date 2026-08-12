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
import { randomUUID } from 'node:crypto';
import { Kysely } from 'kysely';
import { KYSELY_DB } from 'src/tokens';
import type { DB, PreviewPlatformWorkflowJobStatus } from 'src/db/db.types';
import { Queue } from 'bullmq';
import { ChannelsService } from 'src/channels/channels.service';
import { MastraService } from '@mastra/nestjs';
import { StreamEventType } from 'src/anvil-agent/anvil-agent-chunk.dictionary';
import {
  buildAppStreamEvent,
  getApprovalSuspendPayload,
  getStreamChunkType,
  getTranscriptMessage,
} from 'src/anvil-agent/anvil-agent-streaming.helpers';
import { AnvilAgentStreamPublisher } from 'src/anvil-agent/anvil-agent-stream-publisher.service';
import { AnvilAgentSupervisorService } from 'src/anvil-agent-supervisor/anvil-agent-supervisor.service';
import { AGENT_DIRECTORY } from 'src/agent.directory';
import type { Json } from 'src/db/db.types';
import { ConversationTranscriptService } from 'src/conversation/conversation-transcript.service';

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
      stream_id: string;
    }>,
    private readonly channelService: ChannelsService,
    private readonly mastraService: MastraService,
    private readonly streamPublisher: AnvilAgentStreamPublisher,
    private readonly anvilAgentSupervisorService: AnvilAgentSupervisorService,
    private readonly transcriptService: ConversationTranscriptService,
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

    const { streamId, jobId } = await this.enqueueIntentJob(
      query,
      conversationId,
      projectId,
    );

    //return the conversation_id and job_id
    return {
      job_id: jobId,
      conversation_id: conversationId,
      stream_id: streamId,
    };
  }

  async enqueueIntentJob(
    query: string,
    conversationId: string,
    projectId: string,
  ): Promise<{ jobId: string; streamId: string }> {
    this.logger.log('Queueing job.....');
    const streamId = randomUUID();
    const job = await this.intentQueue.add(
      'classify-intent',
      {
        conversation_id: conversationId,
        query,
        project_id: projectId,
        stream_id: streamId,
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

    await this.db
      .insertInto('preview_platform.jobs')
      .values({
        id: job.id + ':intent',
        conversation_id: conversationId,
        type: 'intent',
      })
      .execute();

    return { jobId: String(job.id), streamId };
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
        'preview_platform.workflow_run.resume_agent_id',
        'preview_platform.workflow_run.resume_tool_call_id',
        'preview_platform.workflow_run.resume_tool_name',
        'preview_platform.workflow_run.suspended_step',
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

    if (workflowRun.status !== 'suspended') {
      throw new ConflictException('Workflow run is not suspended');
    }

    const claimedRun = await this.db
      .updateTable('preview_platform.workflow_run')
      .set({ status: 'running' })
      .where('id', '=', workflowRun.id)
      .where('status', '=', 'suspended')
      .returning('id')
      .executeTakeFirst();

    if (!claimedRun) {
      throw new ConflictException('Workflow run is no longer suspended');
    }

    if (workflowRun.workflow_id === 'anvil-agent-repair-workflow') {
      const suspendedStep = workflowRun.suspended_step;
      const transactionId =
        suspendedStep &&
        typeof suspendedStep === 'object' &&
        'transactionId' in suspendedStep &&
        typeof suspendedStep.transactionId === 'string'
          ? suspendedStep.transactionId
          : undefined;
      if (!transactionId) {
        await this.db
          .updateTable('preview_platform.workflow_run')
          .set({ status: 'failed' })
          .where('id', '=', workflowRun.id)
          .execute();
        throw new ConflictException('Repair approval has no transaction');
      }
      if (decision === 'deny') {
        await this.db
          .updateTable('preview_platform.edit_transaction')
          .set({ status: 'failed' })
          .where('id', '=', transactionId)
          .execute();
        await this.db
          .updateTable('preview_platform.workflow_run')
          .set({ status: 'cancelled' })
          .where('id', '=', workflowRun.id)
          .execute();
        return { success: true };
      }
      void this.startRepairSupervisorRun({
        transactionId,
        approvalRequestId: workflowRun.id,
        conversationId: workflowRun.conversation_id,
      });
      return { success: true };
    }

    void this.resumeWorkflowRunAndRelay({
      approvalRequestId: workflowRun.id,
      workflowId: workflowRun.workflow_id,
      runId: workflowRun.run_id,
      conversationId: workflowRun.conversation_id,
      projectId: workflowRun.project_id,
      approved: decision === 'accept',
      resumeAgentId: workflowRun.resume_agent_id,
      resumeToolCallId: workflowRun.resume_tool_call_id,
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

  private async startRepairSupervisorRun(input: {
    transactionId: string;
    approvalRequestId: string;
    conversationId: string;
  }): Promise<void> {
    try {
      await this.streamPublisher.publish({
        chunk: {
          type: 'workflow-resume-start',
          payload: {
            workflowId: 'anvil-agent-repair-workflow',
            runId: `repair:${input.transactionId}`,
            approved: true,
          },
        },
        conversationId: input.conversationId,
        jobId: `${input.approvalRequestId}:workflow-resume`,
        source: 'workflow-resume',
        approvalRequestId: input.approvalRequestId,
        streamId: `${input.approvalRequestId}:workflow-resume`,
      });
      await this.anvilAgentSupervisorService.queueRepairSupervisorAgent(
        input.transactionId,
        input.approvalRequestId,
      );
      await this.db
        .updateTable('preview_platform.workflow_run')
        .set({ status: 'running' })
        .where('id', '=', input.approvalRequestId)
        .execute();
    } catch (error: unknown) {
      await this.db
        .updateTable('preview_platform.workflow_run')
        .set({ status: 'failed' })
        .where('id', '=', input.approvalRequestId)
        .execute();
      await this.db
        .updateTable('preview_platform.edit_transaction')
        .set({ status: 'failed' })
        .where('id', '=', input.transactionId)
        .execute();
      this.logger.error(
        `Unable to start repair supervisor run for ${input.transactionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.streamPublisher.publish({
        chunk: {
          type: StreamEventType.WORKFLOW_ERROR,
          payload: { status: 'failed', message: 'Something went wrong.' },
        },
        conversationId: input.conversationId,
        jobId: `${input.approvalRequestId}:workflow-resume`,
        source: 'workflow-resume',
        approvalRequestId: input.approvalRequestId,
        streamId: `${input.approvalRequestId}:workflow-resume`,
      });
    }
  }

  private async resumeWorkflowRunAndRelay({
    approvalRequestId,
    workflowId,
    runId,
    conversationId,
    projectId,
    approved,
    resumeAgentId,
    resumeToolCallId,
  }: {
    approvalRequestId: string;
    workflowId: string;
    runId: string;
    conversationId: string;
    projectId: string;
    approved: boolean;
    resumeAgentId: string | null;
    resumeToolCallId: string | null;
  }): Promise<void> {
    const streamId = `${approvalRequestId}:workflow-resume`;
    let workflowErrorPublished = false;
    const transcriptParts: string[] = [];

    const publishChunk = async (
      chunk: unknown,
      options: { recordTranscript?: boolean } = {},
    ) => {
      const transcriptMessage =
        options.recordTranscript === false
          ? undefined
          : getTranscriptMessage(chunk);
      if (transcriptMessage) transcriptParts.push(transcriptMessage);
      await this.streamPublisher.publish({
        chunk,
        conversationId,
        jobId: `${approvalRequestId}:workflow-resume`,
        source: 'workflow-resume',
        approvalRequestId,
        streamId,
      });
    };
    const publishAppEvent = async (chunk: unknown) => {
      const appEvent = buildAppStreamEvent(chunk);

      if (!appEvent) {
        return;
      }

      if (
        appEvent.type === StreamEventType.WORKFLOW_ERROR &&
        workflowErrorPublished
      ) {
        return;
      }
      if (appEvent.type === StreamEventType.WORKFLOW_ERROR) {
        workflowErrorPublished = true;
      }

      await publishChunk(appEvent, { recordTranscript: false });
    };
    const publishWorkflowError = async () => {
      if (workflowErrorPublished) return;
      workflowErrorPublished = true;
      await publishChunk({
        type: StreamEventType.WORKFLOW_ERROR,
        payload: {
          status: 'failed',
          message: 'Something went wrong.',
          step: 'workflow',
        },
      });
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

      const stream =
        resumeAgentId === AGENT_DIRECTORY.anvilSupervisorAgent
          ? await this.anvilAgentSupervisorService.resumeSupervisorAgent({
              runId,
              approved,
              toolCallId: resumeToolCallId,
              projectId,
              conversationId,
            })
          : await this.resumeLegacyWorkflow({ workflowId, runId, approved });

      for await (const chunk of stream.fullStream) {
        await publishChunk(chunk);
        await publishAppEvent(chunk);

        const approvalSuspendPayload = getApprovalSuspendPayload(chunk);
        if (approvalSuspendPayload && resumeAgentId) {
          await this.updateWorkflowRunSuspension(
            approvalRequestId,
            approvalSuspendPayload.raw as Json,
            resumeAgentId,
            approvalSuspendPayload.toolCallId,
            approvalSuspendPayload.toolName,
          );
          await publishChunk({
            type: StreamEventType.APPROVAL_REQUIRED,
            payload: {
              approvalId: approvalRequestId,
              title: approvalSuspendPayload.title,
              message: approvalSuspendPayload.message,
              summary: approvalSuspendPayload.summary,
            },
          });
          continue;
        }

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
            continue;
          default:
            this.logger.debug(
              `Workflow resume chunk: ${getStreamChunkType(chunk)}`,
            );
            continue;
        }
      }

      const result = 'result' in stream ? await stream.result : undefined;

      if (workflowErrorPublished) {
        await this.updateWorkflowRunStatus(approvalRequestId, 'failed');
        return;
      }

      if (result?.status === 'suspended') {
        await this.updateWorkflowRunSuspension(
          approvalRequestId,
          await this.loadWorkflowSnapshot(workflowId, runId),
        );
        return;
      }

      if (result?.status === 'failed') {
        await this.updateWorkflowRunStatus(approvalRequestId, 'failed');
        await publishWorkflowError();
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
      await publishWorkflowError();
      this.logger.error(error);
      if (
        error instanceof Error &&
        error.message.includes('workflow run was not suspended')
      ) {
        this.logger.warn(
          `Mastra rejected resume for ${workflowId} run ${runId}; the snapshot may be missing or already resumed`,
        );
      }
    } finally {
      await this.transcriptService.storeAssistantMessage({
        conversationId,
        message: transcriptParts.join(''),
        sourceId: `workflow-resume:${approvalRequestId}`,
      });
    }
  }

  private async resumeLegacyWorkflow({
    workflowId,
    runId,
    approved,
  }: {
    workflowId: string;
    runId: string;
    approved: boolean;
  }) {
    const mastra = this.mastraService.getMastra();
    const workflow = mastra.getWorkflowById(workflowId);
    const run = await workflow.createRun({ runId });
    this.logger.log(
      `Resuming legacy workflow ${workflowId} run ${runId} from PostgreSQL-backed Mastra storage`,
    );
    return run.resumeStream({ resumeData: { approved } });
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

    if (snapshot) {
      this.logger.debug(
        `Workflow snapshot loaded for ${workflowId} run ${runId}`,
      );
    } else {
      this.logger.warn(
        `Workflow snapshot missing for ${workflowId} run ${runId}`,
      );
    }

    return (snapshot ?? null) as Json | null;
  }

  private async updateWorkflowRunSuspension(
    workflowRunId: string,
    suspendedStep: Json | null,
    resumeAgentId?: string | null,
    resumeToolCallId?: string | null,
    resumeToolName?: string | null,
  ): Promise<void> {
    await this.db
      .updateTable('preview_platform.workflow_run')
      .set({
        status: 'suspended',
        suspended_step: suspendedStep,
        ...(resumeAgentId !== undefined
          ? {
              resume_agent_id: resumeAgentId,
              resume_tool_call_id: resumeToolCallId ?? null,
              resume_tool_name: resumeToolName ?? null,
            }
          : {}),
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
      .select([
        'preview_platform.conversation.id',
        'preview_platform.conversation.project_id',
      ])
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

    const { streamId } = await this.enqueueIntentJob(
      query,
      conversationId,
      ownedConversation.project_id,
    );

    return {
      conversation_id: conversationId,
      stream_id: streamId,
    };
  }
}
