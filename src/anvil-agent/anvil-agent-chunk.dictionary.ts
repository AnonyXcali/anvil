export const StreamEventType = {
  TEXT_DELTA: 'text-delta',
  TOOL_CALL: 'tool-call',
  TOOL_RESULT: 'tool-result',
  FINISH: 'finish',
  ERROR: 'error',
  TOOL_PROGRESS: 'data-tool-progress',
  SEARCH_TOOL_FILE_SEARCH_LOG: 'data-search-tool-file-search-log',
  SEARCH_TOOL_CONTENT_SEARCH_LOG: 'data-search-tool-content-search-log',
  SEARCH_TOOL_EXPANSIVE_SEARCH_LOG: 'data-search-tool-expansive-search-log',
  SEARCH_ROUTER_LOG: 'data-search-router-log',
  APPROVAL_REQUIRED: 'approval_required',
  WORKFLOW_STATUS: 'workflow_status',
  SEARCH_STATUS: 'search_status',
  EDIT_STATUS: 'edit_status',
  TOOL_STATUS: 'tool_status',
  VERIFICATION_STATUS: 'verification_status',
  COMPLETED: 'completed',
} as const;

export type StreamEventType =
  (typeof StreamEventType)[keyof typeof StreamEventType];
