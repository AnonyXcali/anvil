import { createWorkflow, createStep } from '@mastra/core/workflows';
import { Logger } from '@nestjs/common';
import {
  Z_EDIT_AGENT_WORKFLOW_INPUT,
  Z_FILE_EDIT,
  FILE_EDIT_INSTRUCTION,
  FILE_EDIT,
  EDIT_AGENT_INPUT,
  INSTRUCTION,
  STAGING_MANIFEST,
  STAGED_FILE_ENTRY,
} from './anvil-agent-edit.types';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { posix } from 'path';
import { AnvilAgentEditService } from './anvil-agent-edit.service';
import {
  AnvilEditStagingService,
  type StagingWorkspace,
} from './anvil-edit-staging.service';
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
import { validateAndOrderStagedInput } from './staged-transaction.validation';
import { getEditOperationContractError } from './edit-operation.validation';
import { unwrapStagedBranchResult } from './staged-branch-result';
import type {
  EditCleanupTarget,
  EditDiagnosticSink,
  EditProgressSink,
  EditProgressStatus,
} from 'src/anvil-agent/anvil-agent.types';

type EditWorkflowDeps = {
  anvilAgentEditService: AnvilAgentEditService;
  anvilEditStagingService: AnvilEditStagingService;
  anvilHistoryService: AnvilHistoryService;
};

const stagedEditWorkflowLogger = new Logger('AnvilStagedEditWorkflow');

async function persistStagingManifest(
  requestContext: RequestContext<unknown>,
  manifest: STAGING_MANIFEST,
  deps: EditWorkflowDeps,
): Promise<void> {
  const workspace = requestContext.get('stagingWorkspace');
  if (workspace && typeof workspace === 'object') {
    await deps.anvilEditStagingService.writeManifest(
      workspace as StagingWorkspace,
      manifest,
    );
  }
}

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
const COORDINATED_UPLOAD_STEP =
  'anvil-edit-agent-coordinated-upload-files-step';
const COORDINATED_CLEANUP_STEP =
  'anvil-edit-agent-coordinated-cleanup-files-step';
const STAGING_PREPARE_STEP = 'anvil-edit-agent-staging-prepare-all-files-step';
const STAGING_VALIDATE_STEP = 'anvil-edit-agent-staging-validate-project-step';
const STAGING_COMMIT_STEP = 'anvil-edit-agent-staging-commit-files-step';
const STAGING_CLEANUP_STEP =
  'anvil-edit-agent-staging-cleanup-transaction-step';
const STAGED_CREATE_BRANCH_STEP =
  'anvil-edit-agent-staged-create-file-branch-step';
const STAGED_EXISTING_BRANCH_STEP =
  'anvil-edit-agent-staged-existing-file-branch-step';
