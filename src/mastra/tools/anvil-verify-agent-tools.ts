import { createTool, ToolExecutionContext } from '@mastra/core/tools';
import { z } from 'zod';
import { AnvilAgentEditService } from 'src/anvil-agent-edit/anvil-agent-edit.service';
import { AnvilHistoryService } from 'src/anvil-history/anvil-history.service';
import {
  appendHistoryBestEffort,
  createAnvilHistoryTools,
} from './anvil-history-tools';

const Z_EDIT_FILE_OUTPUT = z.object({
  success: z.boolean(),
  localFilePath: z.string().nullable(),
  error: z.string().nullable(),
});

const Z_APPLY_PATCH_OUTPUT = z.object({
  success: z.boolean(),
  localFilePath: z.string().nullable(),
  attemptsUsed: z.number().int().nonnegative(),
  attemptsRemaining: z.number().int().nonnegative(),
  error: z.string().nullable(),
});

// One initial patch plus one regenerated patch after a conflict.
const MAX_PATCH_ATTEMPTS = 2;

const Z_READ_LOCAL_FILE_OUTPUT = z.object({
  content: z.string(),
  error: z.string().nullable(),
});

function getAllowedLocalFilePath(context: ToolExecutionContext): string {
  const localFilePath: string | undefined =
    context.requestContext?.get('localFilePath');

  if (!localFilePath) {
    throw new Error('Local file path is unavailable for verify tool');
  }

  return localFilePath;
}

