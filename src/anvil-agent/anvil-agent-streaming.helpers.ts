import { StreamEventType } from './anvil-agent-chunk.dictionary';

export type StreamEnvelopeSource = 'intent' | 'supervisor' | 'workflow-resume';
type AppStreamEventStatus =
  | 'started'
  | 'running'
  | 'completed'
  | 'failed'
  | 'suspended'
  | 'cancelled';

/** The durable envelope sent through Redis and then delivered over SSE. */
export type StreamEnvelope = {
  type: string;
  source: StreamEnvelopeSource;
  conversationId: string;
  jobId?: string;
  approvalRequestId?: string;
  workflowId?: string;
  runId?: string;
  raw: unknown;
  createdAt: string;
};

/** A stable Anvil UI event derived from a Mastra stream chunk. */
export type AppStreamEvent = {
  type: string;
  payload: {
    status: AppStreamEventStatus;
    message: string;
    step?: string;
    toolName?: string;
  };
};

/** Approval data extracted from a suspended Mastra tool call. */
export type ApprovalSuspendPayload = {
  title: string;
  message: string;
  summary?: string;
  toolCallId?: string;
  toolName?: string;
  runId?: string;
  raw: Record<string, unknown>;
};

type StatusMessages = {
  started?: string;
  running?: string;
  completed?: string;
  failed?: string;
  suspended?: string;
  cancelled?: string;
};

const WORKFLOW_STEP_STATUS_MESSAGES: Record<string, StatusMessages> = {
  'anvil-agent-workflow-search-step': {
    started: 'Searching for files that need changes.',
    completed: 'Finished identifying files to update.',
  },
  'anvil-agent-workflow-plan-step': {
    started: 'Preparing a summary of the proposed changes.',
    completed: 'Prepared the change summary.',
    suspended: 'Waiting for approval before applying changes.',
  },
  'anvil-agent-workflow-edit-input-compression': {
    started: 'Preparing edit instructions.',
    completed: 'Prepared edit instructions.',
  },
  'anvil-agent-workflow-edit-step': {
    started: 'Starting the edit workflow.',
    completed: 'Finished the edit workflow.',
    failed: 'The edit workflow failed.',
  },
  'anvil-edit-agent-nested-workflow-download-file-step': {
    started: 'Downloading the target file.',
    completed: 'Downloaded the target file.',
    failed: 'Download failed.',
  },
  'anvil-edit-agent-nested-workflow-backup-original-file-step': {
    started: 'Creating a backup of the original file.',
    completed: 'Created a backup of the original file.',
    failed: 'Backup failed.',
  },
  'anvil-edit-agent-nested-workflow-apply-edit-file-step': {
    started: 'Applying the requested edit locally.',
    completed: 'Applied the requested edit locally.',
    failed: 'Local edit failed.',
  },
  'anvil-edit-agent-nested-workflow-verify-edit-file-step': {
    started: 'Verifying the edit.',
    running: 'Checking whether the edit satisfies the request.',
    completed: 'Verified the edit.',
    failed: 'Verification failed.',
  },
  'anvil-edit-agent-nested-workflow-upload-edit-file-step': {
    started: 'Uploading the verified file.',
    completed: 'Uploaded the verified file.',
    failed: 'Upload failed.',
  },
  'anvil-edit-agent-nested-workflow-delete-temp-file-step': {
    started: 'Cleaning up temporary files.',
    completed: 'Cleaned up temporary files.',
    failed: 'Cleanup failed.',
  },
  'anvil-edit-agent-coordinated-upload-files-step': {
    started: 'Uploading the verified project changes.',
    completed: 'Uploaded the verified project changes.',
    failed: 'Coordinated upload failed.',
  },
  'anvil-edit-agent-coordinated-cleanup-files-step': {
    started: 'Cleaning up staged project files.',
    completed: 'Cleaned up staged project files.',
    failed: 'Staged project cleanup failed.',
  },
  'anvil-agent-structure-create-directories-step': {
    started: 'Preparing the project structure.',
    completed: 'Prepared the project structure.',
    failed: 'Failed to prepare the project structure.',
  },
  'anvil-edit-agent-staging-prepare-all-files-step': {
    started: 'Preparing all files locally.',
    completed: 'Prepared all files locally.',
    failed: 'Failed to prepare files locally.',
  },
  'anvil-agent-staged-create-file-branch-step': {
    started: 'Preparing a new file locally.',
    completed: 'Prepared the new file locally.',
    failed: 'New-file preparation failed.',
  },
  'anvil-agent-staged-existing-file-branch-step': {
    started: 'Preparing the existing file edit.',
    completed: 'Prepared the existing file edit.',
    failed: 'Existing-file preparation failed.',
  },
  'anvil-agent-staged-branch-input-file-step': {
    started: 'Preparing the staged file operation.',
    completed: 'Prepared the staged file operation.',
    failed: 'Staged file preparation failed.',
  },
  'anvil-edit-agent-staged-create-file-branch-step': {
    started: 'Preparing a new file locally.',
    completed: 'Prepared the new file locally.',
    failed: 'New-file preparation failed.',
  },
  'anvil-edit-agent-staged-existing-file-branch-step': {
    started: 'Preparing the existing file edit.',
    completed: 'Prepared the existing file edit.',
    failed: 'Existing-file preparation failed.',
  },
  'anvil-edit-agent-staged-branch-input-file-step': {
    started: 'Preparing the staged file operation.',
    completed: 'Prepared the staged file operation.',
    failed: 'Staged file preparation failed.',
  },
  'anvil-edit-agent-staging-validate-project-step': {
    started: 'Validating the staged project.',
    completed: 'Validated the staged project.',
    failed: 'Staged project validation failed.',
  },
  'anvil-edit-agent-staging-commit-files-step': {
    started: 'Committing the verified project changes.',
    completed: 'Committed the verified project changes.',
    failed: 'Project commit failed.',
  },
  'anvil-edit-agent-staging-cleanup-transaction-step': {
    started: 'Cleaning up the staged transaction.',
    completed: 'Cleaned up the staged transaction.',
    failed: 'Staged transaction cleanup failed.',
  },
};