const STAGED_BRANCH_INPUT_STEP = 'anvil-agent-staged-branch-input-file-step';
const STRUCTURE_DIRECTORIES_STEP =
  'anvil-agent-structure-create-directories-step';
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
      const sanitize = (value: unknown, key?: string): unknown => {
        if (
          key &&
          /patch|diff|content|secret|token|password|authorization/i.test(key)
        ) {
          return '<redacted>';
        }
        if (typeof value === 'string') {
          return value
            .replaceAll(/(?:[A-Za-z]:)?[^\s"'`]*\/temp(?:\/|$)/g, '<staging>/')
            .replaceAll(
              /(?:[A-Za-z]:)?[^\s"'`]*\/\.anvil-backups(?:\/|$)/g,
              '<backup>/',
            )
            .replaceAll(
              /(?:ssh|bearer)\s+[A-Za-z0-9._~+\-/]+=*/gi,
              '<credential>',
            )
            .replaceAll(
              /\b(?:sk|pk|api|key|token)[_-][A-Za-z0-9_-]{12,}\b/gi,
              '<credential>',
            );
        }
        if (Array.isArray(value))
          return value.map((item) => sanitize(item, key));
        if (value && typeof value === 'object') {
          return Object.fromEntries(
            Object.entries(value).map(([nestedKey, nested]) => [
              nestedKey,
              sanitize(nested, nestedKey),
            ]),
          );
        }
        return value;
      };
      await sink({
        type,
        payload: sanitize(payload) as Record<string, unknown>,
      });
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
  const manifest = requestContext.get('stagingManifest');
  const stagedFilesFromManifest: StagedFile[] | undefined =
    manifest && typeof manifest === 'object' && 'files' in manifest
      ? await Promise.all(
          ((manifest as STAGING_MANIFEST).files ?? [])
            .filter((file) => file.operation !== 'delete')
            .map(async (file) => ({
              projectFilePath: file.projectPath,
              localFilePath: file.localPath,
              content: await readFile(file.localPath, 'utf8'),
            })),
        )
      : undefined;
  const stagedFiles =
    stagedFilesFromManifest ?? requestContext.get('cssStagedFiles');
  const result = validateCssEdit({
    cssFilePath: filePath,
    cssContent: content,
    stagedFiles: Array.isArray(stagedFiles) ? stagedFiles : undefined,
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

async function validateStagedProjectImports(
  deps: EditWorkflowDeps,
  manifest: STAGING_MANIFEST,
): Promise<void> {
  const stagedPaths = new Set(
    manifest.files
      .filter((file) => file.operation !== 'delete')
      .map((file) => file.projectPath),
  );
  const deletedPaths = new Set(
    manifest.files
      .filter((file) => file.operation === 'delete')
      .map((file) => file.projectPath),
  );
  const importPattern =
    /(?:from\s+|import\s*(?:\(\s*)?|require\s*\()(['"])([^'"]+)\1/g;
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.css'];

  for (const file of manifest.files) {
    if (
      file.operation === 'delete' ||
      !/\.(?:ts|tsx|js|jsx|css)$/.test(file.projectPath)
    ) {
      continue;
    }
    const content = await readFile(file.localPath, 'utf8');
    for (const match of content.matchAll(importPattern)) {
      const specifier = match[2];
      if (!specifier.startsWith('.')) continue;
      const base = posix.normalize(
        posix.join(posix.dirname(file.projectPath), specifier),
      );
      const candidates = extensions.flatMap((extension) => [
        `${base}${extension}`,
        `${base}/index${extension}`,
      ]);
      let found = candidates.some((candidate) => stagedPaths.has(candidate));
      if (!found) {
        for (const candidate of candidates) {
          if (deletedPaths.has(candidate)) continue;
          const state = await deps.anvilAgentEditService.getProjectFileState(
            manifest.projectId,
            candidate,
          );
          if (state.exists) {
            found = true;
            break;
          }
        }
      }
      if (!found) {
        throw new Error(
          `Missing staged import ${specifier} referenced by ${file.projectPath}`,
        );
      }
    }
  }
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

function validateInstructionPatchContract(
  instruction: FILE_EDIT_INSTRUCTION,
  filePath: string,
): void {
  const hasPatchToken = instruction.action_tokens.includes('patch');
  const hasPatchPayload =
    instruction.patch !== null && instruction.patch.trim().length > 0;

  if (hasPatchToken !== hasPatchPayload) {
    throw new Error(
      `patch token requires a non-empty unified diff in patch for ${filePath}`,
    );
  }

  if (hasPatchToken && instruction.action_tokens.includes('replace_file')) {
    throw new Error(
      `patch cannot be combined with replace_file for ${filePath}`,
    );
  }
}

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
    left.patch === right.patch &&
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

      if (requestContext.get('coordinatedUpload') === true) {
        return fileEdit;
      }

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

      if (requestContext.get('coordinatedUpload') === true) {
        return {
          success: true,
          file_path: inputData.originalFilePath,
        };
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

      if (fileEdit.operation === 'delete') {
        const nextState = state.map((item) =>
          item.file_path === inputData.file_path
            ? {
                ...item,
                instructions: item.instructions.map((instruction) => ({
                  ...instruction,
                  verified: true,
                })),
              }
            : item,
        );
        await context.setState(nextState);
        return {
          file_path: inputData.file_path,
          instruction: { ...inputData.instruction, verified: true },
        };
      }

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
                `Expected patch: ${inputData.instruction.patch ?? '<null>'}`,
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
      const manifest = context.requestContext.get('stagingManifest');
      if (manifest && typeof manifest === 'object' && 'files' in manifest) {
        const entry = (manifest as STAGING_MANIFEST).files.find(
          (file) => file.projectPath === inputData.file_path,
        );
        if (entry) {
          entry.verified = nextState.some(
            (file) =>
              file.file_path === inputData.file_path &&
              file.instructions.every((instruction) => instruction.verified),
          );
        }
      }

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
      validateInstructionPatchContract(instruction, inputData.file_path);
      const fileEdit = requireFileEditState(
        state,
        inputData.file_path,
        APPLY_EDIT_STEP,
      );
      if (fileEdit.operation === 'delete') {
        const nextState = state.map((item) =>
          item.file_path === inputData.file_path
            ? { ...item, isEdited: true }
            : item,
        );
        await context.setState(nextState);
        const manifest = context.requestContext.get('stagingManifest');
        if (manifest && typeof manifest === 'object' && 'files' in manifest) {
          const entry = (manifest as STAGING_MANIFEST).files.find(
            (file) => file.projectPath === inputData.file_path,
          );
          if (entry) entry.applied = true;
        }
        return inputData;
      }
      if (fileEdit.operation === 'create') {
        const nextState = state.map((item) =>
          item.file_path === inputData.file_path
            ? { ...item, isEdited: true }
            : item,
        );
        await context.setState(nextState);
        const manifest = context.requestContext.get('stagingManifest');
        if (manifest && typeof manifest === 'object' && 'files' in manifest) {
          const entry = (manifest as STAGING_MANIFEST).files.find(
            (file) => file.projectPath === inputData.file_path,
          );
          if (entry) entry.applied = true;
          await persistStagingManifest(
            context.requestContext,
            manifest as STAGING_MANIFEST,
            deps,
          );
        }
        return inputData;
      }
      const downloadedLocalFilePath = requireStateString(
        fileEdit.downloaded_local_file_path,
        'downloaded_local_file_path',
        inputData.file_path,
        APPLY_EDIT_STEP,
      );

      if (
        instruction.code === null &&
        instruction.patch === null &&
        !instruction.action_tokens.includes('delete')
      ) {
        throw new Error(
          `Instruction code is required for ${inputData.file_path}`,
        );
      }

      const targetChange = instruction.code ?? '';
      const patch = instruction.patch;
      const projectId = context.requestContext.get('projectId');
      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for edit history');
      }

      try {
        const isPatch = instruction.action_tokens.includes('patch');
        if (isPatch) {
          await emitEditDiagnostic(
            context.requestContext,
            'patch_apply_started',
            {
              filePath: inputData.file_path,
              strategy: 'unified_diff',
            },
          );
        }

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
              : instruction.action_tokens.includes('patch')
                ? deps.anvilAgentEditService
                    .applyUnifiedPatch(
                      downloadedLocalFilePath,
                      patch ?? '',
                      inputData.file_path,
                    )
                    .then((result) => result.localFilePath)
                : deps.anvilAgentEditService.edit(
                    downloadedLocalFilePath,
                    targetChange,
                    editRange,
                  ),
        );
        const stagingWorkspace = context.requestContext.get('stagingWorkspace');
        if (stagingWorkspace && typeof stagingWorkspace === 'object') {
          await deps.anvilEditStagingService.refreshFileAccounting(
            stagingWorkspace as StagingWorkspace,
            inputData.file_path,
          );
          const manifest = context.requestContext.get('stagingManifest');
          if (manifest && typeof manifest === 'object' && 'files' in manifest) {
            await persistStagingManifest(
              context.requestContext,
              manifest as STAGING_MANIFEST,
              deps,
            );
          }
        }
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
        if (isPatch) {
          await emitEditDiagnostic(
            context.requestContext,
            'patch_apply_completed',
            {
              filePath: inputData.file_path,
              strategy: 'unified_diff',
            },
          );
        }
      } catch (error: unknown) {
        if (instruction.action_tokens.includes('patch')) {
          const reason = error instanceof Error ? error.message : String(error);
          if (/context|overlapping|ambiguous|hunk/i.test(reason)) {
            await emitEditDiagnostic(
              context.requestContext,
              'patch_apply_conflict',
              {
                filePath: inputData.file_path,
                strategy: 'unified_diff',
                reason,
              },
            );
          }
          await emitEditDiagnostic(
            context.requestContext,
            'patch_apply_failed',
            {
              filePath: inputData.file_path,
              strategy: 'unified_diff',
              reason,
            },
          );
        }
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
      const manifest = context.requestContext.get('stagingManifest');
      if (manifest && typeof manifest === 'object' && 'files' in manifest) {
        const entry = (manifest as STAGING_MANIFEST).files.find(
          (file) => file.projectPath === inputData.file_path,
        );
        if (entry) entry.applied = true;
      }

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

const createCoordinatedUploadStep = (deps: EditWorkflowDeps) =>
  createStep({
    id: COORDINATED_UPLOAD_STEP,
    inputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    outputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, requestContext } = context;
      if (requestContext.get('coordinatedUpload') !== true) {
        return inputData;
      }

      const projectId = requestContext.get('projectId');
      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for coordinated upload');
      }

      const uploaded: FILE_EDIT[] = [];
      let attemptedFile: FILE_EDIT | undefined;
      try {
        const stagedFiles: StagedFile[] = await Promise.all(
          inputData.map(async (fileEdit) => ({
            projectFilePath: fileEdit.file_path,
            localFilePath: requireStateString(
              fileEdit.downloaded_local_file_path,
              'downloaded_local_file_path',
              fileEdit.file_path,
              COORDINATED_UPLOAD_STEP,
            ),
            content: await readFile(
              requireStateString(
                fileEdit.downloaded_local_file_path,
                'downloaded_local_file_path',
                fileEdit.file_path,
                COORDINATED_UPLOAD_STEP,
              ),
              'utf8',
            ),
          })),
        );
        requestContext.set('cssStagedFiles', stagedFiles);
        for (const fileEdit of inputData) {
          if (!isCssFilePath(fileEdit.file_path)) continue;
          const localFilePath = requireStateString(
            fileEdit.downloaded_local_file_path,
            'downloaded_local_file_path',
            fileEdit.file_path,
            COORDINATED_UPLOAD_STEP,
          );
          await validateCssStage(
            deps.anvilHistoryService,
            requestContext,
            fileEdit.file_path,
            localFilePath,
            'final',
          );
        }
        for (const fileEdit of inputData) {
          attemptedFile = fileEdit;
          const localFilePath = requireStateString(
            fileEdit.downloaded_local_file_path,
            'downloaded_local_file_path',
            fileEdit.file_path,
            COORDINATED_UPLOAD_STEP,
          );
          const hash = requireStateString(
            fileEdit.hash,
            'hash',
            fileEdit.file_path,
            COORDINATED_UPLOAD_STEP,
          );
          requireStateString(
            fileEdit.backup_file,
            'backup_file',
            fileEdit.file_path,
            COORDINATED_UPLOAD_STEP,
          );

          await emitEditProgress(
            requestContext,
            COORDINATED_UPLOAD_STEP,
            'started',
            `Uploading the verified file ${fileEdit.file_path}.`,
          );
          await deps.anvilAgentEditService.upload(
            projectId,
            localFilePath,
            fileEdit.file_path,
            hash,
          );
          uploaded.push(fileEdit);
          await emitEditProgress(
            requestContext,
            COORDINATED_UPLOAD_STEP,
            'completed',
            `Uploaded the verified file ${fileEdit.file_path}.`,
          );
        }
        return inputData;
      } catch (error: unknown) {
        const rollbackTargets = [
          ...uploaded,
          ...(attemptedFile ? [attemptedFile] : []),
        ].filter(
          (fileEdit, index, files) =>
            files.findIndex(
              (candidate) => candidate.file_path === fileEdit.file_path,
            ) === index,
        );
        let rollbackFailed = false;
        for (const fileEdit of rollbackTargets.slice().reverse()) {
          if (!fileEdit.backup_file) continue;
          try {
            await deps.anvilAgentEditService.restore(
              projectId,
              fileEdit.backup_file,
              fileEdit.file_path,
            );
          } catch (rollbackError: unknown) {
            rollbackFailed = true;
            await emitEditDiagnostic(requestContext, 'edit_rollback_failed', {
              filePath: fileEdit.file_path,
              reason:
                rollbackError instanceof Error
                  ? rollbackError.message
                  : String(rollbackError),
            });
          }
        }
        if (rollbackFailed) {
          requestContext.set('preserveBackupsOnFailure', true);
        }
        await emitEditDiagnostic(
          requestContext,
          'edit_coordinated_upload_failed',
          {
            uploadedFiles: uploaded.map((fileEdit) => fileEdit.file_path),
            reason: error instanceof Error ? error.message : String(error),
          },
        );
        throw error;
      }
    },
  });

const createStructureDirectoriesStep = (deps: EditWorkflowDeps) =>
  createStep({
    id: STRUCTURE_DIRECTORIES_STEP,
    inputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    outputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, requestContext } = context;
      const plan = inputData[0]?.structure_plan;
      const projectId = requestContext.get('projectId');
      if (!plan || typeof projectId !== 'string' || !projectId.trim()) {
        return inputData;
      }

      for (const directory of plan.directories_to_create) {
        await emitEditProgress(
          requestContext,
          STRUCTURE_DIRECTORIES_STEP,
          'started',
          `Preparing the project structure for ${directory}.`,
        );
        try {
          const exists =
            await deps.anvilAgentEditService.verifyProjectFolderExists(
              projectId,
              directory,
            );
          if (!exists) {
            await deps.anvilAgentEditService.createProjectFolder(
              projectId,
              directory,
            );
          }
          await emitEditProgress(
            requestContext,
            STRUCTURE_DIRECTORIES_STEP,
            'completed',
            `Prepared the project structure for ${directory}.`,
          );
        } catch (error) {
          await emitEditProgress(
            requestContext,
            STRUCTURE_DIRECTORIES_STEP,
            'failed',
            `Preparing the project structure for ${directory}.`,
          );
          throw error;
        }
      }
      return inputData;
    },
  });

const createCoordinatedCleanupStep = (deps: EditWorkflowDeps) =>
  createStep({
    id: COORDINATED_CLEANUP_STEP,
    inputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    outputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, requestContext } = context;
      if (requestContext.get('coordinatedUpload') !== true) {
        return inputData;
      }
      const projectId = requestContext.get('projectId');
      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for coordinated cleanup');
      }
      for (const fileEdit of inputData) {
        if (!fileEdit.backup_file || !fileEdit.downloaded_local_file_path) {
          continue;
        }
        await deps.anvilAgentEditService.cleanUp(
          projectId,
          fileEdit.backup_file,
          fileEdit.downloaded_local_file_path,
        );
      }
      return inputData;
    },
  });

const createStagedPrepareStep = (deps: EditWorkflowDeps) =>
  createStep({
    id: STAGING_PREPARE_STEP,
    inputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    outputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { requestContext } = context;
      const inputData = validateAndOrderStagedInput(context.inputData);
      const projectId = requestContext.get('projectId');
      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for staging');
      }
      const existingRunId = requestContext.get('editRunId');
      const runId =
        typeof existingRunId === 'string' ? existingRunId : randomUUID();
      for (const fileEdit of inputData) {
        const code =
          fileEdit.instructions.find((instruction) => instruction.code !== null)
            ?.code ?? null;
        const operationError = getEditOperationContractError({
          filePath: fileEdit.file_path,
          actionTokens: fileEdit.instructions.flatMap(
            (instruction) => instruction.action_tokens,
          ),
          operation: fileEdit.operation,
          fileExists: fileEdit.file_exists,
          code,
          instructionCount: fileEdit.instructions.length,
        });
        if (operationError) {
          throw new Error(operationError);
        }
      }
      const stagingWorkspace =
        await deps.anvilEditStagingService.createWorkspace(projectId, runId);
      const stagingRoot = stagingWorkspace.rootPath;
      const plan = inputData[0]?.structure_plan;
      const manifest: STAGING_MANIFEST = {
        projectId,
        editRunId: runId,
        stagingRoot,
        files: [],
        directoriesToCreate: plan?.directories_to_create ?? [],
        createdDirectories: [],
        totalBytes: 0,
        fileCount: inputData.length,
        structurePlan: plan ?? null,
      };
      if (manifest.fileCount > 500) {
        throw new Error('Staged edit exceeds the 500-file limit');
      }
      requestContext.set('stagingManifest', manifest);
      requestContext.set('stagingWorkspace', stagingWorkspace);
      await deps.anvilEditStagingService.writeManifest(
        stagingWorkspace,
        manifest,
      );
      await emitEditDiagnostic(requestContext, 'staging_started', {
        fileCount: manifest.fileCount,
      });

      const nextState: FILE_EDIT[] = [];
      for (const fileEdit of inputData) {
        const operation = fileEdit.operation;
        await emitEditDiagnostic(
          requestContext,
          'staging_file_prepare_started',
          {
            filePath: fileEdit.file_path,
            operation,
            fileExists: fileEdit.file_exists,
          },
        );
        let localPath: string;
        let originalHash: string | null = null;
        if (operation === 'create') {
          const content =
            fileEdit.instructions.find((instruction) =>
              instruction.action_tokens.includes('replace_file'),
            )?.code ??
            fileEdit.instructions[0]?.code ??
            '';
          localPath = await deps.anvilEditStagingService.writeFile(
            stagingWorkspace,
            fileEdit.file_path,
            content,
          );
          await emitEditDiagnostic(
            requestContext,
            'staging_file_create_local',
            {
              filePath: fileEdit.file_path,
              operation,
              fileExists: fileEdit.file_exists,
            },
          );
        } else {
          await emitEditDiagnostic(
            requestContext,
            'staging_file_download_started',
            {
              filePath: fileEdit.file_path,
              operation,
              fileExists: fileEdit.file_exists,
            },
          );
          let downloaded: Awaited<
            ReturnType<AnvilAgentEditService['downloadFile']>
          >;
          try {
            downloaded = await deps.anvilAgentEditService.downloadFile(
              projectId,
              fileEdit.file_path,
            );
          } catch (error: unknown) {
            await emitEditDiagnostic(
              requestContext,
              'staging_file_download_failed',
              {
                filePath: fileEdit.file_path,
                operation,
                fileExists: fileEdit.file_exists,
                status: 'failed',
              },
            );
            const reason =
              error instanceof Error ? error.message : String(error);
            throw new Error(
              `Failed to download ${fileEdit.file_path} (operation: ${operation}): ${reason}`,
              { cause: error },
            );
          }
          localPath = await deps.anvilEditStagingService.copyFile(
            stagingWorkspace,
            fileEdit.file_path,
            downloaded.localFilePath,
          );
          await deps.anvilAgentEditService.cleanUpLocalFile(
            downloaded.localFilePath,
          );
          originalHash = downloaded.hash;
        }
        manifest.totalBytes = stagingWorkspace.totalBytes;
        const entry: STAGED_FILE_ENTRY = {
          projectPath: fileEdit.file_path,
          localPath,
          operation,
          existedRemotely: operation !== 'create',
          originalHash,
          backupPath: null,
          instructionIndexes: fileEdit.instructions.map((_, index) => index),
          applied: false,
          verified: false,
          validationStatus: 'pending',
          commitStatus: 'pending',
        };
        manifest.files.push(entry);
        nextState.push({
          ...fileEdit,
          downloaded_local_file_path: localPath,
          hash: originalHash,
          backup_file: null,
        });
        await emitEditDiagnostic(requestContext, 'staging_file_prepared', {
          filePath: fileEdit.file_path,
          operation,
        });
      }
      requestContext.set('stagingManifest', manifest);
      await deps.anvilEditStagingService.writeManifest(
        stagingWorkspace,
        manifest,
      );
      await context.setState(nextState);
      return nextState;
    },
  });

