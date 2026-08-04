import { createWorkflow, createStep } from '@mastra/core/workflows';
import {
  Z_EDIT_AGENT_WORKFLOW_INPUT,
  Z_FILE_EDIT,
  FILE_EDIT_INSTRUCTION,
  FILE_EDIT,
  EDIT_AGENT_INPUT,
  INSTRUCTION,
} from './anvil-agent-edit.types';
import { z } from 'zod';
import { AnvilAgentEditService } from './anvil-agent-edit.service';
import { AnvilHistoryService } from 'src/anvil-history/anvil-history.service';
import type { HistoryEntryInput } from 'src/anvil-history/anvil-history.types';
import { readFile } from 'fs/promises';
import { AGENT_DIRECTORY } from 'src/agent.directory';
import { RequestContext } from '@mastra/core/request-context';
import { createRubricScorer } from '@mastra/evals/scorers/prebuilt';
import {
  isCssFilePath,
  validateCssEdit,
  type StagedFile,
  type CssEditValidationResult,
} from './css-validation';
import type {
  EditCleanupTarget,
  EditDiagnosticSink,
  EditProgressSink,
  EditProgressStatus,
} from 'src/anvil-agent/anvil-agent.types';

type EditWorkflowDeps = {
  anvilAgentEditService: AnvilAgentEditService;
  anvilHistoryService: AnvilHistoryService;
};

type VerifyAgentContext = {
  localFilePath: string;
  projectFilePath: string;
  projectId: string;
  rubric: string;
};

const DOWNLOAD_STEP = 'anvil-edit-agent-nested-workflow-download-file-step';
const BACKUP_STEP =
  'anvil-edit-agent-nested-workflow-backup-original-file-step';
const APPLY_EDIT_STEP = 'anvil-edit-agent-nested-workflow-apply-edit-file-step';
const VERIFY_STEP = 'anvil-edit-agent-nested-workflow-verify-edit-file-step';
const UPLOAD_FILE_STEP =
  'anvil-edit-agent-nested-workflow-upload-edit-file-step';
const DELETE_STEP = 'anvil-edit-agent-nested-workflow-delete-temp-file-step';
const VERIFY_TIMEOUT_MS = 500_000;

function isEditProgressSink(value: unknown): value is EditProgressSink {
  return typeof value === 'function';
}

function isEditDiagnosticSink(value: unknown): value is EditDiagnosticSink {
  return typeof value === 'function';
}

function isEditCleanupTarget(value: unknown): value is EditCleanupTarget {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const target = value as Record<string, unknown>;
  return (
    typeof target.projectId === 'string' &&
    typeof target.localFilePath === 'string' &&
    (target.backupFilePath === undefined ||
      typeof target.backupFilePath === 'string')
  );
}

async function emitEditProgress(
  requestContext: RequestContext<unknown>,
  step: string,
  status: EditProgressStatus,
  message: string,
): Promise<void> {
  try {
    const sink = requestContext.get('editProgress');
    if (isEditProgressSink(sink)) {
      await sink({ step, status, message });
    }
  } catch {
    // Progress is best-effort and must not change workflow execution.
  }
}

async function withEditProgress<T>(
  requestContext: RequestContext<unknown>,
  step: string,
  message: string,
  operation: () => Promise<T>,
): Promise<T> {
  await emitEditProgress(requestContext, step, 'started', message);

  try {
    const result = await operation();
    await emitEditProgress(requestContext, step, 'completed', message);
    return result;
  } catch (error) {
    await emitEditProgress(requestContext, step, 'failed', message);
    throw error;
  }
}

async function emitEditDiagnostic(
  requestContext: RequestContext<unknown>,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const sink = requestContext.get('editDiagnostic');
    if (isEditDiagnosticSink(sink)) {
      await sink({ type, payload });
    }
  } catch {
    // Diagnostics are best-effort and must not change workflow execution.
  }
}

