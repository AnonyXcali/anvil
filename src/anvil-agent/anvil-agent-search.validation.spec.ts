import {
  assertValidSearchToolRequest,
  InvalidSearchToolRequestError,
} from './anvil-agent-search.validation';
import { TOOL_REQUEST_SHAPE, Z_TOOL_REQUEST_SHAPE } from './anvil-agent.types';

const baseRequest = (): TOOL_REQUEST_SHAPE => ({
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

describe('search tool request validation', () => {
  it('accepts a valid expansion request', () => {
    expect(() => assertValidSearchToolRequest(baseRequest())).not.toThrow();
  });

  it.each([
    ['missing ranges', null],
    ['empty ranges', []],
  ])('%s fails before execution', (_, ranges) => {
    const request = baseRequest();
    request.query.files_path_for_expansion!.ranges = ranges;

    expect(Z_TOOL_REQUEST_SHAPE.safeParse(request).success).toBe(false);
    expect(() => assertValidSearchToolRequest(request)).toThrow(
      InvalidSearchToolRequestError,
    );
  });

  it('rejects non-positive or reversed line ranges', () => {
    const request = baseRequest();
    request.query.files_path_for_expansion!.ranges = [
      { startLine: 0, endLine: 5 },
    ];

    expect(() => assertValidSearchToolRequest(request)).toThrow(
      'startLine must be a positive integer',
    );

    request.query.files_path_for_expansion!.ranges = [
      { startLine: 8, endLine: 3 },
    ];

    expect(() => assertValidSearchToolRequest(request)).toThrow(
      'startLine less than or equal to endLine',
    );
  });

  it('rejects absolute and traversal expansion paths', () => {
    const request = baseRequest();
    request.query.files_path_for_expansion!.file_name = '/src/app/App.tsx';

    expect(() => assertValidSearchToolRequest(request)).toThrow(
      'must be a project-relative path',
    );

    request.query.files_path_for_expansion!.file_name = 'src/../app/App.tsx';

    expect(() => assertValidSearchToolRequest(request)).toThrow(
      'must be a project-relative path',
    );
  });

  it('rejects absolute and traversal content-search paths', () => {
    const request = baseRequest();
    request.type = 'content_search';
    request.query.files_path_for_expansion = null;
    request.query.keyword = ['className'];
    request.query.files_paths_for_content_search = ['/etc/passwd'];

    expect(() => assertValidSearchToolRequest(request)).toThrow(
      'must contain only project-relative paths',
    );

    request.query.files_paths_for_content_search = ['src/../.env'];
    expect(() => assertValidSearchToolRequest(request)).toThrow(
      'must contain only project-relative paths',
    );
  });

  it('requires keywords and paths for the other search modes', () => {
    const fileRequest = baseRequest();
    fileRequest.type = 'file_search';
    fileRequest.query.files_path_for_expansion = null;
    expect(() => assertValidSearchToolRequest(fileRequest)).toThrow(
      'query.keyword must contain at least one keyword',
    );

    const contentRequest = baseRequest();
    contentRequest.type = 'content_search';
    contentRequest.query.files_path_for_expansion = null;
    expect(() => assertValidSearchToolRequest(contentRequest)).toThrow(
      'query.files_paths_for_content_search must contain at least one file path',
    );
  });
});
