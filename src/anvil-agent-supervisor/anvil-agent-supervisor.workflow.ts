import { createWorkflow, createStep } from '@mastra/core/workflows';
import { Logger } from '@nestjs/common';
import {
  WorkflowInput,
  WorkflowOutput,
  SearchStepOutput,
  PlanStepOutput,
  PlanApprovalResumeInput,
  PlanApprovalSuspendOutput,
  EditHandoffOutput,
} from './anvil-agent-supervisor.types';
import { z } from 'zod';
import { AGENT_DIRECTORY } from 'src/agent.directory';
import {
  AnvilAgentContext,
  FINAL_RESPONSE_SHAPE,
  STRUCTURE_PLAN,
} from 'src/anvil-agent/anvil-agent.types';
import {
  extractSearchPhaseEvidence,
  finalizeSearchPlan,
} from 'src/anvil-agent/anvil-agent-search-phases';
import { sanitizeApprovalSummary } from 'src/anvil-agent/anvil-agent-streaming.helpers';
import { RequestContext } from '@mastra/core/request-context';
import { getUpstreamLlmErrorDiagnostics } from 'src/anvil-agent/anvil-agent-llm-error';
import {
  ANVIL_AGENT_RUNTIME_CONFIG,
  ANVIL_SEARCH_EXECUTION_POLICIES,
  ANVIL_SEARCH_MODE,
} from 'src/mastra/anvil-agent.config';
import {
  EDIT_AGENT_INPUT,
  toModelFacingEditInput,
} from 'src/anvil-agent-edit/anvil-agent-edit.types';
import type { ToolStream } from '@mastra/core/tools';
import {
  sortFilesByDependencies,
  validateStructurePlan,
} from './structural-ordering';
import { validateCompressedFileLineRange } from './edit-range.validation';
import { getEditOperationContractError } from 'src/anvil-agent-edit/edit-operation.validation';

type EditAgentDiagnostics = {
  response: string;
  finishReason: unknown;
  toolCalls: unknown;
  toolResults: unknown;
};