const TOOL_STATUS_MESSAGES: Record<string, StatusMessages> = {
  apply_patch: {
    started: 'Applying a focused verification patch.',
    completed: 'Applied the focused verification patch.',
    failed: 'Focused verification patch failed.',
  },
  replace_file: {
    started: 'Replacing the complete local file.',
    completed: 'Replaced the complete local file.',
    failed: 'Complete file replacement failed.',
  },
  create_file: {
    started: 'Creating a required file.',
    completed: 'Created the required file.',
  },
  create_folder: {
    started: 'Creating a required folder.',
    completed: 'Created the required folder.',
  },
  delete_file: {
    started: 'Deleting a confirmed file.',
    completed: 'Deleted the confirmed file.',
  },
  delete_folder: {
    started: 'Deleting a confirmed empty folder.',
    completed: 'Deleted the confirmed empty folder.',
  },
  verify_file_existing: {
    started: 'Checking whether the file exists.',
    completed: 'Finished checking the file.',
  },
  verify_folder_existing: {
    started: 'Checking whether the folder exists.',
    completed: 'Finished checking the folder.',
  },
  read_file: {
    started: 'Reading file context.',
    completed: 'Finished reading file context.',
  },
  edit_file: {
    started: 'Applying a verification correction.',
    completed: 'Applied the verification correction.',
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getNestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const nested = value[key];

  return isRecord(nested) ? nested : undefined;
}

function getStringValue(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const nested = value[key];

  return typeof nested === 'string' ? nested : undefined;
}

function getUnknownValue(value: Record<string, unknown>, key: string): unknown {
  return value[key];
}

/** Returns a Mastra chunk type, or `unknown` for malformed input. */
export function getStreamChunkType(chunk: unknown): string {
  if (!isRecord(chunk)) {
    return 'unknown';
  }

  return getStringValue(chunk, 'type') ?? 'unknown';
}

/** Extracts workflow and run identifiers from a Mastra chunk payload. */
export function getWorkflowIdentifiers(chunk: unknown): {
  workflowId?: string;
  runId?: string;
} {
  if (!isRecord(chunk)) {
    return {};
  }

  const payload = getNestedRecord(chunk, 'payload');

  return {
    workflowId:
      getStringValue(payload ?? {}, 'workflowId') ??
      getStringValue(payload ?? {}, 'workflowName'),
    runId:
      getStringValue(chunk, 'runId') ?? getStringValue(payload ?? {}, 'runId'),
  };
}

/** Extracts Anvil approval data from a suspended tool-call chunk. */
export function getApprovalSuspendPayload(
  chunk: unknown,
): ApprovalSuspendPayload | null {
  if (!isRecord(chunk) || getStreamChunkType(chunk) !== 'tool-call-suspended') {
    return null;
  }

  const payload = getNestedRecord(chunk, 'payload');
  const suspendPayload = getNestedRecord(payload ?? {}, 'suspendPayload');
  const approvalPayload = getNestedRecord(suspendPayload ?? {}, 'payload');

  if (getStringValue(suspendPayload ?? {}, 'type') !== 'approval_required') {
    return null;
  }

  return {
    title:
      getStringValue(approvalPayload ?? {}, 'title') ??
      'Apply proposed changes?',
    message:
      getStringValue(approvalPayload ?? {}, 'message') ??
      'The AI has prepared a set of changes that require your approval.',
    summary: getStringValue(approvalPayload ?? {}, 'summary'),
    toolCallId: getStringValue(payload ?? {}, 'toolCallId'),
    toolName: getStringValue(payload ?? {}, 'toolName'),
    runId: getStringValue(chunk, 'runId'),
    raw: {
      type: getStreamChunkType(chunk),
      toolCallId: getStringValue(payload ?? {}, 'toolCallId'),
      toolName: getStringValue(payload ?? {}, 'toolName'),
      args: getUnknownValue(payload ?? {}, 'args'),
      suspendPayload,
      resumeSchema: getUnknownValue(payload ?? {}, 'resumeSchema'),
      runId: getStringValue(chunk, 'runId'),
    },
  };
}

/** Keeps approval copy business-facing even when model output is over-specific. */
export function sanitizeApprovalSummary(summary: string): string {
  const safeLines = summary
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('```'))
    .filter((line) => !/^[-+]{3}\s/.test(line))
    .filter(
      (line) =>
        !/\b(file_path|depends_on|structure_plan|patch|implementation details?)\b/i.test(
          line,
        ),
    )
    .filter((line) => !/\b(?:src|app|components|pages)\/[^\s]+/i.test(line))
    .filter((line) => !/\.(?:tsx?|jsx?|css|scss|json)\b/i.test(line));

  const sanitized = safeLines.join(' ').trim();
  return (
    sanitized || 'The requested application improvements are ready for review.'
  );
}

