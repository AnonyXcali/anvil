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
  getTranscriptMessage,
} from 'src/anvil-agent/anvil-agent-streaming.helpers';
import { AnvilAgentStreamPublisher } from 'src/anvil-agent/anvil-agent-stream-publisher.service';
import { AnvilHistoryService } from 'src/anvil-history/anvil-history.service';
import { ANVIL_SUPERVISOR_AGENT_JOB_DATA } from './anvil-agent-supervisor.types';
import { ConversationTranscriptService } from 'src/conversation/conversation-transcript.service';

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
    private readonly anvilHistoryService: AnvilHistoryService,
    private readonly transcriptService: ConversationTranscriptService,
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
  ) {}

  //this agent is what relays to Redis
  async askSupervisorAgent(
    messages: Array<Record<string, string>>,
    conversationId: string,
    jobId: string,
    projectId: string,
    streamId: string,
    originatingRunId?: string,
    repair?: {
      repairTransactionId?: string;
      repairApprovalId?: string;
      source?: 'supervisor' | 'workflow-resume';
    },
  ): Promise<void> {
    this.logger.log(
      `Supervisor agent requested for conversation ${conversationId}, job ${jobId}, project ${projectId}, messages ${messages.length}`,
    );

    const requestContext = new RequestContext<AnvilAgentContext>();
    requestContext.set('projectId', projectId);
    requestContext.set('conversationId', conversationId);
    requestContext.set('jobId', jobId);
    if (repair?.repairTransactionId) {
      requestContext.set('repairRunId', jobId);
    }
    if (originatingRunId?.trim()) {
      requestContext.set('originatingRunId', originatingRunId);
    }
    requestContext.set('callCount', 0);
    if (repair?.repairTransactionId) {
      requestContext.set('editTransactionId', repair.repairTransactionId);
    }
    if (repair?.repairApprovalId) {
      requestContext.set('repairApprovalId', repair.repairApprovalId);
    }

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
    if (typeof resultStream.runId === 'string' && resultStream.runId.trim()) {
      // This is the supervisor run persisted in workflow_run. It is distinct
      // from the BullMQ job ID and is carried into nested edit execution.
      requestContext.set('originatingRunId', resultStream.runId);
    }
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
        jobId: `${jobId}:supervisor`,
        envelopeJobId: jobId,
        source: repair?.source ?? 'supervisor',
        streamId,
        approvalRequestId:
          repair?.source === 'workflow-resume'
            ? repair.repairApprovalId
            : undefined,
      });
    };
    let workflowErrorPublished = false;
    let repairApprovalCreated = false;

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

      await publishChunk(appEvent, { recordTranscript: false });
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

      if (chunkType === 'edit_repair_pending' && !repairApprovalCreated) {
        const payload =
          chunk && typeof chunk === 'object' && 'payload' in chunk
            ? (chunk as { payload?: unknown }).payload
            : undefined;
        const transactionId =
          payload && typeof payload === 'object' && 'transactionId' in payload
            ? (payload as { transactionId?: unknown }).transactionId
            : undefined;
        if (typeof transactionId === 'string' && transactionId.trim()) {
          const repairOriginatingRunId =
            typeof runId === 'string' && runId.trim()
              ? runId
              : requestContext.get('originatingRunId');
          if (
            typeof repairOriginatingRunId !== 'string' ||
            !repairOriginatingRunId.trim()
          ) {
            throw new Error(
              `Repair approval for transaction ${transactionId} is missing its originating workflow run ID`,
            );
          }
          const approvalId = await this.createRepairApproval({
            transactionId,
            conversationId,
            projectId,
            originatingRunId: repairOriginatingRunId,
          });
          repairApprovalCreated = true;
          await publishApprovalRequired({
            approvalId,
            title: 'Review remaining issues?',
            message:
              'The requested changes were applied, but a few issues remain to be fixed.',
            summary:
              'The requested changes are partially complete. Approve a focused repair pass to resolve the remaining issues.',
          });
        }
        continue;
      }

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

        if (repair?.repairApprovalId) {
          await this.db
            .updateTable('preview_platform.workflow_run')
            .set({ status: 'completed' })
            .where('id', '=', repair.repairApprovalId)
            .where('status', '=', 'running')
            .execute();
        }

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
    await this.transcriptService.storeAssistantMessage({
      conversationId,
      message: transcriptParts.join(''),
      sourceId: `supervisor:${jobId}`,
    });
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

  private async createRepairApproval(input: {
    transactionId: string;
    conversationId: string;
    projectId: string;
    originatingRunId: string;
  }): Promise<string> {
    const historyContext = await Promise.allSettled([
      this.anvilHistoryService.readBugs(input.projectId),
      this.anvilHistoryService.readHistory(input.projectId),
    ]);
    this.logger.debug(
      `Repair summary context loaded for transaction ${input.transactionId}: bugs=${historyContext[0]?.status === 'fulfilled' ? historyContext[0].value.length : 0}, history=${historyContext[1]?.status === 'fulfilled' ? historyContext[1].value.length : 0}`,
    );
    const bugs = await this.db
      .selectFrom('preview_platform.edit_bug')
      .select(['bug_key', 'severity', 'category'])
      .where('transaction_id', '=', input.transactionId)
      .where('status', 'in', ['open', 'repairing'])
      .orderBy('created_at', 'desc')
      .execute();
    if (bugs.length === 0) {
      throw new Error(
        `Repair approval cannot be created without open bugs for transaction ${input.transactionId}`,
      );
    }

    const syntheticRunId = `repair:${input.transactionId}`;
    const suspendedStep = {
      type: 'repair_approval_required',
      transactionId: input.transactionId,
      originatingRunId: input.originatingRunId,
      bugCount: bugs.length,
      bugKeys: bugs.map((bug) => bug.bug_key),
    } as unknown as Json;
    const row = await this.db
      .insertInto('preview_platform.workflow_run')
      .values({
        workflow_id: 'anvil-agent-repair-workflow',
        run_id: syntheticRunId,
        conversation_id: input.conversationId,
        project_id: input.projectId,
        status: 'suspended',
        suspended_step: suspendedStep,
        resume_agent_id: null,
        resume_tool_call_id: null,
        resume_tool_name: null,
      })
      .onConflict((oc) =>
        oc.column('run_id').doUpdateSet({
          status: 'suspended',
          suspended_step: suspendedStep,
        }),
      )
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.db
      .updateTable('preview_platform.edit_transaction')
      .set({ status: 'repair_pending' })
      .where('id', '=', input.transactionId)
      .execute();
    this.logger.log(
      `Repair approval record saved for transaction ${input.transactionId}; approval ${row.id}`,
    );
    return row.id;
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
    projectId,
    conversationId,
  }: {
    runId: string;
    approved: boolean;
    toolCallId?: string | null;
    projectId?: string;
    conversationId?: string;
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
    const requestContext = new RequestContext<AnvilAgentContext>();
    requestContext.set('originatingRunId', runId);
    if (projectId?.trim()) requestContext.set('projectId', projectId);
    if (conversationId?.trim()) {
      requestContext.set('conversationId', conversationId);
    }

    return supervisorAgent.resumeStream(
      { approved },
      { runId, requestContext },
    );
  }

  async queueRepairSupervisorAgent(
    transactionId: string,
    approvalRequestId: string,
  ): Promise<void> {
    const transaction = await this.db
      .selectFrom('preview_platform.edit_transaction')
      .select(['conversation_id', 'project_id', 'originating_run_id'])
      .where('id', '=', transactionId)
      .executeTakeFirst();
    if (!transaction) {
      throw new Error(`Edit transaction ${transactionId} was not found`);
    }

    const bugs = await this.db
      .selectFrom('preview_platform.edit_bug')
      .select([
        'bug_key',
        'category',
        'severity',
        'diagnostic',
        'affected_files',
      ])
      .where('transaction_id', '=', transactionId)
      .where('status', 'in', ['open', 'repairing'])
      .orderBy('created_at', 'desc')
      .execute();
    if (bugs.length === 0) {
      throw new Error(`No open repair bugs for transaction ${transactionId}`);
    }
    const attemptRow = await this.db
      .updateTable('preview_platform.edit_transaction')
      .set((eb) => ({
        repair_attempt_count: eb('repair_attempt_count', '+', 1),
      }))
      .where('id', '=', transactionId)
      .whereRef('repair_attempt_count', '<', 'repair_budget')
      .returning('repair_attempt_count')
      .executeTakeFirst();
    if (!attemptRow) {
      throw new Error(`Repair budget exhausted for ${transactionId}`);
    }
    const attempt = attemptRow.repair_attempt_count;

    const messages = (
      await this.db
        .selectFrom('preview_platform.message')
        .select(['role', 'message'])
        .where('conversation_id', '=', transaction.conversation_id)
        .orderBy('sequence_number', 'asc')
        .execute()
    ).map((item) => ({ role: item.role, content: item.message }));
    messages.push({
      role: 'user',
      content: [
        'Run a bounded repair pass for the existing edit transaction.',
        `Transaction: ${transactionId}`,
        'Use the preserved local staging artifacts and resolve the remaining repairable findings.',
        JSON.stringify(bugs),
      ].join('\n'),
    });

    const job = await this.anvilSupervisorAgentTaskQueueProcessor.add(
      'repair-supervisor-query',
      {
        conversation_id: transaction.conversation_id,
        query: 'Repair the remaining issues in the existing edit transaction.',
        messages,
        project_id: transaction.project_id,
        stream_id: `${approvalRequestId}:workflow-resume`,
        originating_run_id: transaction.originating_run_id,
        repair_transaction_id: transactionId,
        repair_approval_id: approvalRequestId,
        stream_source: 'workflow-resume',
      },
      { attempts: 1 },
    );
    if (!job.id) throw new Error('Repair supervisor job id is null');

    await this.db
      .updateTable('preview_platform.edit_transaction')
      .set({ status: 'repairing' })
      .where('id', '=', transactionId)
      .execute();
    await this.db
      .updateTable('preview_platform.edit_bug')
      .set((eb) => ({
        status: 'repairing',
        repair_run_id: String(job.id),
        attempt_count: eb('attempt_count', '+', 1),
      }))
      .where('transaction_id', '=', transactionId)
      .where('status', '=', 'open')
      .execute();
    this.logger.log(
      `Repair run queued: ${String(job.id)} for transaction ${transactionId} (attempt ${attempt})`,
    );
    await this.jobService.insert(
      `${String(job.id)}:supervisor`,
      transaction.conversation_id,
      'supervisor',
    );
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
        .orderBy('sequence_number', 'asc')
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
