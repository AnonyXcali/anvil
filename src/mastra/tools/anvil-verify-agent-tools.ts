import { createTool, ToolExecutionContext } from '@mastra/core/tools';
import { z } from 'zod';
import { AnvilAgentEditService } from 'src/anvil-agent-edit/anvil-agent-edit.service';

const Z_EDIT_FILE_OUTPUT = z.object({
  success: z.boolean(),
  localFilePath: z.string().nullable(),
  error: z.string().nullable(),
});

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown verify tool error';
}

export function createAnvilVerifyAgentTools(
  anvilAgentEditService: AnvilAgentEditService,
) {
  return {
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
        'Apply a corrective edit to the local downloaded file being verified, with the reason/feedback provided. The code input must be the exact replacement text.',
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

          return { success: true, localFilePath, error: null };
        } catch (error: unknown) {
          return {
            success: false,
            localFilePath: null,
            error: getErrorMessage(error),
          };
        }
      },
    }),
  };
}
