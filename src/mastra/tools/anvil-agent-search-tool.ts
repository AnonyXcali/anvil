import { createTool, ToolExecutionContext } from '@mastra/core/tools';
import { StreamEventType } from 'src/anvil-agent/anvil-agent-chunk.dictionary';
import { AnvilAgentSearchService } from 'src/anvil-agent/anvil-agent-search.service';
import {
  TOOL_REQUEST_SHAPE,
  Z_SEARCH_TOOL_RESPONSE,
  Z_TOOL_REQUEST_SHAPE,
} from 'src/anvil-agent/anvil-agent.types';

export function createAnvilAgentSearchTool(
  anvilAgentSearchService: AnvilAgentSearchService,
  options: { requireHistory?: boolean } = {},
) {
  return createTool({
    id: 'anvil-agent-search-tool',
    description:
      'this tool is designed to help search target keywords in the codebase',
    inputSchema: Z_TOOL_REQUEST_SHAPE,
    outputSchema: Z_SEARCH_TOOL_RESPONSE,
    execute: async (inputData: TOOL_REQUEST_SHAPE, context) => {
      return await fileSearch(
        inputData,
        anvilAgentSearchService,
        context,
        options.requireHistory === true,
      );
    },
  });
}

async function fileSearch(
  inputData: TOOL_REQUEST_SHAPE,
  anvilAgentSearchService: AnvilAgentSearchService,
  context: ToolExecutionContext,
  requireHistory: boolean,
) {
  if (requireHistory && context.requestContext?.get('historyRead') !== true) {
    throw new Error(
      'Read architecture/HISTORY.md before searching the project',
    );
  }

  const projectId: string | undefined =
    context.requestContext?.get('projectId');

  const count: number = context.requestContext?.get('callCount') as number;
  const updatedCount = count + 1;
  context.requestContext?.set('callCount', updatedCount);

  if (!projectId) {
    throw new Error('project id unavailable for processing');
  }

  await context?.writer?.custom({
    type: StreamEventType.SEARCH_ROUTER_LOG,
    data: { line: `Performing: ${inputData.type}` },
    transient: true,
  });

  return await anvilAgentSearchService.searchRouter(
    inputData,
    projectId,
    updatedCount,
    context,
  );
}