async function appendWorkflowHistoryBestEffort(
  historyService: AnvilHistoryService,
  requestContext: RequestContext<unknown>,
  projectId: string,
  entry: HistoryEntryInput,
): Promise<void> {
  try {
    await historyService.appendHistoryEntry(projectId, entry);
  } catch (error: unknown) {
    await emitEditDiagnostic(requestContext, 'history_write_warning', {
      message: error instanceof Error ? error.message : String(error),
      subject: entry.subject,
    });
  }
}

async function validateCssStage(
  historyService: AnvilHistoryService,
  requestContext: RequestContext<unknown>,
  filePath: string,
  localFilePath: string,
  stage: 'pre' | 'post' | 'final',
  enforce = true,
): Promise<CssEditValidationResult> {
  if (!isCssFilePath(filePath)) {
    return { applicable: false, valid: true, findings: [] };
  }

  const content = await readFile(localFilePath, 'utf8');
  const stagedFiles = requestContext.get('cssStagedFiles');
  const result = validateCssEdit({
    cssFilePath: filePath,
    cssContent: content,
    stagedFiles: Array.isArray(stagedFiles)
      ? (stagedFiles as StagedFile[])
      : undefined,
  });
  const diagnosticPayload = {
    filePath,
    stage,
    valid: result.valid,
    diagnostics: result.findings,
  };
  await emitEditDiagnostic(requestContext, 'css_validation', diagnosticPayload);

  const projectId = requestContext.get('projectId');
  if (typeof projectId === 'string' && projectId.trim()) {
    await appendWorkflowHistoryBestEffort(
      historyService,
      requestContext,
      projectId,
      {
        subject: `CSS validation (${stage})`,
        status: result.valid ? 'success' : 'failed',
        changesMade: result.valid
          ? `CSS syntax validation passed for ${filePath}.`
          : result.findings
              .map(
                (item) =>
                  `${item.message} (line ${item.line}, column ${item.column})`,
              )
              .join('; '),
        files: [filePath],
        actor: 'anvil-edit-workflow.css-validation',
      },
    );
  }

  if (!result.valid && enforce) {
    throw new Error(
      `CSS validation failed for ${filePath} during ${stage} validation: ${result.findings
        .map((item) => `${item.message} at ${item.line}:${item.column}`)
        .join('; ')}`,
    );
  }

  return result;
}

function getCleanupTargets(
  requestContext: RequestContext<unknown>,
): EditCleanupTarget[] {
  const targets = requestContext.get('editCleanupTargets');
  const validTargets: EditCleanupTarget[] = [];
  if (Array.isArray(targets)) {
    for (const target of targets as unknown[]) {
      if (isEditCleanupTarget(target)) {
        validTargets.push(target);
      }
    }
  }
  return validTargets;
}

function registerCleanupTarget(
  requestContext: RequestContext<unknown>,
  target: EditCleanupTarget,
): void {
  const targets = getCleanupTargets(requestContext);
  const existing = targets.find(
    (item) => item.localFilePath === target.localFilePath,
  );

  if (existing) {
    Object.assign(existing, target);
  } else {
    targets.push(target);
  }

  requestContext.set('editCleanupTargets', targets);
}

const APPLY_EDIT_INPUT = z.object({
  file_path: z.string(),
  instruction: INSTRUCTION,
});

const APPLY_EDIT_INPUTS = z.array(APPLY_EDIT_INPUT);

const UPLOAD_FILE_INPUT = z.object({
  localFilePath: z.string(),
  originalFilePath: z.string(),
  originalHash: z.string(),
});

const CLEANUP_INPUT = z.object({
  file_path: z.string(),
  backupFilePath: z.string(),
  localFilePath: z.string(),
});

// const Z_VERIFY_AGENT_OUTPUT = z.object({
//   verified: z.boolean(),
//   fix_instruction: z
//     .object({
//       file_path: z.string(),
//       instruction: z.string(),
//       code: z.string(),
//       line_range: z.object({
//         startRange: z.number(),
//         endRange: z.number(),
//       }),
//     })
//     .nullable(),
// });

