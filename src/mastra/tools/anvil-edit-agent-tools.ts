import { createTool, ToolExecutionContext } from '@mastra/core/tools';
import { z } from 'zod';
import { AnvilAgentEditService } from 'src/anvil-agent-edit/anvil-agent-edit.service';
import type {
  createEditWorkflow,
  createStagedEditWorkflow,
} from 'src/anvil-agent-edit/anvil-agent-edit.workflow';
import {
  toInternalEditInput,
  Z_MODEL_EDIT_AGENT_WORKFLOW_INPUT,
  type STAGING_MANIFEST,
} from 'src/anvil-agent-edit/anvil-agent-edit.types';
import type {
  EditCleanupTarget,
  STRUCTURE_PLAN,
} from 'src/anvil-agent/anvil-agent.types';
import { AnvilHistoryService } from 'src/anvil-history/anvil-history.service';
import {
  appendHistoryBestEffort,
  createAnvilHistoryTools,
} from './anvil-history-tools';

const Z_MUTATION_TOOL_OUTPUT = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
});

const Z_VERIFY_TOOL_OUTPUT = z.object({
  exists: z.boolean(),
  error: z.string().nullable(),
});

const Z_READ_FILE_TOOL_OUTPUT = z.object({
  content: z.string(),
  error: z.string().nullable(),
});

const Z_RUN_EDIT_WORKFLOW_OUTPUT = z.object({
  success: z.boolean(),
  files: z.array(z.string()),
  error: z.string().nullable(),
});

function getProjectId(context: ToolExecutionContext): string {
  const projectId: string | undefined =
    context.requestContext?.get('projectId');

  if (!projectId) {
    throw new Error('Project ID is unavailable for edit tool processing');
  }

  return projectId;
}

function getCanonicalStructurePlan(
  context: ToolExecutionContext,
): STRUCTURE_PLAN {
  const structurePlan = context.requestContext?.get('structurePlan');
  if (!isStructurePlan(structurePlan)) {
    throw new Error(
      'Canonical structural plan is unavailable for edit workflow',
    );
  }
  return structurePlan;
}

