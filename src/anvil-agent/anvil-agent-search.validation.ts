import type { TOOL_REQUEST_SHAPE } from './anvil-agent.types';
import { isProjectRelativePath } from './anvil-agent-search.path';
import {
  InvalidFileSearchPatternError,
  normalizeFileSearchKeywords,
} from './anvil-agent-search-pattern';

export type SearchRequestValidationDetails = {
  searchType: TOOL_REQUEST_SHAPE['type'];
  field: string;
  reason: string;
  filePath?: string;
};

export class InvalidSearchToolRequestError extends Error {
  readonly code = 'INVALID_SEARCH_TOOL_REQUEST';

  constructor(readonly details: SearchRequestValidationDetails) {
    super(
      `Invalid ${details.searchType} request: ${details.field} ${details.reason}`,
    );
    this.name = 'InvalidSearchToolRequestError';
  }
}

function fail(
  request: TOOL_REQUEST_SHAPE,
  field: string,
  reason: string,
  filePath?: string,
): never {
  throw new InvalidSearchToolRequestError({
    searchType: request.type,
    field,
    reason,
    filePath:
      filePath && isProjectRelativePath(filePath) ? filePath : undefined,
  });
}

export function assertValidSearchToolRequest(
  request: TOOL_REQUEST_SHAPE,
): void {
  if (request.tool_call !== 'search_tool') {
    fail(request, 'tool_call', 'must be search_tool');
  }

  if (!Array.isArray(request.history)) {
    fail(request, 'history', 'must be an array');
  }

  if (request.type === 'file_search') {
    if (!request.query.keyword?.length) {
      fail(request, 'query.keyword', 'must contain at least one keyword');
    }
    for (const [index, keyword] of request.query.keyword.entries()) {
      try {
        normalizeFileSearchKeywords([keyword]);
      } catch (error) {
        if (error instanceof InvalidFileSearchPatternError) {
          fail(request, `query.keyword[${index}]`, error.reason);
        }
        throw error;
      }
    }
    return;
  }

  if (request.type === 'content_search') {
    if (!request.query.files_paths_for_content_search.length) {
      fail(
        request,
        'query.files_paths_for_content_search',
        'must contain at least one file path',
      );
    }
    if (!request.query.keyword?.length) {
      fail(request, 'query.keyword', 'must contain at least one keyword');
    }
    for (const filePath of request.query.files_paths_for_content_search) {
      if (!isProjectRelativePath(filePath)) {
        fail(
          request,
          'query.files_paths_for_content_search',
          'must contain only project-relative paths',
          filePath,
        );
      }
    }
    return;
  }

  const expansion = request.query.files_path_for_expansion;
  if (!expansion) {
    fail(request, 'query.files_path_for_expansion', 'must be provided');
  }

  if (!isProjectRelativePath(expansion.file_name)) {
    fail(
      request,
      'query.files_path_for_expansion.file_name',
      'must be a project-relative path',
      expansion.file_name,
    );
  }

  if (!expansion.ranges?.length) {
    fail(
      request,
      'query.files_path_for_expansion.ranges',
      'must contain at least one range',
      expansion.file_name,
    );
  }

  for (const [index, range] of expansion.ranges.entries()) {
    if (!Number.isInteger(range.startLine) || range.startLine <= 0) {
      fail(
        request,
        `query.files_path_for_expansion.ranges[${index}].startLine`,
        'must be a positive integer',
        expansion.file_name,
      );
    }
    if (!Number.isInteger(range.endLine) || range.endLine <= 0) {
      fail(
        request,
        `query.files_path_for_expansion.ranges[${index}].endLine`,
        'must be a positive integer',
        expansion.file_name,
      );
    }
    if (range.startLine > range.endLine) {
      fail(
        request,
        `query.files_path_for_expansion.ranges[${index}]`,
        'must have startLine less than or equal to endLine',
        expansion.file_name,
      );
    }
  }
}