function isSameInstruction(
  left: FILE_EDIT_INSTRUCTION,
  right: FILE_EDIT_INSTRUCTION,
): boolean {
  // TODO: Replace this field-by-field match with instruction.id once FILE_EDIT_INSTRUCTION has a UUID.
  return (
    left.precise_instruction === right.precise_instruction &&
    left.code === right.code &&
    left.line_range.startRange === right.line_range.startRange &&
    left.line_range.endRange === right.line_range.endRange &&
    left.action_tokens.length === right.action_tokens.length &&
    left.action_tokens.every(
      (token, index) => token === right.action_tokens[index],
    )
  );
}

function fatalStateError(stepName: string, filePath: string, detail: string) {
  return new Error(
    `Fatal nested edit workflow state error in ${stepName} for ${filePath}: ${detail}`,
  );
}

function requireFileEditState(
  state: EDIT_AGENT_INPUT | null | undefined,
  filePath: string,
  stepName: string,
): FILE_EDIT {
  if (!Array.isArray(state)) {
    throw fatalStateError(stepName, filePath, 'workflow state is not an array');
  }

  const fileEdit = state.find((item) => item.file_path === filePath);

  if (!fileEdit) {
    throw fatalStateError(stepName, filePath, 'missing FILE_EDIT state');
  }

  return fileEdit;
}

function requireStateString(
  value: string | null,
  fieldName: keyof Pick<
    FILE_EDIT,
    'downloaded_local_file_path' | 'hash' | 'backup_file'
  >,
  filePath: string,
  stepName: string,
): string {
  if (!value) {
    throw fatalStateError(stepName, filePath, `${fieldName} is unavailable`);
  }

  return value;
}

const createDeleteStep = (deps: EditWorkflowDeps) => {
  const deleteStep = createStep({
    id: DELETE_STEP,
    inputSchema: CLEANUP_INPUT,
    outputSchema: Z_FILE_EDIT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, requestContext, state } = context;
      const projectId = requestContext.get('projectId');

      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for cleanup step');
      }

      if (!inputData.file_path.trim()) {
        throw new Error('File path is unavailable for cleanup step');
      }

      if (!inputData.backupFilePath.trim()) {
        throw new Error('Backup file path is unavailable for cleanup step');
      }

      if (!inputData.localFilePath.trim()) {
        throw new Error('Local file path is unavailable for cleanup step');
      }

      const fileEdit = requireFileEditState(
        state,
        inputData.file_path,
        DELETE_STEP,
      );
      const backupFilePath = requireStateString(
        fileEdit.backup_file,
        'backup_file',
        inputData.file_path,
        DELETE_STEP,
      );
      const localFilePath = requireStateString(
        fileEdit.downloaded_local_file_path,
        'downloaded_local_file_path',
        inputData.file_path,
        DELETE_STEP,
      );

      await withEditProgress(
        requestContext,
        DELETE_STEP,
        'Cleaning up temporary files.',
        () =>
          deps.anvilAgentEditService.cleanUp(
            projectId,
            backupFilePath,
            localFilePath,
          ),
      );

      return fileEdit;
    },
  });

  return deleteStep;
};