function getProjectFilePath(context: ToolExecutionContext): string {
  return (
    context.requestContext?.get('projectFilePath') ?? 'verification target'
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown verify tool error';
}

function getPatchAttempts(context: ToolExecutionContext): number {
  const attempts = context.requestContext?.get('verifyPatchAttempts');
  return typeof attempts === 'number' &&
    Number.isInteger(attempts) &&
    attempts >= 0
    ? attempts
    : 0;
}

export function createAnvilVerifyAgentTools(
  anvilAgentEditService: AnvilAgentEditService,
  anvilHistoryService: AnvilHistoryService,
) {
  return {
    ...createAnvilHistoryTools(anvilHistoryService),
    read_local_file: createTool({
      id: 'read_local_file',
      description:
        'Read the current local downloaded file being verified. Optionally read only an inclusive 1-based line range.',
      inputSchema: z.object({
        localFilePath: z.string().min(1),
        line_range: z
          .object({
            start: z.number().int().positive(),
            end: z.number().int().positive(),
          })
          .optional(),
      }),
      outputSchema: Z_READ_LOCAL_FILE_OUTPUT,
      execute: async (inputData, context) => {
        try {
          const allowedLocalFilePath = getAllowedLocalFilePath(context);

          if (inputData.localFilePath !== allowedLocalFilePath) {
            throw new Error(
              'Verify read tool can only read the current local file',
            );
          }

          const content = await anvilAgentEditService.readLocal(
            inputData.localFilePath,
            inputData.line_range,
          );

          return { content, error: null };
        } catch (error: unknown) {
          return {
            content: '',
            error: getErrorMessage(error),
          };
        }
      },
    }),
    edit_file: createTool({
      id: 'edit_file',
      description:
        'Apply a corrective range edit to the local downloaded file being verified, with the reason/feedback provided. Use replace_file for a complete-file correction.',
      inputSchema: z.object({
        localFilePath: z.string().min(1),
        code: z.string(),
        line_range: z.object({
          startRange: z.number().int().positive(),
          endRange: z.number().int().positive(),
        }),
      }),
      outputSchema: Z_EDIT_FILE_OUTPUT,
      execute: async (inputData, context) => {
        try {
          const allowedLocalFilePath = getAllowedLocalFilePath(context);

          if (inputData.localFilePath !== allowedLocalFilePath) {
            throw new Error(
              'Verify edit tool can only edit the current local file',
            );
          }

          if (inputData.line_range.startRange > inputData.line_range.endRange) {
            throw new Error(
              'startRange must be less than or equal to endRange',
            );
          }

          const localFilePath = await anvilAgentEditService.edit(
            inputData.localFilePath,
            inputData.code,
            {
              start: inputData.line_range.startRange,
              end: inputData.line_range.endRange,
            },
          );
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Apply verification correction',
            status: 'success',
            changesMade: `Applied verification correction to ${inputData.localFilePath}.`,
            files: [getProjectFilePath(context)],
            actor: 'anvil-verify-agent.edit_file',
          });

          return { success: true, localFilePath, error: null };
        } catch (error: unknown) {
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Apply verification correction',
            status: 'failed',
            changesMade: getErrorMessage(error),
            files: [getProjectFilePath(context)],
            actor: 'anvil-verify-agent.edit_file',
          });
          return {
            success: false,
            localFilePath: null,
            error: getErrorMessage(error),
          };
        }
      },
    }),
    apply_patch: createTool({
      id: 'apply_patch',
      description:
        'Apply one bounded, exact-context standard unified diff to the current local verification file. Use this for focused corrections; at most one regenerated retry is allowed after a conflict.',
      inputSchema: z.object({
        localFilePath: z.string().min(1),
        patch: z.string().min(1),
      }),
      outputSchema: Z_APPLY_PATCH_OUTPUT,
      execute: async (inputData, context) => {
        const attemptsUsed = getPatchAttempts(context);

        if (attemptsUsed >= MAX_PATCH_ATTEMPTS) {
          return {
            success: false,
            localFilePath: null,
            attemptsUsed,
            attemptsRemaining: 0,
            error: `Patch attempt limit reached (${MAX_PATCH_ATTEMPTS})`,
          };
        }

        context.requestContext?.set('verifyPatchAttempts', attemptsUsed + 1);

        try {
          const allowedLocalFilePath = getAllowedLocalFilePath(context);
          if (inputData.localFilePath !== allowedLocalFilePath) {
            throw new Error(
              'Verify patch tool can only edit the current local file',
            );
          }

          const result = await anvilAgentEditService.applyUnifiedPatch(
            inputData.localFilePath,
            inputData.patch,
            getProjectFilePath(context),
          );
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Apply verification patch',
            status: 'success',
            changesMade: `Applied a focused unified diff (${result.hunksApplied} hunk(s)).`,
            files: [getProjectFilePath(context)],
            actor: 'anvil-verify-agent.apply_patch',
          });

          return {
            success: true,
            localFilePath: result.localFilePath,
            attemptsUsed: attemptsUsed + 1,
            attemptsRemaining: Math.max(
              0,
              MAX_PATCH_ATTEMPTS - attemptsUsed - 1,
            ),
            error: null,
          };
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Apply verification patch',
            status: 'failed',
            changesMade: message,
            files: [getProjectFilePath(context)],
            actor: 'anvil-verify-agent.apply_patch',
          });
          return {
            success: false,
            localFilePath: null,
            attemptsUsed: attemptsUsed + 1,
            attemptsRemaining: Math.max(
              0,
              MAX_PATCH_ATTEMPTS - attemptsUsed - 1,
            ),
            error: message,
          };
        }
      },
    }),
    replace_file: createTool({
      id: 'replace_file',
      description:
        'Replace the complete current local file with exact text. Use only when verification requires a whole-file replacement, especially for CSS.',
      inputSchema: z.object({
        localFilePath: z.string().min(1),
        code: z.string(),
      }),
      outputSchema: Z_EDIT_FILE_OUTPUT,
      execute: async (inputData, context) => {
        try {
          const allowedLocalFilePath = getAllowedLocalFilePath(context);
          if (inputData.localFilePath !== allowedLocalFilePath) {
            throw new Error(
              'Verify replace tool can only replace the current local file',
            );
          }

          const localFilePath = await anvilAgentEditService.replaceLocalFile(
            inputData.localFilePath,
            inputData.code,
          );
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Replace file during verification',
            status: 'success',
            changesMade: `Replaced the complete local file ${inputData.localFilePath}.`,
            files: [getProjectFilePath(context)],
            actor: 'anvil-verify-agent.replace_file',
          });
          return { success: true, localFilePath, error: null };
        } catch (error: unknown) {
          const message = getErrorMessage(error);
          await appendHistoryBestEffort(anvilHistoryService, context, {
            subject: 'Replace file during verification',
            status: 'failed',
            changesMade: message,
            files: [getProjectFilePath(context)],
            actor: 'anvil-verify-agent.replace_file',
          });
          return { success: false, localFilePath: null, error: message };
        }
      },
    }),
  };
}
