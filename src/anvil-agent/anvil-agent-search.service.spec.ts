import { AnvilAgentSearchService } from './anvil-agent-search.service';
import { TOOL_REQUEST_SHAPE } from './anvil-agent.types';

const context = {
  writer: { custom: jest.fn() },
} as never;

const expansionRequest = (): TOOL_REQUEST_SHAPE => ({
  tool_call: 'search_tool',
  type: 'expand_context',
  query: {
    files_paths_for_content_search: [],
    files_path_for_expansion: {
      file_name: 'src/app/App.tsx',
      ranges: [{ startLine: 1, endLine: 10 }],
    },
    keyword: null,
  },
  history: [],
});

describe('AnvilAgentSearchService', () => {
  it('rejects malformed expansion before calling SSH', async () => {
    const sshService = { expandFiles: jest.fn() };
    const service = new AnvilAgentSearchService(sshService as never);
    const request = expansionRequest();
    request.query.files_path_for_expansion!.ranges = null;

    await expect(
      service.searchRouter(request, 'project-id', 1, context),
    ).rejects.toThrow('must contain at least one range');
    expect(sshService.expandFiles).not.toHaveBeenCalled();
  });

  it('executes valid expansion requests with the requested range', async () => {
    const sshService = {
      expandFiles: jest.fn().mockResolvedValue([
        {
          step: 'search-tool-expansive-search',
          stdout: '1: export default App() {}',
        },
      ]),
    };
    const service = new AnvilAgentSearchService(sshService as never);

    const result = await service.searchRouter(
      expansionRequest(),
      'project-id',
      1,
      context,
    );

    expect(sshService.expandFiles).toHaveBeenCalledTimes(1);
    expect(result.results[0]).toMatchObject({
      file_path: 'src/app/App.tsx',
      line_number: 1,
      relevant_text: '1: export default App() {}',
    });
  });
});
