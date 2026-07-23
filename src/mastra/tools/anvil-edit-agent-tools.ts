import { createTool, ToolExecutionContext } from '@mastra/core/tools';
import { z } from 'zod';
import { AnvilAgentEditService } from 'src/anvil-agent-edit/anvil-agent-edit.service';
import type { createEditWorkflow } from 'src/anvil-agent-edit/anvil-agent-edit.workflow';
import { Z_EDIT_AGENT_WORKFLOW_INPUT } from 'src/anvil-agent-edit/anvil-agent-edit.types';

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown edit tool error';
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

export function createAnvilEditAgentTools(deps: {
  anvilAgentEditService: AnvilAgentEditService;
  editWorkflow: ReturnType<typeof createEditWorkflow>;
}) {
  const { anvilAgentEditService, editWorkflow } = deps;

  return {
    run_edit_workflow: createTool({
      id: 'run_edit_workflow',
      description:
        'Run the edit workflow once with workflow-ready FILE_EDIT[] input. Runtime workflow state is managed by application code, not by the model.',
      inputSchema: z.object({
        inputData: Z_EDIT_AGENT_WORKFLOW_INPUT,
      }),
      outputSchema: Z_RUN_EDIT_WORKFLOW_OUTPUT,
      execute: async (inputData, context) => {
        try {
          getProjectId(context);

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

          const run = await editWorkflow.createRun();
          const result = await run.start({
            inputData: inputData.inputData,
            initialState: inputData.inputData,
            requestContext: context.requestContext,
            outputWriter: async (chunk) => {
              await context.writer?.write(chunk);
            },
          });

          if (result.status !== 'success') {
            return {
              success: false,
              files: [],
              error: getWorkflowResultError(result),
            };
          }

          return {
            success: true,
            files: result.result.map((fileEdit) => fileEdit.file_path),
            error: null,
          };
        } catch (error: unknown) {
          return { success: false, files: [], error: getErrorMessage(error) };
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
        try {
          await anvilAgentEditService.createProjectFile(
            getProjectId(context),
            inputData.file_path,
          );

          return { success: true, error: null };
        } catch (error: unknown) {
          return { success: false, error: getErrorMessage(error) };
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
        try {
          await anvilAgentEditService.createProjectFolder(
            getProjectId(context),
            inputData.folder_path,
          );

          return { success: true, error: null };
        } catch (error: unknown) {
          return { success: false, error: getErrorMessage(error) };
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
        try {
          await anvilAgentEditService.deleteProjectFile(
            getProjectId(context),
            inputData.file_path,
          );

          return { success: true, error: null };
        } catch (error: unknown) {
          return { success: false, error: getErrorMessage(error) };
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
        try {
          await anvilAgentEditService.deleteProjectFolder(
            getProjectId(context),
            inputData.folder_path,
          );

          return { success: true, error: null };
        } catch (error: unknown) {
          return { success: false, error: getErrorMessage(error) };
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