const createStagedCreateBranchStep = () =>
  createStep({
    id: STAGED_CREATE_BRANCH_STEP,
    inputSchema: Z_FILE_EDIT,
    outputSchema: Z_FILE_EDIT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, requestContext, state } = context;
      await emitEditDiagnostic(requestContext, 'staged_create_branch_started', {
        filePath: inputData.file_path,
        operation: inputData.operation,
      });
      try {
        if (inputData.operation !== 'create') {
          throw new Error(
            `Create branch received non-create operation for ${inputData.file_path}`,
          );
        }
        if (inputData.file_exists) {
          throw new Error(
            `Create branch received an existing file: ${inputData.file_path}`,
          );
        }
        if (inputData.instructions.length !== 1) {
          throw new Error(
            `Create operation requires exactly one instruction for ${inputData.file_path}`,
          );
        }
        const instruction = inputData.instructions[0];
        if (
          instruction.action_tokens.length !== 1 ||
          instruction.action_tokens[0] !== 'add' ||
          instruction.code === null ||
          instruction.code.trim().length === 0
        ) {
          throw new Error(
            `Create operation requires one complete add instruction for ${inputData.file_path}`,
          );
        }

        const fileEdit = requireFileEditState(
          state,
          inputData.file_path,
          STAGED_CREATE_BRANCH_STEP,
        );
        const localPath = requireStateString(
          fileEdit.downloaded_local_file_path,
          'downloaded_local_file_path',
          inputData.file_path,
          STAGED_CREATE_BRANCH_STEP,
        );
        const manifest = requestContext.get('stagingManifest');
        if (
          !manifest ||
          typeof manifest !== 'object' ||
          !('files' in manifest)
        ) {
          throw new Error('Staging manifest is unavailable for create branch');
        }
        const entry = (manifest as STAGING_MANIFEST).files.find(
          (file) => file.projectPath === inputData.file_path,
        );
        if (
          !entry ||
          entry.operation !== 'create' ||
          entry.existedRemotely ||
          entry.originalHash !== null
        ) {
          throw new Error(
            `Create branch received inconsistent staging state for ${inputData.file_path}`,
          );
        }
        const localContent = await readFile(localPath, 'utf8');
        if (localContent !== instruction.code) {
          throw new Error(
            `Staged create content does not match the requested file content for ${inputData.file_path}`,
          );
        }

        await emitEditDiagnostic(
          requestContext,
          'staged_create_branch_completed',
          {
            filePath: inputData.file_path,
            operation: inputData.operation,
          },
        );
        return inputData;
      } catch (error) {
        await emitEditDiagnostic(
          requestContext,
          'staged_create_branch_failed',
          {
            filePath: inputData.file_path,
            operation: inputData.operation,
            status: 'failed',
          },
        );
        throw error;
      }
    },
  });

