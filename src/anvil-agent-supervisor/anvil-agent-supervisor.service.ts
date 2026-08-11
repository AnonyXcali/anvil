import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { MastraService } from '@mastra/nestjs';
import { Queue } from 'bullmq';
import { Kysely } from 'kysely';
import type { DB, Json } from 'src/db/db.types';
import { JobService } from 'src/job/job.service';
import { KYSELY_DB } from 'src/tokens';
import { AGENT_DIRECTORY } from 'src/agent.directory';
import { RequestContext } from '@mastra/core/request-context';
import type { MessageListInput } from '@mastra/core/agent/message-list';
import type { AnvilAgentContext } from 'src/anvil-agent/anvil-agent.types';
import { StreamEventType } from 'src/anvil-agent/anvil-agent-chunk.dictionary';
import {
  buildAppStreamEvent,
  getApprovalSuspendPayload,
  getStreamChunkType,
  getSuspendedToolRunIdFromMessages,
  getWorkflowIdentifiers,
} from 'src/anvil-agent/anvil-agent-streaming.helpers';
import { AnvilAgentStreamPublisher } from 'src/anvil-agent/anvil-agent-stream-publisher.service';
import { ANVIL_SUPERVISOR_AGENT_JOB_DATA } from './anvil-agent-supervisor.types';

const FRONTEND_ENGINEERING_WORKFLOW_ID = 'anvil-agent-create-workflow';

function isInternalApprovalPlanChunk(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== 'object') {
    return false;
  }

  const serialized = JSON.stringify(chunk);
  return (
    serialized.includes('anvil-agent-workflow-plan-step') &&
    (serialized.includes('workflow-step-output') ||
      serialized.includes('workflow-step-result'))
  );
}

@Injectable()
export class AnvilAgentSupervisorService {
  private readonly logger = new Logger(AnvilAgentSupervisorService.name);

  constructor(
    @InjectQueue('anvil-supervisor-agent-processor')
    private readonly anvilSupervisorAgentTaskQueueProcessor: Queue<ANVIL_SUPERVISOR_AGENT_JOB_DATA>,
    private readonly jobService: JobService,
    private readonly mastraService: MastraService,
    private readonly streamPublisher: AnvilAgentStreamPublisher,
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
  ) {}

  //this agent is what relays to Redis
  async askSupervisorAgent(
    messages: Array<Record<string, string>>,
    conversationId: string,
    jobId: string,
    projectId: string,
    streamId: string,
  ): Promise<void> {
    this.logger.log(
      `Supervisor agent requested for conversation ${conversationId}, job ${jobId}, project ${projectId}, messages ${messages.length}`,
    );

    const requestContext = new RequestContext<AnvilAgentContext>();
    requestContext.set('projectId', projectId);
    requestContext.set('callCount', 0);

    const agent = this.mastraService.getAgent(
      AGENT_DIRECTORY.anvilSupervisorAgent,
    );
    const abortController = new AbortController();
    const resultStream = await agent.stream(
      messages as unknown as MessageListInput,
      {
        maxSteps: 10,
        requestContext,
        abortSignal: abortController.signal,
      },
    );
    const publishChunk = async (chunk: unknown) => {
      await this.streamPublisher.publish({
        chunk,
        conversationId,
        jobId: `${jobId}:supervisor`,
        envelopeJobId: jobId,
        source: 'supervisor',
        streamId,
      });
    };
    let workflowErrorPublished = false;

    const publishAppEvent = async (chunk: unknown): Promise<boolean> => {
      const appEvent = buildAppStreamEvent(chunk);

      if (!appEvent) {
        return false;
      }

      if (
        appEvent.type === StreamEventType.WORKFLOW_ERROR &&
        workflowErrorPublished
      ) {
        return true;
      }
      if (appEvent.type === StreamEventType.WORKFLOW_ERROR) {
        workflowErrorPublished = true;
      }

      await publishChunk(appEvent);
      return appEvent.type === StreamEventType.WORKFLOW_ERROR;
    };

    const publishApprovalRequired = async ({
      approvalId,
      title,
      message,
      summary,
    }: {
      approvalId: string;
      title: string;
      message: string;
      summary?: string;
    }) => {
      await publishChunk({
        type: StreamEventType.APPROVAL_REQUIRED,
        payload: {
          approvalId,
          title,
          message,
          summary,
        },
      });
    };

    for await (const chunk of resultStream.fullStream) {
      const approvalSuspendPayload = getApprovalSuspendPayload(chunk);
      if (!approvalSuspendPayload && !isInternalApprovalPlanChunk(chunk)) {
        await publishChunk(chunk);
      }
      const isTerminalWorkflowError = await publishAppEvent(chunk);
      if (isTerminalWorkflowError) {
        abortController.abort(new Error('Nested workflow failed'));
        break;
      }

      const chunkType = getStreamChunkType(chunk);
      const { workflowId, runId } = getWorkflowIdentifiers(chunk);

      if (approvalSuspendPayload) {
        const suspendedRunId =
          approvalSuspendPayload.runId ??
          getSuspendedToolRunIdFromMessages(
            resultStream.messageList.get.response.db(),
            approvalSuspendPayload.toolCallId,
            approvalSuspendPayload.toolName,
          );

        if (!suspendedRunId) {
          throw new Error(
            'Approval suspension is missing a nested workflow run id',
          );
        }

        const approvalId = await this.upsertWorkflowRun({
          workflowId: FRONTEND_ENGINEERING_WORKFLOW_ID,
          runId: suspendedRunId,
          conversationId,
          projectId,
          status: 'suspended',
          suspendedStep: approvalSuspendPayload.raw as Json,
          resumeAgentId: AGENT_DIRECTORY.anvilSupervisorAgent,
          resumeToolCallId: approvalSuspendPayload.toolCallId,
          resumeToolName: approvalSuspendPayload.toolName,
        });
        this.logger.log(
          `Application approval record saved for ${FRONTEND_ENGINEERING_WORKFLOW_ID} run ${suspendedRunId}; approval ${approvalId} targets ${AGENT_DIRECTORY.anvilSupervisorAgent}`,
        );

        await publishApprovalRequired({
          approvalId,
          title: approvalSuspendPayload.title,
          message: approvalSuspendPayload.message,
          summary: approvalSuspendPayload.summary,
        });

        continue;
      }

      if (workflowId !== FRONTEND_ENGINEERING_WORKFLOW_ID || !runId) {
        continue;
      }

      if (chunkType === 'workflow-execution-start') {
        await this.upsertWorkflowRun({
          workflowId,
          runId,
          conversationId,
          projectId,
          status: 'running',
          suspendedStep: null,
          resumeAgentId: null,
          resumeToolCallId: null,
          resumeToolName: null,
        });
        continue;
      }

      if (chunkType === 'workflow-execution-suspended') {
        const snapshot = await this.loadWorkflowSnapshot(workflowId, runId);
        const approvalId = await this.upsertWorkflowRun({
          workflowId,
          runId,
          conversationId,
          projectId,
          status: 'suspended',
          suspendedStep: snapshot,
        });
        this.logger.log(
          `Application approval record saved for ${workflowId} run ${runId}; approval ${approvalId} is suspended`,
        );

        await publishApprovalRequired({
          approvalId,
          title: 'Apply proposed changes?',
          message:
            'The AI has prepared a set of changes that require your approval.',
        });
      }
    }
  }