function isStructurePlan(value: unknown): value is STRUCTURE_PLAN {
  if (typeof value !== 'object' || value === null) return false;
  const plan = value as Record<string, unknown>;
  return (
    typeof plan.feature_root === 'string' &&
    Array.isArray(plan.phases) &&
    Array.isArray(plan.directories_to_create) &&
    Array.isArray(plan.preserve) &&
    Array.isArray(plan.existing_paths)
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown edit tool error';
}

function rejectMultiFileMutation(context: ToolExecutionContext): void {
  if (context.requestContext?.get('multiFileHandoff') === true) {
    throw new Error(
      'Direct mutation tools are disabled for multi-file edits; use run_edit_workflow.',
    );
  }
}

function getWorkflowResultError(result: { status: string }): string {
  if ('error' in result && result.error instanceof Error) {
    return result.error.message;
  }

  if ('tripwire' in result) {
    return 'Edit workflow stopped by tripwire';
  }

  return `Edit workflow ended with status ${result.status}`;
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

async function cleanUpFailedEdit(
  context: ToolExecutionContext,
  anvilAgentEditService: AnvilAgentEditService,
): Promise<void> {
  const manifest = context.requestContext?.get('stagingManifest');
  if (
    manifest &&
    typeof manifest === 'object' &&
    'stagingRoot' in manifest &&
    typeof manifest.stagingRoot === 'string'
  ) {
    const stagingManifest = manifest as unknown as STAGING_MANIFEST;
    let backupCleanupFailed = false;
    if (context.requestContext?.get('preserveBackupsOnFailure') !== true) {
      for (const file of stagingManifest.files ?? []) {
        if (!file || typeof file !== 'object' || !('backupPath' in file)) {
          continue;
        }
        const backupPath = (file as { backupPath?: unknown }).backupPath;
        if (typeof backupPath !== 'string' || !backupPath) continue;
        try {
          await anvilAgentEditService.removeCommitBackup(
            stagingManifest.projectId,
            backupPath,
            stagingManifest.editRunId,
          );
        } catch {
          backupCleanupFailed = true;
        }
      }
    }
    if (backupCleanupFailed) {
      context.requestContext?.set('preserveBackupsOnFailure', true);
    }
    try {
      if (context.requestContext?.get('preserveBackupsOnFailure') !== true) {
        await anvilAgentEditService.removeStagingWorkspace(
          manifest.stagingRoot,
        );
      }
    } catch {
      // Staging cleanup is best-effort and must not replace the edit error.
    }
  }
  const targets = context.requestContext?.get('editCleanupTargets');
  if (!Array.isArray(targets)) {
    return;
  }

  for (const target of targets.slice().reverse()) {
    if (!isEditCleanupTarget(target)) {
      continue;
    }

    try {
      if (
        target.backupFilePath &&
        context.requestContext?.get('preserveBackupsOnFailure') !== true
      ) {
        await anvilAgentEditService.cleanUp(
          target.projectId,
          target.backupFilePath,
          target.localFilePath,
        );
      } else {
        await anvilAgentEditService.cleanUpLocalFile(target.localFilePath);
      }
    } catch {
      // Cleanup is best-effort and must not replace the original edit error.
    }
  }
}

export function createAnvilEditAgentTools(deps: {
  anvilAgentEditService: AnvilAgentEditService;
  anvilHistoryService: AnvilHistoryService;
  editWorkflow: ReturnType<typeof createEditWorkflow>;
  stagedEditWorkflow: ReturnType<typeof createStagedEditWorkflow>;
}) {
  const {
    anvilAgentEditService,
    anvilHistoryService,
    editWorkflow,
    stagedEditWorkflow,
  } = deps;

  return {
    ...createAnvilHistoryTools(anvilHistoryService),
    run_edit_workflow: createTool({
      id: 'run_edit_workflow',
      description:
        'Run the edit workflow once with workflow-ready FILE_EDIT[] input. Runtime workflow state is managed by application code, not by the model.',
      inputSchema: z
        .object({
          inputData: Z_MODEL_EDIT_AGENT_WORKFLOW_INPUT,
        })
        .strict(),
      outputSchema: Z_RUN_EDIT_WORKFLOW_OUTPUT,
      execute: async (inputData, context) => {
        try {
          if (inputData.inputData.length === 0) {
            return {
              success: false,
              files: [],
              error: 'At least one file edit is required',
            };
          }

          getProjectId(context);
          const canonicalPlan = getCanonicalStructurePlan(context);
          const internalInputData = toInternalEditInput(
            inputData.inputData,
            canonicalPlan,
          );

          context.requestContext?.set(
            'coordinatedUpload',
            inputData.inputData.length > 1,
          );

          const hasRunEditWorkflow =
            context.requestContext?.get('hasRunEditWorkflow') === true;

          if (hasRunEditWorkflow) {
            return {
              success: false,
              files: [],
              error: 'Edit workflow was already invoked for this handoff',
            };
          }

          context.requestContext?.set('hasRunEditWorkflow', true);

          const hasCreateOperation = inputData.inputData.some(
            (file) => file.operation === 'create',
          );
          const useStagedWorkflow =
            inputData.inputData.length > 1 || hasCreateOperation;

          const run = await (
            useStagedWorkflow ? stagedEditWorkflow : editWorkflow
          ).createRun();
          const result = await run.start({
            inputData: internalInputData,
            initialState: internalInputData,
            requestContext: context.requestContext,
            outputWriter: async (chunk) => {
              await context.writer?.write(chunk);
            },
          });

          if (result.status !== 'success') {
            const error = getWorkflowResultError(result);
            await cleanUpFailedEdit(context, anvilAgentEditService);
            context.requestContext?.set('editWorkflowFailure', error);
            return {
              success: false,
              files: [],
              error,
            };
          }

          return {
            success: true,
            files: result.result.map((fileEdit) => fileEdit.file_path),
            error: null,
          };
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          await cleanUpFailedEdit(context, anvilAgentEditService);
          context.requestContext?.set('editWorkflowFailure', message);
          return { success: false, files: [], error: message };
        }
      },
    }),
    create_file: createTool({
      id: 'create_file',
      description:
        'Create an empty project-relative file. Content changes must be applied through the edit workflow after the file exists.',
      inputSchema: z.object({
        file_path: z.string().min(1),
      }),
      outputSchema: Z_MUTATION_TOOL_OUTPUT,
      execute: async (inputData, context) => {
        rejectMultiFileMutation(context);
        const projectId = getProjectId(context);
        try {
          await anvilAgentEditService.createProjectFile(
            projectId,
            inputData.file_path,
          );
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Create project file',
            status: 'success',
            changesMade: `Created ${inputData.file_path}.`,
            files: [inputData.file_path],
            actor: 'anvil-edit-agent.create_file',
          });

          return { success: true, error: null };
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Create project file',
            status: 'failed',
            changesMade: message,
            files: [inputData.file_path],
            actor: 'anvil-edit-agent.create_file',
          });
          return { success: false, error: message };
        }
      },
    }),
    create_folder: createTool({
      id: 'create_folder',
      description:
        'Create one project-relative folder. Parent folders must already exist.',
      inputSchema: z.object({
        folder_path: z.string().min(1),
      }),
      outputSchema: Z_MUTATION_TOOL_OUTPUT,
      execute: async (inputData, context) => {
        rejectMultiFileMutation(context);
        const projectId = getProjectId(context);
        try {
          await anvilAgentEditService.createProjectFolder(
            projectId,
            inputData.folder_path,
          );
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Create project folder',
            status: 'success',
            changesMade: `Created ${inputData.folder_path}.`,
            files: [inputData.folder_path],
            actor: 'anvil-edit-agent.create_folder',
          });

          return { success: true, error: null };
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Create project folder',
            status: 'failed',
            changesMade: message,
            files: [inputData.folder_path],
            actor: 'anvil-edit-agent.create_folder',
          });
          return { success: false, error: message };
        }
      },
    }),
    delete_file: createTool({
      id: 'delete_file',
      description:
        'Delete one project-relative file only when the instructions explicitly say deletion is safe.',
      inputSchema: z.object({
        file_path: z.string().min(1),
        safe_to_delete: z.literal(true),
        reason: z.string().min(1),
      }),
      outputSchema: Z_MUTATION_TOOL_OUTPUT,
      execute: async (inputData, context) => {
        rejectMultiFileMutation(context);
        const projectId = getProjectId(context);
        try {
          await anvilAgentEditService.deleteProjectFile(
            projectId,
            inputData.file_path,
          );
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Delete project file',
            status: 'success',
            changesMade: `Deleted ${inputData.file_path}. Reason: ${inputData.reason}`,
            files: [inputData.file_path],
            actor: 'anvil-edit-agent.delete_file',
          });

          return { success: true, error: null };
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Delete project file',
            status: 'failed',
            changesMade: message,
            files: [inputData.file_path],
            actor: 'anvil-edit-agent.delete_file',
          });
          return { success: false, error: message };
        }
      },
    }),
    delete_folder: createTool({
      id: 'delete_folder',
      description:
        'Delete one empty project-relative folder only when the instructions explicitly say deletion is safe. Recursive deletion is not supported.',
      inputSchema: z.object({
        folder_path: z.string().min(1),
        safe_to_delete: z.literal(true),
        reason: z.string().min(1),
      }),
      outputSchema: Z_MUTATION_TOOL_OUTPUT,
      execute: async (inputData, context) => {
        rejectMultiFileMutation(context);
        const projectId = getProjectId(context);
        try {
          await anvilAgentEditService.deleteProjectFolder(
            projectId,
            inputData.folder_path,
          );
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Delete project folder',
            status: 'success',
            changesMade: `Deleted ${inputData.folder_path}. Reason: ${inputData.reason}`,
            files: [inputData.folder_path],
            actor: 'anvil-edit-agent.delete_folder',
          });

          return { success: true, error: null };
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Delete project folder',
            status: 'failed',
            changesMade: message,
            files: [inputData.folder_path],
            actor: 'anvil-edit-agent.delete_folder',
          });
          return { success: false, error: message };
        }
      },
    }),
    verify_file_existing: createTool({
      id: 'verify_file_existing',
      description:
        'Check whether a project-relative path exists and is a regular file.',
      inputSchema: z.object({
        file_path: z.string().min(1),
      }),
      outputSchema: Z_VERIFY_TOOL_OUTPUT,
      execute: async (inputData, context) => {
        try {
          const exists = await anvilAgentEditService.verifyProjectFileExists(
            getProjectId(context),
            inputData.file_path,
          );

          return { exists, error: null };
        } catch (error: unknown) {
          return { exists: false, error: getErrorMessage(error) };
        }
      },
    }),
    verify_folder_existing: createTool({
      id: 'verify_folder_existing',
      description:
        'Check whether a project-relative path exists and is a folder.',
      inputSchema: z.object({
        folder_path: z.string().min(1),
      }),
      outputSchema: Z_VERIFY_TOOL_OUTPUT,
      execute: async (inputData, context) => {
        try {
          const exists = await anvilAgentEditService.verifyProjectFolderExists(
            getProjectId(context),
            inputData.folder_path,
          );

          return { exists, error: null };
        } catch (error: unknown) {
          return { exists: false, error: getErrorMessage(error) };
        }
      },
    }),
    read_file: createTool({
      id: 'read_file',
      description:
        'Read up to 200 lines from a project-relative regular file for edit context.',
      inputSchema: z.object({
        file_path: z.string().min(1),
        line_range: z.object({
          startLine: z.number().int().positive(),
          endLine: z.number().int().positive(),
        }),
      }),
      outputSchema: Z_READ_FILE_TOOL_OUTPUT,
      execute: async (inputData, context) => {
        try {
          const content = await anvilAgentEditService.readProjectFileRange(
            getProjectId(context),
            inputData.file_path,
            inputData.line_range,
          );

          return { content, error: null };
        } catch (error: unknown) {
          return { content: '', error: getErrorMessage(error) };
        }
      },
    }),
  };
}