const createStagedExistingBranchStep = () =>
  createStep({
    id: STAGED_EXISTING_BRANCH_STEP,
    inputSchema: Z_FILE_EDIT,
    outputSchema: Z_FILE_EDIT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const fileEdit = context.inputData;
      if (fileEdit.operation === 'create') {
        throw new Error(
          `Existing-file branch received create operation for ${fileEdit.file_path}`,
        );
      }
      return await Promise.resolve(fileEdit);
    },
  });

const createStagedBranchInputStep = () =>
  createStep({
    id: STAGED_BRANCH_INPUT_STEP,
    inputSchema: Z_FILE_EDIT,
    outputSchema: Z_FILE_EDIT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const editRunId = context.requestContext.get('editRunId');
      stagedEditWorkflowLogger.log(
        `[debug] staged branch input${
          typeof editRunId === 'string' ? ` editRunId=${editRunId}` : ''
        }: ${JSON.stringify(context.inputData)}`,
      );
      return await Promise.resolve(context.inputData);
    },
  });

const createStagedFileWorkflow = (deps: EditWorkflowDeps) =>
  createWorkflow({
    id: 'anvil-agent-staged-file-workflow',
    inputSchema: Z_FILE_EDIT,
    outputSchema: Z_FILE_EDIT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
  })
    .then(createStagedBranchInputStep())
    .branch([
      [
        async ({ inputData }) => {
          stagedEditWorkflowLogger.log(
            `[debug] create branch predicate input: ${JSON.stringify(inputData)}`,
          );
          return await Promise.resolve(inputData.operation === 'create');
        },
        createStagedCreateBranchStep(),
      ],
      [
        async ({ inputData }) => {
          stagedEditWorkflowLogger.log(
            `[debug] existing branch predicate input: ${JSON.stringify(inputData)}`,
          );
          return await Promise.resolve(inputData.operation !== 'create');
        },
        createStagedExistingBranchStep(),
      ],
    ])
    .map(async (context) => {
      const { inputData } = context;
      const initialInput = context.getInitData<FILE_EDIT>();
      const fileEdit = unwrapStagedBranchResult(
        inputData,
        initialInput?.file_path,
      );
      return await Promise.resolve(
        fileEdit.instructions.map((instruction) => ({
          file_path: fileEdit.file_path,
          instruction,
        })),
      );
    })
    .foreach(createApplyEditStep(deps))
    .foreach(createVerifyStep(deps))
    .map(
      async ({ inputData, state }) =>
        await Promise.resolve(
          requireFileEditState(
            state,
            inputData[0].file_path,
            STAGING_VALIDATE_STEP,
          ),
        ),
    )
    .commit();