const createUploadFileStep = (deps: EditWorkflowDeps) => {
  const uploadFileStep = createStep({
    id: UPLOAD_FILE_STEP,
    inputSchema: UPLOAD_FILE_INPUT,
    outputSchema: z.object({
      success: z.boolean(),
      file_path: z.string().nullable(),
    }),
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, requestContext, state } = context;
      const projectId = requestContext.get('projectId');

      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for upload step');
      }

      if (!inputData.localFilePath.trim()) {
        throw new Error('Local file path is unavailable for upload step');
      }

      if (!inputData.originalFilePath.trim()) {
        throw new Error('Original file path is unavailable for upload step');
      }

      if (!inputData.originalHash.trim()) {
        throw new Error('Original hash is unavailable for upload step');
      }

      const fileEdit = requireFileEditState(
        state,
        inputData.originalFilePath,
        UPLOAD_FILE_STEP,
      );
      const downloadedLocalFilePath = requireStateString(
        fileEdit.downloaded_local_file_path,
        'downloaded_local_file_path',
        inputData.originalFilePath,
        UPLOAD_FILE_STEP,
      );
      const hash = requireStateString(
        fileEdit.hash,
        'hash',
        inputData.originalFilePath,
        UPLOAD_FILE_STEP,
      );

      if (downloadedLocalFilePath !== inputData.localFilePath) {
        throw new Error(
          `Upload local file path does not match workflow state for ${inputData.originalFilePath}`,
        );
      }

      if (hash !== inputData.originalHash) {
        throw new Error(
          `Upload hash does not match workflow state for ${inputData.originalFilePath}`,
        );
      }

      if (fileEdit.instructions.some((instruction) => !instruction.verified)) {
        throw new Error(
          `Cannot upload ${inputData.originalFilePath} before all instructions are verified`,
        );
      }

      await withEditProgress(
        requestContext,
        UPLOAD_FILE_STEP,
        'Uploading the verified file.',
        () =>
          deps.anvilAgentEditService.upload(
            projectId,
            inputData.localFilePath,
            inputData.originalFilePath,
            inputData.originalHash,
          ),
      );

      return {
        success: true,
        file_path: inputData.originalFilePath,
      };
    },
  });

  return uploadFileStep;
};

