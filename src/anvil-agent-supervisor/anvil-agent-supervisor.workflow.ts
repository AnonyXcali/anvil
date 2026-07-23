import { createWorkflow, createStep } from '@mastra/core/workflows';
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
  Z_SEARCH_STRUCTURED_OUTPUT,
} from 'src/anvil-agent/anvil-agent.types';
import { RequestContext } from '@mastra/core/request-context';
import { EDIT_AGENT_INPUT } from 'src/anvil-agent-edit/anvil-agent-edit.types';
import type { ToolStream } from '@mastra/core/tools';

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

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
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
  await writer.custom({
    type: 'edit_agent_diagnostics',
    payload: diagnostics,
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

    return isRecord(payload) && payload.toolName === 'workflow-editWorkflow';
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
      response: diagnostics.response,
      finishReason: diagnostics.finishReason,
    },
  });
}

function compressFileEdits(files: FINAL_RESPONSE_SHAPE[]): EDIT_AGENT_INPUT {
  const fileEditMap = new Map<string, EDIT_AGENT_INPUT[number]>();

  for (const file of files) {
    const filePath = file.file_path.trim();

    if (!filePath) {
      throw new Error('File path is not provided');
    }

    assertPositiveInteger(file.line_range.startRange, 'startRange');
    assertPositiveInteger(file.line_range.endRange, 'endRange');

    if (file.line_range.startRange > file.line_range.endRange) {
      throw new Error('startRange must be less than or equal to endRange');
    }

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
      } satisfies EDIT_AGENT_INPUT[number]);

    if (existingFileEdit.file_exists !== file.file_exists) {
      throw new Error(`Conflicting file_exists values for ${filePath}`);
    }

    existingFileEdit.instructions.push({
      // TODO: Assign a stable instruction UUID here once FILE_EDIT_INSTRUCTION supports id.
      line_range: file.line_range,
      action_tokens: file.action_tokens,
      precise_instruction: file.precise_instruction,
      code: file.code,
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

      const searchAgent = mastra.getAgent(AGENT_DIRECTORY.anvilSearchAgent);
      const execution = await searchAgent.generate(inputData.request, {
        maxSteps: 10,
        structuredOutput: {
          schema: Z_SEARCH_STRUCTURED_OUTPUT,
        },
        requestContext,
      });

      const parsed = Z_SEARCH_STRUCTURED_OUTPUT.safeParse(execution.object);

      // TODO: Implement retry behavior for invalid or incomplete search output.
      if (!parsed.success) {
        throw new Error(`Invalid search output: ${parsed.error.message}`);
      }

      const res = parsed.data;

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
      const { inputData, mastra, writer, resumeData } = context;

      if (resumeData?.approved === true) {
        return {
          files: inputData.response.result,
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
          JSON.stringify(inputData.response.result, null, 2),
        ].join('\n\n'),
      );

      await execution.textStream.pipeTo(writer);
      const summary = await execution.text;

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

      const editAgent = mastra.getAgent(AGENT_DIRECTORY.anvilEditingAgent);
      // TODO: Investigate why anvilEditingAgent may call workflow-editWorkflow multiple times for one edit handoff.
      const stream = await editAgent.stream(
        [
          'Process this normalized FILE_EDIT[] payload.',
          'Use your tools for missing file or folder prerequisites, then invoke workflow-editWorkflow when the payload is workflow-ready.',
          'Return a concise non-technical summary of the completed changes.',
          JSON.stringify(inputData, null, 2),
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
      async ({ inputData }) => compressFileEdits(inputData.files),
      { id: 'anvil-agent-workflow-edit-input-compression' },
    )
    .then(createEditStep())
    .commit();

  return frontendEngineeringWorkflow;
};