const createStagedProjectValidationStep = (deps: EditWorkflowDeps) =>
  createStep({
    id: STAGING_VALIDATE_STEP,
    inputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    outputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const manifest = context.requestContext.get('stagingManifest');
      if (!manifest || typeof manifest !== 'object' || !('files' in manifest)) {
        throw new Error('Staging manifest is unavailable');
      }
      const current = manifest as STAGING_MANIFEST;
      await emitEditDiagnostic(
        context.requestContext,
        'staging_validation_started',
        {
          fileCount: current.files.length,
        },
      );
      try {
        const uniquePaths = new Set<string>();
        for (const file of current.files) {
          if (uniquePaths.has(file.projectPath)) {
            throw new Error(
              `Duplicate staged manifest path: ${file.projectPath}`,
            );
          }
          uniquePaths.add(file.projectPath);
          if (
            (file.operation === 'create' &&
              (file.existedRemotely || file.originalHash !== null)) ||
            (file.operation !== 'create' &&
              (!file.existedRemotely || !file.originalHash))
          ) {
            throw new Error(
              `Inconsistent staged operation state: ${file.projectPath}`,
            );
          }
          if (
            !file.applied ||
            (file.operation !== 'delete' && !file.verified)
          ) {
            throw new Error(
              `Staged file is not ready for validation: ${file.projectPath}`,
            );
          }
          if (file.operation === 'delete') continue;
          if (isCssFilePath(file.projectPath)) {
            await validateCssStage(
              deps.anvilHistoryService,
              context.requestContext,
              file.projectPath,
              file.localPath,
              'final',
              true,
            );
          }
          file.validationStatus = 'passed';
        }
        await validateStagedProjectImports(deps, current);
        const stagingWorkspace = context.requestContext.get('stagingWorkspace');
        if (stagingWorkspace && typeof stagingWorkspace === 'object') {
          await deps.anvilEditStagingService.writeManifest(
            stagingWorkspace as StagingWorkspace,
            current,
          );
        }
        await emitEditDiagnostic(
          context.requestContext,
          'staging_validation_completed',
          {
            fileCount: current.files.length,
          },
        );
        return context.inputData;
      } catch (error) {
        for (const file of current.files) file.validationStatus = 'failed';
        await emitEditDiagnostic(
          context.requestContext,
          'staging_validation_failed',
          {
            reason: error instanceof Error ? error.message : String(error),
          },
        );
        throw error;
      }
    },
  });