/** Finds the nested workflow run ID associated with an approval suspension. */
export function getSuspendedToolRunIdFromMessages(
  messages: unknown,
  toolCallId?: string,
  toolName?: string,
): string | undefined {
  if (!Array.isArray(messages)) {
    return undefined;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message: unknown = messages[index];

    if (!isRecord(message)) {
      continue;
    }

    const content = getNestedRecord(message, 'content');
    const metadata = getNestedRecord(content ?? {}, 'metadata');
    const suspendedTools = getNestedRecord(metadata ?? {}, 'suspendedTools');
    const runIdFromMetadata = getSuspendedToolRunIdFromEntries(
      suspendedTools,
      toolCallId,
      toolName,
    );

    if (runIdFromMetadata) {
      return runIdFromMetadata;
    }

    const parts = getUnknownValue(content ?? {}, 'parts');
    const runIdFromParts = getSuspendedToolRunIdFromParts(
      parts,
      toolCallId,
      toolName,
    );

    if (runIdFromParts) {
      return runIdFromParts;
    }
  }

  return undefined;
}

function getSuspendedToolRunIdFromEntries(
  entries: Record<string, unknown> | undefined,
  toolCallId?: string,
  toolName?: string,
): string | undefined {
  if (!entries) {
    return undefined;
  }

  const candidates = [
    toolCallId ? entries[toolCallId] : undefined,
    toolName ? entries[toolName] : undefined,
    ...Object.values(entries),
  ];

  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }

    const matchesToolCall =
      !toolCallId || getStringValue(candidate, 'toolCallId') === toolCallId;
    const matchesToolName =
      !toolName || getStringValue(candidate, 'toolName') === toolName;

    if (matchesToolCall && matchesToolName) {
      return getStringValue(candidate, 'runId');
    }
  }

  return undefined;
}

