import { createAnvilAgentSearchTool } from './anvil-agent-search-tool';
import { TOOL_REQUEST_SHAPE } from 'src/anvil-agent/anvil-agent.types';

const fileSearchRequest = (keyword: string): TOOL_REQUEST_SHAPE => ({
  tool_call: 'search_tool',
  type: 'file_search',
  query: {
    files_paths_for_content_search: [],
    files_path_for_expansion: null,
    keyword: [keyword],
  },
  history: [],
});

function createContext(values: Record<string, unknown>) {
  const context = {
    requestContext: {
      get: (key: string) => values[key],
      set: jest.fn(),
    },
    writer: { custom: jest.fn() },
  };
  return { context, typed: context as never };
}

describe('Anvil search tool', () => {
  it('rejects malformed file-search patterns before calling the search service', async () => {
    const searchService = {
      anvilAgentSearchToolLogger: jest.fn(),
      searchRouter: jest.fn(),
    };
    const tool = createAnvilAgentSearchTool(searchService as never);
    const { context, typed } = createContext({
      projectId: 'project-id',
      callCount: 0,
      maxSearchCalls: 10,
    });
    const execute = (
      tool as unknown as {
        execute: (
          input: TOOL_REQUEST_SHAPE,
          context: typeof typed,
        ) => Promise<unknown>;
      }
    ).execute;

    await expect(
      execute(fileSearchRequest('src/[App].tsx'), typed),
    ).rejects.toThrow('query.keyword[0] contains unsupported glob syntax');

    expect(searchService.searchRouter).not.toHaveBeenCalled();
    expect(context.requestContext.set).not.toHaveBeenCalled();
    expect(context.writer.custom).not.toHaveBeenCalled();
    expect(searchService.anvilAgentSearchToolLogger).toHaveBeenCalledWith(
      expect.stringContaining('query.keyword[0]'),
    );
  });
});
