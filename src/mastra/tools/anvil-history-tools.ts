import { createTool, ToolExecutionContext } from '@mastra/core/tools';
import { z } from 'zod';
import { AnvilHistoryService } from 'src/anvil-history/anvil-history.service';
import {
  Z_HISTORY_ENTRY_INPUT,
  type HistoryEntryInput,
} from 'src/anvil-history/anvil-history.types';

function getProjectId(context: ToolExecutionContext): string {
  const projectId = context.requestContext?.get('projectId');
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new Error('Project ID is unavailable for history processing');
  }
  return projectId;
}

export function createAnvilHistoryTools(historyService: AnvilHistoryService) {
  return {
    read_history: createTool({
      id: 'read_history',
      description:
        'Read the complete architecture/HISTORY.md file for the current project before searching or making changes.',
      outputSchema: z.string(),
      execute: async (_inputData: unknown, context: ToolExecutionContext) => {
        if (context.requestContext?.get('historyRead') === true) {
          return 'Architecture history was already read for this search run. Reuse the previous content.';
        }

        try {
          const content = await historyService.readHistory(
            getProjectId(context),
          );
          context.requestContext?.set('historyRead', true);
          return content;
        } catch (error: unknown) {
          context.requestContext?.set('historyRead', true);
          await context.writer?.custom({
            type: 'history_read_warning',
            payload: {
              message: error instanceof Error ? error.message : String(error),
            },
          });
          return '';
        }
      },
    }),
    append_history: createTool({
      id: 'append_history',
      description:
        'Append one structured success or failure entry to the current project architecture/HISTORY.md file.',
      inputSchema: Z_HISTORY_ENTRY_INPUT,
      outputSchema: z.string(),
      execute: async (inputData: HistoryEntryInput, context) => {
        return await historyService.appendHistoryEntry(
          getProjectId(context),
          inputData,
        );
      },
    }),
  };
}

export async function appendHistoryBestEffort(
  historyService: AnvilHistoryService,
  context: ToolExecutionContext,
  entry: HistoryEntryInput,
): Promise<void> {
  try {
    await historyService.appendHistoryEntry(getProjectId(context), entry);
  } catch (error: unknown) {
    await context.writer?.custom({
      type: 'history_write_warning',
      payload: {
        message: error instanceof Error ? error.message : String(error),
        subject: entry.subject,
      },
    });
  }
}