const createStagedCommitStep = (deps: EditWorkflowDeps) =>
  createStep({
    id: STAGING_COMMIT_STEP,
    inputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    outputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const projectId = context.requestContext.get('projectId');
      const manifestValue = context.requestContext.get('stagingManifest');
      if (typeof projectId !== 'string' || !projectId.trim())
        throw new Error('Project ID is unavailable for commit');
      if (
        !manifestValue ||
        typeof manifestValue !== 'object' ||
        !('files' in manifestValue)
      )
        throw new Error('Staging manifest is unavailable');
      const manifest = manifestValue as STAGING_MANIFEST;
      const committed: STAGED_FILE_ENTRY[] = [];
      let attempted: STAGED_FILE_ENTRY | undefined;
      await emitEditDiagnostic(context.requestContext, 'commit_started', {
        fileCount: manifest.files.length,
      });
      try {
        for (const file of manifest.files) {
          const remoteState =
            await deps.anvilAgentEditService.getProjectFileState(
              projectId,
              file.projectPath,
            );
          if (file.operation === 'create') {
            if (remoteState.exists) {
              throw new Error(
                `Create target already exists: ${file.projectPath}`,
              );
            }
            continue;
          }
          if (
            !remoteState.exists ||
            !file.originalHash ||
            remoteState.hash !== file.originalHash
          ) {
            throw new Error(
              `Remote file changed before commit: ${file.projectPath}`,
            );
          }
        }

        for (const file of manifest.files) {
          if (file.operation !== 'create') {
            file.backupPath = posix.join(
              '.anvil-backups',
              manifest.editRunId,
              file.projectPath,
            );
            await persistStagingManifest(
              context.requestContext,
              manifest,
              deps,
            );
            file.backupPath =
              await deps.anvilAgentEditService.createCommitBackup(
                projectId,
                file.projectPath,
                manifest.editRunId,
              );
            await persistStagingManifest(
              context.requestContext,
              manifest,
              deps,
            );
          }
        }

        for (const directory of [...manifest.directoriesToCreate].sort(
          (left, right) => left.split('/').length - right.split('/').length,
        )) {
          if (
            !(await deps.anvilAgentEditService.verifyProjectFolderExists(
              projectId,
              directory,
            ))
          ) {
            manifest.createdDirectories.push(directory);
            await persistStagingManifest(
              context.requestContext,
              manifest,
              deps,
            );
            await deps.anvilAgentEditService.createProjectFolder(
              projectId,
              directory,
            );
            await persistStagingManifest(
              context.requestContext,
              manifest,
              deps,
            );
          }
        }
        for (const file of manifest.files) {
          attempted = file;
          file.commitStatus = 'commit-started';
          await persistStagingManifest(context.requestContext, manifest, deps);
          await emitEditDiagnostic(
            context.requestContext,
            'commit_file_started',
            { filePath: file.projectPath, operation: file.operation },
          );
          if (file.operation === 'create') {
            await deps.anvilAgentEditService.createProjectFile(
              projectId,
              file.projectPath,
            );
            await deps.anvilAgentEditService.upload(
              projectId,
              file.localPath,
              file.projectPath,
              'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            );
          } else {
            if (file.operation === 'delete') {
              await deps.anvilAgentEditService.deleteProjectFile(
                projectId,
                file.projectPath,
              );
              file.commitStatus = 'deleted';
            } else {
              await deps.anvilAgentEditService.upload(
                projectId,
                file.localPath,
                file.projectPath,
                file.originalHash ?? '',
              );
              file.commitStatus = 'uploaded';
            }
          }
          committed.push(file);
          const stagingWorkspace =
            context.requestContext.get('stagingWorkspace');
          if (stagingWorkspace && typeof stagingWorkspace === 'object') {
            await deps.anvilEditStagingService.writeManifest(
              stagingWorkspace as StagingWorkspace,
              manifest,
            );
          }
          await emitEditDiagnostic(
            context.requestContext,
            'commit_file_completed',
            { filePath: file.projectPath, status: file.commitStatus },
          );
        }
        return context.inputData;
      } catch (error) {
        await emitEditDiagnostic(context.requestContext, 'commit_failed', {
          filePath: attempted?.projectPath ?? null,
          reason: error instanceof Error ? error.message : String(error),
        });
        let rollbackFailed = false;
        for (const file of [
          ...committed,
          ...(attempted ? [attempted] : []),
        ].reverse()) {
          try {
            if (file.operation === 'create')
              await deps.anvilAgentEditService.removeCreatedProjectFile(
                projectId,
                file.projectPath,
              );
            else if (file.backupPath)
              await deps.anvilAgentEditService.restore(
                projectId,
                file.backupPath,
                file.projectPath,
              );
            file.commitStatus = 'rolled-back';
            await emitEditDiagnostic(
              context.requestContext,
              'rollback_file_completed',
              { filePath: file.projectPath },
            );
          } catch (rollbackError) {
            rollbackFailed = true;
            file.commitStatus = 'rollback-failed';
            await emitEditDiagnostic(
              context.requestContext,
              'rollback_file_failed',
              {
                filePath: file.projectPath,
                reason:
                  rollbackError instanceof Error
                    ? rollbackError.message
                    : String(rollbackError),
              },
            );
          }
        }
        for (const directory of [...manifest.createdDirectories].reverse()) {
          try {
            await deps.anvilAgentEditService.removeEmptyCreatedDirectory(
              projectId,
              directory,
            );
          } catch (directoryError) {
            rollbackFailed = true;
            await emitEditDiagnostic(
              context.requestContext,
              'rollback_file_failed',
              {
                filePath: directory,
                reason:
                  directoryError instanceof Error
                    ? directoryError.message
                    : String(directoryError),
              },
            );
          }
        }
        if (rollbackFailed)
          context.requestContext.set('preserveBackupsOnFailure', true);
        throw error;
      }
    },
  });