const createVerifyStep = (deps: EditWorkflowDeps) => {
  const verifyStep = createStep({
    id: VERIFY_STEP,
    inputSchema: APPLY_EDIT_INPUT,
    outputSchema: APPLY_EDIT_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, mastra, state } = context;
      const fileEdit = requireFileEditState(
        state,
        inputData.file_path,
        VERIFY_STEP,
      );
      const downloadedLocalFilePath = requireStateString(
        fileEdit.downloaded_local_file_path,
        'downloaded_local_file_path',
        inputData.file_path,
        VERIFY_STEP,
      );

      const initialCssValidation = await validateCssStage(
        deps.anvilHistoryService,
        context.requestContext,
        inputData.file_path,
        downloadedLocalFilePath,
        'pre',
        false,
      );
      const fileContent = await readFile(downloadedLocalFilePath, 'utf8');
      const verifyAgent = mastra.getAgent(AGENT_DIRECTORY.anvilVerifyAgent);
      const rubricScorer = createRubricScorer({
        model: 'openai/gpt-5-mini',
      });
      const requestContext = new RequestContext<VerifyAgentContext>();
      const rubric = `Changes should satisfy ${inputData.instruction.precise_instruction}`;
      let scorerComplete = false;
      let scorerFailureReason: string | undefined;
      const verifyAbortController = new AbortController();
      let verificationTimedOut = false;
      const verificationTimeout = setTimeout(() => {
        verificationTimedOut = true;
        verifyAbortController.abort();
      }, VERIFY_TIMEOUT_MS);

      requestContext.set('localFilePath', downloadedLocalFilePath);
      requestContext.set('projectFilePath', inputData.file_path);
      requestContext.set('projectId', context.requestContext.get('projectId'));
      requestContext.set('rubric', rubric);

      await withEditProgress(
        context.requestContext,
        VERIFY_STEP,
        'Verifying the edit.',
        async () => {
          await emitEditDiagnostic(
            context.requestContext,
            'edit_verification_started',
            {
              filePath: inputData.file_path,
              timeoutMs: VERIFY_TIMEOUT_MS,
            },
          );

          try {
            await verifyAgent.generate(
              [
                'Verify this local file edit instruction.',
                `Local file path: ${downloadedLocalFilePath}`,
                `Project file path: ${inputData.file_path}`,
                `Precise instruction: ${inputData.instruction.precise_instruction}`,
                `Action tokens: ${inputData.instruction.action_tokens.join(', ')}`,
                `Expected code: ${inputData.instruction.code ?? '<null>'}`,
                `Line range: ${JSON.stringify(inputData.instruction.line_range)}`,
                'Deterministic CSS findings to correct before completion:',
                JSON.stringify(initialCssValidation.findings),
                'Current local file content:',
                fileContent,
              ].join('\n\n'),
              {
                maxSteps: 20,
                abortSignal: verifyAbortController.signal,
                // structuredOutput: {
                //   schema: Z_VERIFY_AGENT_OUTPUT,
                // },
                requestContext,
                isTaskComplete: {
                  scorers: [rubricScorer],
                  strategy: 'all',
                  timeout: 30000,
                  parallel: true,
                  suppressFeedback: false,
                  onComplete: (result) => {
                    scorerComplete = result.complete;
                    void emitEditDiagnostic(
                      context.requestContext,
                      'edit_verification_scorer',
                      {
                        filePath: inputData.file_path,
                        complete: result.complete,
                        completionReason: result.completionReason,
                        scorerCount: result.scorers.length,
                      },
                    );

                    if (!scorerComplete) {
                      scorerFailureReason =
                        result.completionReason ??
                        result.scorers
                          .filter((scorerResult) => !scorerResult.passed)
                          .map((scorerResult) => scorerResult.reason)
                          .filter(Boolean)
                          .join('\n');
                    }
                  },
                },
                onIterationComplete: async (iterationContext) => {
                  await emitEditDiagnostic(
                    context.requestContext,
                    'edit_verification_iteration',
                    {
                      filePath: inputData.file_path,
                      iteration: iterationContext.iteration,
                      isFinal: iterationContext.isFinal,
                      finishReason: iterationContext.finishReason,
                      toolCalls: iterationContext.toolCalls.map(
                        (toolCall) => toolCall.name,
                      ),
                      toolResults: iterationContext.toolResults.map(
                        (toolResult) => ({
                          name: toolResult.name,
                          failed: Boolean(toolResult.error),
                        }),
                      ),
                    },
                  );

                  if (iterationContext.iteration >= 20) {
                    return {
                      continue: false,
                      feedback: 'Maximum verification iterations reached.',
                    };
                  }
                },
              },
            );

            if (!scorerComplete) {
              throw new Error(
                scorerFailureReason ||
                  `Verification failed for ${inputData.file_path}`,
              );
            }

            await validateCssStage(
              deps.anvilHistoryService,
              context.requestContext,
              inputData.file_path,
              downloadedLocalFilePath,
              'post',
              true,
            );

            await emitEditDiagnostic(
              context.requestContext,
              'edit_verification_completed',
              { filePath: inputData.file_path },
            );
            const projectId = context.requestContext.get('projectId');
            if (typeof projectId === 'string' && projectId.trim()) {
              await appendWorkflowHistoryBestEffort(
                deps.anvilHistoryService,
                context.requestContext,
                projectId,
                {
                  subject: 'Verify requested edit',
                  status: 'success',
                  changesMade: 'Verification completed successfully.',
                  files: [inputData.file_path],
                  actor: 'anvil-edit-workflow.verify-edit',
                },
              );
            }
          } catch (error: unknown) {
            const verificationError = verificationTimedOut
              ? new Error(
                  `Verification timed out after ${VERIFY_TIMEOUT_MS / 1000} seconds for ${inputData.file_path}`,
                )
              : error;
            await emitEditDiagnostic(
              context.requestContext,
              'edit_verification_failed',
              {
                filePath: inputData.file_path,
                message:
                  verificationError instanceof Error
                    ? verificationError.message
                    : String(verificationError),
                timedOut: verificationTimedOut,
              },
            );
            const projectId = context.requestContext.get('projectId');
            if (typeof projectId === 'string' && projectId.trim()) {
              await appendWorkflowHistoryBestEffort(
                deps.anvilHistoryService,
                context.requestContext,
                projectId,
                {
                  subject: 'Verify requested edit',
                  status: 'failed',
                  changesMade:
                    verificationError instanceof Error
                      ? verificationError.message
                      : String(verificationError),
                  files: [inputData.file_path],
                  actor: 'anvil-edit-workflow.verify-edit',
                },
              );
            }
            throw verificationError;
          } finally {
            clearTimeout(verificationTimeout);
          }
        },
      );

      // const parsed = Z_VERIFY_AGENT_OUTPUT.safeParse(execution.object);

      // if (!parsed.success) {
      //   throw new Error(`Invalid verify output: ${parsed.error.message}`);
      // }

      // if (parsed.data.fix_instruction !== null) {
      //   throw new Error(
      //     `Verified output must not include a fix instruction for ${inputData.file_path}`,
      //   );
      // }

      let instructionWasUpdated = false;
      const verifiedInstruction: FILE_EDIT_INSTRUCTION = {
        ...inputData.instruction,
        verified: true,
      };

      const nextState = state.map((item) =>
        item.file_path === inputData.file_path
          ? {
              ...item,
              instructions: item.instructions.map((instruction) => {
                if (
                  !instructionWasUpdated &&
                  isSameInstruction(instruction, inputData.instruction)
                ) {
                  instructionWasUpdated = true;
                  return verifiedInstruction;
                }

                return instruction;
              }),
            }
          : item,
      );

      if (!instructionWasUpdated) {
        throw new Error(
          `No matching instruction found for ${inputData.file_path}`,
        );
      }

      requireFileEditState(nextState, inputData.file_path, VERIFY_STEP);
      await context.setState(nextState);

      return {
        file_path: inputData.file_path,
        instruction: verifiedInstruction,
      };
    },
  });

  return verifyStep;
};