type EditAgentStream = {
  text: Promise<string>;
  toolCalls?: Promise<unknown>;
  toolResults?: Promise<unknown>;
  finishReason?: Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validatePatchContract(file: FINAL_RESPONSE_SHAPE): void {
  const hasPatchToken = file.action_tokens.includes('patch');
  const hasPatchPayload = file.patch !== null && file.patch.trim().length > 0;

  if (hasPatchToken !== hasPatchPayload) {
    throw new Error(
      `patch token requires a non-empty unified diff in patch for ${file.file_path}`,
    );
  }

  if (hasPatchToken && file.action_tokens.includes('replace_file')) {
    throw new Error(
      `patch cannot be combined with replace_file for ${file.file_path}`,
    );
  }
}

async function resolveDiagnosticValue(
  value: Promise<unknown> | undefined,
): Promise<unknown> {
  if (!value) {
    return null;
  }

  const result = await Promise.allSettled([value]);

  if (result[0]?.status === 'fulfilled') {
    return result[0].value;
  }

  return {
    error:
      result[0]?.reason instanceof Error
        ? result[0].reason.message
        : String(result[0]?.reason),
  };
}

async function collectEditAgentDiagnostics(
  stream: EditAgentStream,
): Promise<EditAgentDiagnostics> {
  const [response, finishReason, toolCalls, toolResults] = await Promise.all([
    stream.text,
    resolveDiagnosticValue(stream.finishReason),
    resolveDiagnosticValue(stream.toolCalls),
    resolveDiagnosticValue(stream.toolResults),
  ]);

  return {
    response: response.trim(),
    finishReason,
    toolCalls,
    toolResults,
  };
}

async function writeEditAgentDiagnostics(
  writer: ToolStream,
  diagnostics: EditAgentDiagnostics,
): Promise<void> {
  const workflowToolCalls = countWorkflowEditToolEvents(diagnostics.toolCalls);
  const workflowToolResults = countWorkflowEditToolEvents(
    diagnostics.toolResults,
  );
  await writer.custom({
    type: 'edit_agent_diagnostics',
    payload: {
      finishReason: diagnostics.finishReason,
      responseLength: diagnostics.response.length,
      workflowToolCalls,
      workflowToolResults,
    },
  });
}

function countWorkflowEditToolEvents(events: unknown): number {
  if (!Array.isArray(events)) {
    return 0;
  }

  return events.filter((event: unknown) => {
    if (!isRecord(event)) {
      return false;
    }

    const payload = event.payload;

    return isRecord(payload) && payload.toolName === 'run_edit_workflow';
  }).length;
}

function shouldEmitEditWorkflowInvocationFailure(
  diagnostics: EditAgentDiagnostics,
  workflowToolCalls: number,
  workflowToolResults: number,
): boolean {
  if (workflowToolCalls > 0 && workflowToolResults === 0) {
    return true;
  }

  return diagnostics.response.toLowerCase().includes('edit workflow failed');
}

async function writeEditWorkflowInvocationFailure(
  writer: ToolStream,
  diagnostics: EditAgentDiagnostics,
): Promise<void> {
  const workflowToolCalls = countWorkflowEditToolEvents(diagnostics.toolCalls);
  const workflowToolResults = countWorkflowEditToolEvents(
    diagnostics.toolResults,
  );

  if (
    !shouldEmitEditWorkflowInvocationFailure(
      diagnostics,
      workflowToolCalls,
      workflowToolResults,
    )
  ) {
    return;
  }

  // TODO: Remove edit_workflow_invocation_failure once workflow tool failures are surfaced directly.
  await writer.custom({
    type: 'edit_workflow_invocation_failure',
    payload: {
      workflowToolCalls,
      workflowToolResults,
      finishReason: diagnostics.finishReason,
    },
  });
}

function compressFileEdits(
  files: FINAL_RESPONSE_SHAPE[],
  structurePlan: STRUCTURE_PLAN,
): EDIT_AGENT_INPUT {
  validateStructurePlan(files, structurePlan);
  const orderedFiles = sortFilesByDependencies(files);
  const fileEditMap = new Map<string, EDIT_AGENT_INPUT[number]>();

  for (const file of orderedFiles) {
    const filePath = file.file_path.trim();

    if (!filePath) {
      throw new Error('File path is not provided');
    }

    validatePatchContract(file);
    const operationError = getEditOperationContractError({
      filePath,
      actionTokens: file.action_tokens,
      operation: file.operation,
      fileExists: file.file_exists,
      code: file.code,
    });
    if (operationError) throw new Error(operationError);

    const isWholeFileReplacement = file.action_tokens.includes('replace_file');
    const isPatch = file.action_tokens.includes('patch');

    validateCompressedFileLineRange(
      filePath,
      file.action_tokens,
      file.line_range,
    );

    const existingFileEdit =
      fileEditMap.get(filePath) ??
      ({
        file_path: filePath,
        downloaded_local_file_path: null,
        backup_file: null,
        instructions: [],
        error: null,
        isEdited: false,
        hash: null,
        file_exists: file.file_exists,
        file_type: file.file_type,
        architectural_role: file.architectural_role,
        operation: file.operation,
        depends_on: file.depends_on,
        structure_plan: structurePlan,
      } satisfies EDIT_AGENT_INPUT[number]);

    const hasWholeFileReplacement = existingFileEdit.instructions.some(
      (instruction) => instruction.action_tokens.includes('replace_file'),
    );
    if (isWholeFileReplacement && existingFileEdit.instructions.length > 0) {
      throw new Error(
        `replace_file must be the only instruction for ${filePath}`,
      );
    }
    if (hasWholeFileReplacement) {
      throw new Error(
        `replace_file must be the only instruction for ${filePath}`,
      );
    }

    if (isPatch && existingFileEdit.instructions.length > 0) {
      throw new Error(`patch must be the only instruction for ${filePath}`);
    }
    if (
      existingFileEdit.instructions.some((instruction) =>
        instruction.action_tokens.includes('patch'),
      )
    ) {
      throw new Error(`patch must be the only instruction for ${filePath}`);
    }

    if (existingFileEdit.file_exists !== file.file_exists) {
      throw new Error(`Conflicting file_exists values for ${filePath}`);
    }

    existingFileEdit.instructions.push({
      // TODO: Assign a stable instruction UUID here once FILE_EDIT_INSTRUCTION supports id.
      line_range: file.line_range,
      action_tokens: file.action_tokens,
      precise_instruction: file.precise_instruction,
      code: file.code,
      patch: file.patch,
      verified: false,
    });

    fileEditMap.set(filePath, existingFileEdit);
  }

  return Array.from(fileEditMap.values()).map((fileEdit) => ({
    ...fileEdit,
    instructions: fileEdit.instructions.sort(
      (a, b) => b.line_range.startRange - a.line_range.startRange,
    ),
  }));
}

const createSearchStep = () => {
  const logger = new Logger('AnvilAgentWorkflowSearchStep');
  const searchStep = createStep({
    id: 'anvil-agent-workflow-search-step',
    inputSchema: WorkflowInput,
    outputSchema: SearchStepOutput,
    execute: async ({ inputData, mastra }) => {
      if (!inputData.request || !inputData.projectId) {
        throw new Error('Invalid input request or projectId missing');
      }

      const requestContext = new RequestContext<AnvilAgentContext>();
      requestContext.set('projectId', inputData.projectId);
      requestContext.set('callCount', 0);
      const searchPolicy = ANVIL_SEARCH_EXECUTION_POLICIES[ANVIL_SEARCH_MODE];
      requestContext.set('maxSearchCalls', searchPolicy.maxSearchCalls);

      const searchAgent = mastra.getAgent(AGENT_DIRECTORY.anvilSearchAgent);
      let execution: {
        toolCalls?: unknown;
        toolResults?: unknown;
      };
      try {
        execution = await searchAgent.generate(inputData.request, {
          maxSteps: searchPolicy.maxSteps,
          requestContext,
        });
      } catch (error: unknown) {
        logger.error(
          JSON.stringify(
            getUpstreamLlmErrorDiagnostics(
              error,
              ANVIL_AGENT_RUNTIME_CONFIG.search.model,
              ANVIL_AGENT_RUNTIME_CONFIG.search.model.split('/')[0],
            ),
          ),
        );
        throw error;
      }

      const evidence = extractSearchPhaseEvidence({
        toolCalls: execution.toolCalls,
        toolResults: execution.toolResults,
        policy: searchPolicy,
      });
      const finalizerAgent = mastra.getAgent(
        AGENT_DIRECTORY.anvilSearchFinalizerAgent,
      );
      const res = await finalizeSearchPlan({
        finalizerAgent,
        request: inputData.request,
        evidence,
      });

      if (!res.is_final) {
        throw new Error('Search agent did not return a final response');
      }

      if (res.error) {
        throw new Error(res.error.error_message);
      }

      if (!res.final) {
        throw new Error('No files could be edited');
      }

      if (res.final.files_that_require_change.length === 0) {
        throw new Error('No files require changes');
      }

      const payload: z.infer<typeof SearchStepOutput> = {
        response: {
          result: res.final.files_that_require_change,
          error: null,
          structure_plan: res.final.structure_plan,
        },
      };
      return payload;
    },
  });

  return searchStep;
};

const createPlanStep = () => {
  const planStep = createStep({
    id: 'anvil-agent-workflow-plan-step',
    inputSchema: SearchStepOutput,
    outputSchema: PlanStepOutput,
    resumeSchema: PlanApprovalResumeInput,
    suspendSchema: PlanApprovalSuspendOutput,
    execute: async (context) => {
      const { inputData, mastra, resumeData } = context;

      if (resumeData?.approved === true) {
        validateStructurePlan(
          inputData.response.result,
          inputData.response.structure_plan,
        );
        return {
          files: sortFilesByDependencies(inputData.response.result),
          structure_plan: inputData.response.structure_plan,
        };
      }

      if (resumeData?.approved === false) {
        return context.bail<z.infer<typeof WorkflowOutput>>({
          response: 'No changes were applied.',
        });
      }

      const planningAgent = mastra.getAgent(AGENT_DIRECTORY.anvilPlanningAgent);
      const execution = await planningAgent.stream(
        [
          'Create a strictly non-technical approval summary for these proposed application changes.',
          'Return only the summary text.',
          'Use the structural plan and file changes as internal context. Never reveal file paths, dependency metadata, patches, or implementation details in the summary.',
          JSON.stringify(inputData.response, null, 2),
        ].join('\n\n'),
      );

      const summary = sanitizeApprovalSummary(await execution.text);

      return context.suspend({
        type: 'approval_required',
        payload: {
          title: 'Apply proposed changes?',
          message:
            'The AI has prepared a set of changes that require your approval.',
          summary,
        },
      });
    },
  });

  return planStep;
};

const createEditStep = () => {
  const editStep = createStep({
    id: 'anvil-agent-workflow-edit-step',
    inputSchema: EditHandoffOutput,
    outputSchema: WorkflowOutput,
    execute: async (context) => {
      const { inputData, mastra, requestContext, writer } = context;
      const projectId = requestContext.get('projectId');

      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for edit step');
      }

      const editAgentRequestContext = new RequestContext<AnvilAgentContext>();
      editAgentRequestContext.set('projectId', projectId);
      editAgentRequestContext.set('callCount', 0);
      const conversationId = requestContext.get('conversationId');
      if (typeof conversationId === 'string' && conversationId.trim()) {
        editAgentRequestContext.set('conversationId', conversationId);
      }
      const originatingRunId = requestContext.get('originatingRunId');
      const editTransactionId = requestContext.get('editTransactionId');
      if (typeof originatingRunId !== 'string' || !originatingRunId.trim()) {
        throw new Error(
          'Original supervisor workflow run ID is unavailable for editing',
        );
      }
      editAgentRequestContext.set('originatingRunId', originatingRunId);
      if (typeof editTransactionId === 'string' && editTransactionId.trim()) {
        editAgentRequestContext.set('editTransactionId', editTransactionId);
      }
      const repairApprovalId = requestContext.get('repairApprovalId');
      if (typeof repairApprovalId === 'string' && repairApprovalId.trim()) {
        editAgentRequestContext.set('repairApprovalId', repairApprovalId);
      }
      const structurePlan = inputData[0]?.structure_plan;
      if (!structurePlan) {
        throw new Error('Canonical structural plan is unavailable for editing');
      }
      editAgentRequestContext.set('structurePlan', structurePlan);
      editAgentRequestContext.set('multiFileHandoff', inputData.length > 1);
      editAgentRequestContext.set('editProgress', async (event) => {
        try {
          await writer.custom({
            type: 'edit_progress',
            payload: event,
          });
        } catch {
          // Progress is best-effort and must not change the edit result.
        }
      });
      editAgentRequestContext.set('editDiagnostic', async (event) => {
        try {
          await writer.custom(event);
        } catch {
          // Diagnostics are best-effort and must not change the edit result.
        }
      });

      const editAgent = mastra.getAgent(AGENT_DIRECTORY.anvilEditingAgent);
      // TODO: Investigate why anvilEditingAgent may call run_edit_workflow multiple times for one edit handoff.
      const stream = await editAgent.stream(
        [
          'Process this normalized FILE_EDIT[] payload.',
          'Use your tools for missing file or folder prerequisites, then invoke run_edit_workflow when the payload is workflow-ready.',
          'Return a concise non-technical summary of the completed changes.',
          JSON.stringify(toModelFacingEditInput(inputData), null, 2),
        ].join('\n\n'),
        {
          maxSteps: 20,
          requestContext: editAgentRequestContext,
        },
      );

      await stream.textStream.pipeTo(writer, { preventClose: true });
      const diagnostics = await collectEditAgentDiagnostics(stream);
      await writeEditAgentDiagnostics(writer, diagnostics);
      await writeEditWorkflowInvocationFailure(writer, diagnostics);

      const editWorkflowFailure = editAgentRequestContext.get(
        'editWorkflowFailure',
      );
      if (editWorkflowFailure) {
        throw new Error(editWorkflowFailure);
      }

      return {
        response: diagnostics.response || 'Changes were applied.',
      };
    },
  });

  return editStep;
};

export const createFrontendEngineeringWorkflow = () => {
  const frontendEngineeringWorkflow = createWorkflow({
    id: 'anvil-agent-create-workflow',
    inputSchema: WorkflowInput,
    outputSchema: WorkflowOutput,
  })
    .then(createSearchStep())
    .then(createPlanStep())
    .map(
      // eslint-disable-next-line @typescript-eslint/require-await
      async ({ inputData }) =>
        compressFileEdits(inputData.files, inputData.structure_plan),
      { id: 'anvil-agent-workflow-edit-input-compression' },
    )
    .then(createEditStep())
    .commit();

  return frontendEngineeringWorkflow;
};
