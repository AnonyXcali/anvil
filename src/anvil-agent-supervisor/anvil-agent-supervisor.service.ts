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
import { AnvilRepairStateService } from 'src/anvil-agent-edit/anvil-repair-state.service';
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
    private readonly anvilRepairStateService: AnvilRepairStateService,
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
      if (repair?.repairTransactionId) {
        requestContext.set('repairRunId', resultStream.runId);
        await this.db
          .updateTable('preview_platform.edit_bug')
          .set({ repair_run_id: resultStream.runId })
          .where('transaction_id', '=', repair.repairTransactionId)
          .where('status', 'in', ['open', 'repairing'])
          .execute();
      } else {
        requestContext.set('originatingRunId', resultStream.runId);
        await this.upsertWorkflowRun({
          workflowId: FRONTEND_ENGINEERING_WORKFLOW_ID,
          runId: resultStream.runId,
          conversationId,
          projectId,
          status: 'running',
          suspendedStep: null,
          resumeAgentId: null,
          resumeToolCallId: null,
          resumeToolName: null,
        });
        this.logger.log(`Workflow run persisted: ${resultStream.runId}`);
      }
    }
    const transcriptParts: string[] = [];
    let repairOriginatingRunId = requestContext.get('originatingRunId');
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
    let terminalWorkflowError = false;

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
        terminalWorkflowError = true;
        abortController.abort(new Error('Nested workflow failed'));
        break;
      }

      const chunkType = getStreamChunkType(chunk);
      const { workflowId, runId } = getWorkflowIdentifiers(chunk);

      if (chunkType === 'edit_repair_pending') {
        // Keep this event as a fast-path signal for streams that emit it, but
        // reconcile against persisted repair state after the stream settles.
        if (
          (typeof repairOriginatingRunId !== 'string' ||
            !repairOriginatingRunId.trim()) &&
          typeof runId === 'string' &&
          runId.trim()
        ) {
          repairOriginatingRunId = runId;
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

    const normalizedRepairOriginatingRunId =
      typeof repairOriginatingRunId === 'string'
        ? repairOriginatingRunId.trim()
        : '';
    this.logger.log(
      `Repair reconciliation gate: terminalWorkflowError=${terminalWorkflowError}, repairOriginatingRunId=${normalizedRepairOriginatingRunId || '(missing)'}`,
    );

    if (terminalWorkflowError) {
      this.logger.debug(
        'Repair reconciliation skipped because a terminal workflow error was emitted',
      );
    } else if (!normalizedRepairOriginatingRunId) {
      this.logger.warn(
        'Repair reconciliation skipped because the originating workflow run ID is missing',
      );
    } else {
      try {
        const candidate =
          await this.anvilRepairStateService.findPendingRepairForRun({
            projectId,
            conversationId,
            originatingRunId: normalizedRepairOriginatingRunId,
          });
        if (candidate) {
          this.logger.log(
            `Repair state found for workflow run ${normalizedRepairOriginatingRunId}: transaction ${candidate.transactionId}, open bugs ${candidate.bugs.length}`,
          );
          const approval =
            await this.anvilRepairStateService.createOrReuseRepairApproval(
              candidate,
            );
          this.logger.log(
            `Repair approval ${approval.created ? 'created' : 'reused'}: ${approval.approvalId} for transaction ${approval.transactionId}`,
          );
          if (approval.created) {
            await publishApprovalRequired({
              approvalId: approval.approvalId,
              title: 'Review remaining issues?',
              message:
                'The requested changes were applied, but a few issues remain to be fixed.',
              summary:
                'The requested changes are partially complete. Approve a focused repair pass to resolve the remaining issues.',
            });
          }
        } else {
          this.logger.debug(
            `No eligible repair state found for workflow run ${normalizedRepairOriginatingRunId}`,
          );
        }
      } catch (error) {
        this.logger.error(
          `Repair-state reconciliation failed for workflow run ${normalizedRepairOriginatingRunId}; preserving the original supervisor result`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    if (repair?.repairApprovalId) {
      await this.db
        .updateTable('preview_platform.workflow_run')
        .set({ status: terminalWorkflowError ? 'failed' : 'completed' })
        .where('id', '=', repair.repairApprovalId)
        .where('status', '=', 'running')
        .execute();
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