const createDownloadStep = (deps: EditWorkflowDeps) => {
  const downloadStep = createStep({
    id: DOWNLOAD_STEP,
    inputSchema: Z_FILE_EDIT,
    outputSchema: z.object({ file_path: z.string() }),
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, requestContext, state } = context;
      const projectId = requestContext.get('projectId');

      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for download step');
      }

      if (!inputData.file_exists) {
        throw new Error(
          `Cannot download ${inputData.file_path} before the file exists`,
        );
      }

      // TODO: Handle local downloaded file collisions.
      const { localFilePath, hash } = await withEditProgress(
        requestContext,
        DOWNLOAD_STEP,
        'Downloading the target file.',
        () =>
          deps.anvilAgentEditService.downloadFile(
            projectId,
            inputData.file_path,
          ),
      );
      registerCleanupTarget(requestContext, {
        projectId,
        localFilePath,
      });

      if (isCssFilePath(inputData.file_path)) {
        const relatedStyleFiles =
          await deps.anvilAgentEditService.getRelatedStyleFiles(
            projectId,
            inputData.file_path,
          );
        requestContext.set('cssStagedFiles', relatedStyleFiles);
      }

      await validateCssStage(
        deps.anvilHistoryService,
        requestContext,
        inputData.file_path,
        localFilePath,
        'pre',
        false,
      );

      await context.writer.custom({
        type: 'edit_download_diagnostics',
        payload: {
          file_path: inputData.file_path,
          localFilePath,
          hash,
        },
      });

      const existingState = Array.isArray(state) ? state : [];
      const hasCurrentFileState = existingState.some(
        (fileEdit) => fileEdit.file_path === inputData.file_path,
      );
      const nextState = hasCurrentFileState
        ? existingState.map((fileEdit) =>
            fileEdit.file_path === inputData.file_path
              ? {
                  ...fileEdit,
                  downloaded_local_file_path: localFilePath,
                  hash,
                }
              : fileEdit,
          )
        : [
            ...existingState,
            {
              ...inputData,
              downloaded_local_file_path: localFilePath,
              hash,
            },
          ];

      // Nested workflow state can be missing when the workflow tool is invoked
      // without initialState, so seed it from inputData and assert integrity.
      requireFileEditState(nextState, inputData.file_path, DOWNLOAD_STEP);
      await context.setState(nextState);

      return { file_path: inputData.file_path };
    },
  });

  return downloadStep;
};