  private async loadWorkflowSnapshot(
    workflowId: string,
    runId: string,
  ): Promise<Json | null> {
    const storage = this.mastraService.getMastra().getStorage();
    const workflowStore = await storage?.getStore('workflows');
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

  private async upsertWorkflowRun({
    workflowId,
    runId,
    conversationId,
    projectId,
    status,
    suspendedStep,
    resumeAgentId,
    resumeToolCallId,
    resumeToolName,
  }: {
    workflowId: string;
    runId: string;
    conversationId: string;
    projectId: string;
    status: 'running' | 'suspended';
    suspendedStep: Json | null;
    resumeAgentId?: string | null;
    resumeToolCallId?: string | null;
    resumeToolName?: string | null;
  }): Promise<string> {
    const workflowRun = await this.db
      .insertInto('preview_platform.workflow_run')
      .values({
        workflow_id: workflowId,
        run_id: runId,
        conversation_id: conversationId,
        project_id: projectId,
        status,
        suspended_step: suspendedStep,
        resume_agent_id: resumeAgentId ?? null,
        resume_tool_call_id: resumeToolCallId ?? null,
        resume_tool_name: resumeToolName ?? null,
      })
      .onConflict((oc) =>
        oc.column('run_id').doUpdateSet({
          status,
          suspended_step: suspendedStep,
          resume_agent_id: resumeAgentId ?? null,
          resume_tool_call_id: resumeToolCallId ?? null,
          resume_tool_name: resumeToolName ?? null,
        }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();

    return workflowRun.id;
  }

  async resumeSupervisorAgent({
    runId,
    approved,
    toolCallId,
  }: {
    runId: string;
    approved: boolean;
    toolCallId?: string | null;
  }) {
    const supervisorAgent = this.mastraService.getAgent(
      AGENT_DIRECTORY.anvilSupervisorAgent,
    );
    const { runs } = await supervisorAgent.listSuspendedRuns();
    const suspendedRun = runs.find((run) => run.runId === runId);

    if (!suspendedRun) {
      throw new Error(
        `Suspended supervisor agent run ${runId} was not found or is no longer suspended`,
      );
    }

    const suspendedTool = suspendedRun.toolCalls.find(
      (toolCall) => !toolCallId || toolCall.toolCallId === toolCallId,
    );

    if (!suspendedTool) {
      throw new Error(
        `Suspended supervisor agent run ${runId} does not contain the expected tool call ${toolCallId ?? '(unspecified)'}`,
      );
    }

    if (suspendedTool.requiresApproval) {
      throw new Error(
        `Suspended supervisor agent run ${runId} requires tool approval; resumeStream is only valid for a tool suspension`,
      );
    }

    this.logger.log(
      `Resuming supervisor agent ${AGENT_DIRECTORY.anvilSupervisorAgent} run ${runId}`,
    );
    return supervisorAgent.resumeStream({ approved }, { runId });
  }

  /*TODO this should queue the job to anvilSupervisorAgentQueue */
  async anvilSupervisorAgentQueue(
    conversationId: string,
    query: string,
    projectId: string,
    streamId: string,
  ): Promise<void> {
    this.logger.log('Queueing offload query to supervisor agent worker');

    const messages = (
      await this.db
        .selectFrom('preview_platform.message')
        .select(['role', 'message'])
        .where('conversation_id', '=', conversationId)
        .execute()
    ).map((item) => ({ role: item.role, content: item.message }));

    const job = await this.anvilSupervisorAgentTaskQueueProcessor.add(
      'process-supervisor-query',
      {
        conversation_id: conversationId,
        query,
        messages,
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
      throw new Error('Job id is null');
    }

    await this.jobService.insert(
      String(job.id) + ':' + 'supervisor',
      conversationId,
      'supervisor',
    );
  }
}