function getSuspendedToolRunIdFromParts(
  parts: unknown,
  toolCallId?: string,
  toolName?: string,
): string | undefined {
  if (!Array.isArray(parts)) {
    return undefined;
  }

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part: unknown = parts[index];

    if (!isRecord(part)) {
      continue;
    }

    const type = getStringValue(part, 'type');

    if (
      type !== 'data-tool-call-suspended' &&
      type !== 'data-tool-call-approval'
    ) {
      continue;
    }

    const data = getNestedRecord(part, 'data');

    if (!data) {
      continue;
    }

    const matchesToolCall =
      !toolCallId || getStringValue(data, 'toolCallId') === toolCallId;
    const matchesToolName =
      !toolName || getStringValue(data, 'toolName') === toolName;

    if (matchesToolCall && matchesToolName) {
      return getStringValue(data, 'runId');
    }
  }

  return undefined;
}

/** Indicates whether a chunk contains an empty text or tool-call delta. */
export function isEmptyStreamChunk(chunk: unknown): boolean {
  if (!isRecord(chunk)) {
    return false;
  }

  const type = getStreamChunkType(chunk);
  const payload = getNestedRecord(chunk, 'payload');

  if (type === 'text-delta' || type === 'reasoning-delta') {
    const text = getStringValue(payload ?? {}, 'text');
    return text === '';
  }

  if (type === 'tool-call-delta') {
    const argsTextDelta = getStringValue(payload ?? {}, 'argsTextDelta');
    return argsTextDelta === '';
  }

  return false;
}

/** Reads the workflow status emitted by a workflow-finish chunk. */
export function getWorkflowFinishStatus(chunk: unknown): string | undefined {
  if (!isRecord(chunk)) {
    return undefined;
  }

  const payload = getNestedRecord(chunk, 'payload');

  return getStringValue(payload ?? {}, 'workflowStatus');
}

/**
 * Converts one Mastra workflow/tool chunk into the stable event understood by
 * the testing UI. Raw chunks that have no user-facing application meaning
 * return null and are still eligible for raw-envelope publication.
 */