const createApplyEditStep = (deps: EditWorkflowDeps) => {
  const applyEditStep = createStep({
    id: APPLY_EDIT_STEP,
    inputSchema: APPLY_EDIT_INPUT,
    outputSchema: APPLY_EDIT_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, state } = context;
      const { instruction } = inputData;
      const fileEdit = requireFileEditState(
        state,
        inputData.file_path,
        APPLY_EDIT_STEP,
      );
      const downloadedLocalFilePath = requireStateString(
        fileEdit.downloaded_local_file_path,
        'downloaded_local_file_path',
        inputData.file_path,
        APPLY_EDIT_STEP,
      );

      if (
        instruction.code === null &&
        !instruction.action_tokens.includes('delete')
      ) {
        throw new Error(
          `Instruction code is required for ${inputData.file_path}`,
        );
      }

      const targetChange = instruction.code ?? '';
      const projectId = context.requestContext.get('projectId');
      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for edit history');
      }

      try {
        const editRange = instruction.action_tokens.includes('replace_file')
          ? {
              start: 1,
              end: Math.max(
                1,
                (await readFile(downloadedLocalFilePath, 'utf8')).split('\n')
                  .length,
              ),
            }
          : {
              start: instruction.line_range.startRange,
              end: instruction.line_range.endRange,
            };
        await withEditProgress(
          context.requestContext,
          APPLY_EDIT_STEP,
          'Applying the requested edit locally.',
          () =>
            instruction.action_tokens.includes('replace_file')
              ? deps.anvilAgentEditService.replaceLocalFile(
                  downloadedLocalFilePath,
                  targetChange,
                )
              : deps.anvilAgentEditService.edit(
                  downloadedLocalFilePath,
                  targetChange,
                  editRange,
                ),
        );
        await validateCssStage(
          deps.anvilHistoryService,
          context.requestContext,
          inputData.file_path,
          downloadedLocalFilePath,
          'post',
          false,
        );
        await appendWorkflowHistoryBestEffort(
          deps.anvilHistoryService,
          context.requestContext,
          projectId,
          {
            subject: 'Apply requested edit',
            status: 'success',
            changesMade: instruction.precise_instruction,
            files: [inputData.file_path],
            actor: 'anvil-edit-workflow.apply-edit',
          },
        );
      } catch (error: unknown) {
        await appendWorkflowHistoryBestEffort(
          deps.anvilHistoryService,
          context.requestContext,
          projectId,
          {
            subject: 'Apply requested edit',
            status: 'failed',
            changesMade: error instanceof Error ? error.message : String(error),
            files: [inputData.file_path],
            actor: 'anvil-edit-workflow.apply-edit',
          },
        );
        throw error;
      }

      const nextState = state.map((item) =>
        item.file_path === inputData.file_path
          ? {
              ...item,
              isEdited: true,
            }
          : item,
      );
      requireFileEditState(nextState, inputData.file_path, APPLY_EDIT_STEP);
      await context.setState(nextState);

      return inputData;
    },
  });

  return applyEditStep;
};

