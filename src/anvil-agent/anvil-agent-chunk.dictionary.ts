/**
 * Stable application event names sent over Redis/SSE and consumed by the UI.
 * Mastra's raw chunk names are intentionally kept separate from this contract.
 * tool-call-input-streaming
 */
export const StreamEventType = {
  TEXT_DELTA: 'text-delta',
  TOOL_CALL: 'tool-call',
  TOOL_RESULT: 'tool-result',
  FINISH: 'finish',
  ERROR: 'error',
  WORKFLOW_ERROR: 'workflow_error',
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
  TASK_PREPARATION: 'task_preparation',
  COMPLETED: 'completed',
  TOOL_CALL_START: 'tool-call-input-streaming-start',
  TOOL_CALL_END: 'tool-call-input-streaming-end',
} as const;

export type StreamEventType =
  (typeof StreamEventType)[keyof typeof StreamEventType];