export function buildAppStreamEvent(chunk: unknown): AppStreamEvent | null {
  if (!isRecord(chunk)) {
    return null;
  }

  const chunkType = getStringValue(chunk, 'type') ?? 'unknown';
  const payload = getNestedRecord(chunk, 'payload') ?? {};
  const stepId = getStringValue(payload, 'id') ?? getStringValue(chunk, 'id');
  const toolArgs = getNestedRecord(payload, 'args') ?? {};
  const toolName =
    getStringValue(payload, 'toolName') ?? getStringValue(toolArgs, 'toolName');

  if (
    chunkType === 'workflow-execution-start' ||
    chunkType === 'workflow-start'
  ) {
    return {
      type: StreamEventType.WORKFLOW_STATUS,
      payload: {
        status: 'started',
        message: 'Started preparing changes.',
        step: 'workflow',
      },
    };
  }

  if (chunkType === 'edit_progress') {
    const status = getStringValue(payload, 'status');
    if (status !== 'started' && status !== 'completed' && status !== 'failed') {
      return null;
    }

    return {
      type: StreamEventType.EDIT_STATUS,
      payload: {
        status,
        message:
          getStringValue(payload, 'message') ?? 'Updating project files.',
        step: getStringValue(payload, 'step'),
      },
    };
  }

  if (
    chunkType === 'workflow-execution-suspended' ||
    chunkType === 'workflow-step-suspended'
  ) {
    return null;
  }

  if (
    chunkType === 'workflow-execution-abort' ||
    chunkType === 'workflow-canceled' ||
    chunkType === 'abort'
  ) {
    return {
      type: StreamEventType.WORKFLOW_ERROR,
      payload: {
        status: 'failed',
        message: 'The workflow was interrupted.',
        step: 'workflow',
      },
    };
  }

  if (chunkType === 'workflow-finish') {
    const failed = getStringValue(payload, 'workflowStatus') === 'failed';

    return {
      type: failed ? StreamEventType.WORKFLOW_ERROR : StreamEventType.COMPLETED,
      payload: {
        status: failed ? 'failed' : 'completed',
        message: failed ? 'Something went wrong.' : 'Workflow completed.',
        step: 'workflow',
      },
    };
  }

  if (
    chunkType === 'workflow-step-start' ||
    chunkType === 'workflow-step-finish' ||
    chunkType === 'workflow-step-result'
  ) {
    const failed = getStringValue(payload, 'status') === 'failed';
    const completed = chunkType !== 'workflow-step-start' && !failed;
    if (failed) {
      return {
        type: StreamEventType.WORKFLOW_ERROR,
        payload: {
          status: 'failed',
          message: 'Something went wrong.',
          step: stepId,
        },
      };
    }
    const eventType = stepId?.includes('search')
      ? StreamEventType.SEARCH_STATUS
      : stepId?.includes('verify')
        ? StreamEventType.VERIFICATION_STATUS
        : stepId?.includes('edit') ||
            stepId?.includes('download') ||
            stepId?.includes('backup') ||
            stepId?.includes('upload') ||
            stepId?.includes('delete-temp') ||
            stepId?.includes('staging') ||
            stepId?.includes('structure-create-directories')
          ? StreamEventType.EDIT_STATUS
          : StreamEventType.WORKFLOW_STATUS;
    const status: AppStreamEventStatus = failed
      ? 'failed'
      : completed
        ? 'completed'
        : 'started';
    const messages = WORKFLOW_STEP_STATUS_MESSAGES[stepId ?? ''];
    const fallbackMessage =
      getStringValue(payload, 'status') === 'failed'
        ? 'A workflow step failed.'
        : completed
          ? 'Completed a workflow step.'
          : 'Started a workflow step.';

    return {
      type: eventType,
      payload: {
        status,
        message: messages?.[status] ?? fallbackMessage,
        step: stepId,
      },
    };
  }

  if (chunkType === 'tool-call' || chunkType === 'tool-execution-start') {
    const messages = TOOL_STATUS_MESSAGES[toolName ?? ''];

    return {
      type: StreamEventType.TOOL_STATUS,
      payload: {
        status: 'started',
        message: messages?.started ?? 'Started a tool action.',
        toolName,
      },
    };
  }

  if (
    chunkType === 'tool-result' ||
    chunkType === 'tool-execution-end' ||
    chunkType === 'tool-output'
  ) {
    const messages = TOOL_STATUS_MESSAGES[toolName ?? ''];

    return {
      type: StreamEventType.TOOL_STATUS,
      payload: {
        status: 'completed',
        message: messages?.completed ?? 'Completed a tool action.',
        toolName,
      },
    };
  }

  if (chunkType === 'error') {
    return {
      type: StreamEventType.WORKFLOW_ERROR,
      payload: { status: 'failed', message: 'Something went wrong.' },
    };
  }

  if (chunkType === 'tool-error' || chunkType === 'tripwire') {
    return {
      type: StreamEventType.ERROR,
      payload: { status: 'failed', message: 'Something went wrong.' },
    };
  }

  if (chunkType === 'is-task-complete') {
    return {
      type: StreamEventType.VERIFICATION_STATUS,
      payload: {
        status: 'running',
        message: 'Checking whether the edit satisfies the request.',
        step: 'verification',
      },
    };
  }

  return null;
}

/** Wraps a raw Mastra or application event with conversation stream metadata. */
export function buildStreamEnvelope({
  chunk,
  conversationId,
  source,
  jobId,
  approvalRequestId,
}: {
  chunk: unknown;
  conversationId: string;
  source: StreamEnvelopeSource;
  jobId?: string;
  approvalRequestId?: string;
}): StreamEnvelope {
  const { workflowId, runId } = getWorkflowIdentifiers(chunk);

  return {
    type: getStreamChunkType(chunk),
    source,
    conversationId,
    jobId,
    approvalRequestId,
    workflowId,
    runId,
    raw: chunk,
    createdAt: new Date().toISOString(),
  };
}