const createStagedCleanupStep = (deps: EditWorkflowDeps) =>
  createStep({
    id: STAGING_CLEANUP_STEP,
    inputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    outputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const value = context.requestContext.get('stagingManifest');
      if (!value || typeof value !== 'object' || !('files' in value))
        return context.inputData;
      const manifest = value as STAGING_MANIFEST;
      await emitEditDiagnostic(context.requestContext, 'cleanup_started', {
        fileCount: manifest.files.length,
      });
      if (context.requestContext.get('preserveBackupsOnFailure') !== true) {
        for (const file of manifest.files) {
          if (file.backupPath)
            await deps.anvilAgentEditService.cleanUp(
              manifest.projectId,
              file.backupPath,
              file.localPath,
            );
        }
      }
      const workspace = context.requestContext.get('stagingWorkspace');
      if (workspace && typeof workspace === 'object') {
        await deps.anvilEditStagingService.cleanup(
          workspace as StagingWorkspace,
        );
      } else {
        await deps.anvilAgentEditService.removeStagingWorkspace(
          manifest.stagingRoot,
        );
      }
      await emitEditDiagnostic(context.requestContext, 'cleanup_completed', {
        fileCount: manifest.files.length,
      });
      return context.inputData;
    },
  });

export const createStagedEditWorkflow = (deps: EditWorkflowDeps) =>
  createWorkflow({
    id: 'anvil-agent-staged-edit-workflow',
    inputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    outputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
  })
    .then(createStagedPrepareStep(deps))
    .foreach(createStagedFileWorkflow(deps))
    .then(createStagedProjectValidationStep(deps))
    .then(createStagedCommitStep(deps))
    .then(createStagedCleanupStep(deps))
    .commit();

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
    .then(createStructureDirectoriesStep(deps))
    .foreach(createNestedEditWorkflow(deps))
    .then(createCoordinatedUploadStep(deps))
    .then(createCoordinatedCleanupStep(deps))
    .commit();

  return editWorkflow;
};