const createGeneratedBackupStep = (deps: EditWorkflowDeps) => {
  const backupStep = createStep({
    id: BACKUP_STEP,
    inputSchema: z.object({ file_path: z.string() }),
    outputSchema: APPLY_EDIT_INPUTS,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, requestContext, state } = context;
      const projectId = requestContext.get('projectId');

      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for backup step');
      }

      const fileEdit = requireFileEditState(
        state,
        inputData.file_path,
        BACKUP_STEP,
      );

      const backupFilePath = await withEditProgress(
        requestContext,
        BACKUP_STEP,
        'Creating a backup of the original file.',
        () =>
          deps.anvilAgentEditService.createBackupFile(
            projectId,
            inputData.file_path,
          ),
      );
      registerCleanupTarget(requestContext, {
        projectId,
        localFilePath: requireStateString(
          fileEdit.downloaded_local_file_path,
          'downloaded_local_file_path',
          inputData.file_path,
          BACKUP_STEP,
        ),
        backupFilePath,
      });

      const nextState = state.map((item) =>
        item.file_path === inputData.file_path
          ? {
              ...item,
              backup_file: backupFilePath,
            }
          : item,
      );
      const nextFileEdit = requireFileEditState(
        nextState,
        inputData.file_path,
        BACKUP_STEP,
      );
      requireStateString(
        nextFileEdit.backup_file,
        'backup_file',
        inputData.file_path,
        BACKUP_STEP,
      );
      await context.setState(nextState);

      return fileEdit.instructions.map((instruction) => ({
        file_path: inputData.file_path,
        instruction,
      }));
    },
  });

  return backupStep;
};

const createNestedEditWorkflow = (deps: EditWorkflowDeps) => {
  const nestedEditWorkflow = createWorkflow({
    id: 'anvil-agent-nested-edit-workflow',
    inputSchema: Z_FILE_EDIT,
    outputSchema: Z_FILE_EDIT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
  })
    .then(createDownloadStep(deps))
    .then(createGeneratedBackupStep(deps))
    .foreach(createApplyEditStep(deps))
    .foreach(createVerifyStep(deps))
    .map(async ({ inputData, requestContext, state }) => {
      if (inputData.length === 0) {
        throw new Error('No verified instructions available for upload');
      }

      const filePath = inputData[0].file_path;

      if (inputData.some((item) => item.file_path !== filePath)) {
        throw new Error('Upload step received instructions for multiple files');
      }

      const fileEdit = requireFileEditState(state, filePath, UPLOAD_FILE_STEP);
      const downloadedLocalFilePath = requireStateString(
        fileEdit.downloaded_local_file_path,
        'downloaded_local_file_path',
        filePath,
        UPLOAD_FILE_STEP,
      );
      const hash = requireStateString(
        fileEdit.hash,
        'hash',
        filePath,
        UPLOAD_FILE_STEP,
      );

      await validateCssStage(
        deps.anvilHistoryService,
        requestContext,
        fileEdit.file_path,
        downloadedLocalFilePath,
        'final',
      );

      return {
        localFilePath: downloadedLocalFilePath,
        originalFilePath: fileEdit.file_path,
        originalHash: hash,
      };
    })
    .then(createUploadFileStep(deps))
    // eslint-disable-next-line @typescript-eslint/require-await
    .map(async ({ inputData, state }) => {
      if (!inputData.success || !inputData.file_path) {
        throw new Error('Upload did not produce a file path for cleanup');
      }

      const fileEdit = requireFileEditState(
        state,
        inputData.file_path,
        DELETE_STEP,
      );
      const backupFilePath = requireStateString(
        fileEdit.backup_file,
        'backup_file',
        inputData.file_path,
        DELETE_STEP,
      );
      const downloadedLocalFilePath = requireStateString(
        fileEdit.downloaded_local_file_path,
        'downloaded_local_file_path',
        inputData.file_path,
        DELETE_STEP,
      );

      // TODO: Add workflow lifecycle cleanup for controlled failures before upload completes.
      return {
        file_path: fileEdit.file_path,
        backupFilePath,
        localFilePath: downloadedLocalFilePath,
      };
    })
    .then(createDeleteStep(deps))
    .commit();

  return nestedEditWorkflow;
};

export const createEditWorkflow = (deps: EditWorkflowDeps) => {
  const editWorkflow = createWorkflow({
    id: 'anvil-agent-edit-workflow',
    inputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    outputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
  })
    // TODO: Add a parent workflow revert step that restores every touched
    // remote file from backup_file values if any post-backup step fails, then
    // clean local temp files and backups where appropriate.
    .foreach(createNestedEditWorkflow(deps))
    .commit();

  return editWorkflow;
};
