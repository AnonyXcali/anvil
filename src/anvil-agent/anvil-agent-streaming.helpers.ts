import { StreamEventType } from './anvil-agent-chunk.dictionary';

type StreamEnvelopeSource = 'supervisor' | 'workflow-resume';
type AppStreamEventStatus =
  | 'started'
  | 'running'
  | 'completed'
  | 'failed'
  | 'suspended'
  | 'cancelled';

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

export type AppStreamEvent = {
  type: string;
  payload: {
    status: AppStreamEventStatus;
    message: string;
    step?: string;
    toolName?: string;
  };
};

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
  },
  'anvil-edit-agent-nested-workflow-download-file-step': {
    started: 'Downloading the target file.',
    completed: 'Downloaded the target file.',
  },
  'anvil-edit-agent-nested-workflow-backup-original-file-step': {
    started: 'Creating a backup of the original file.',
    completed: 'Created a backup of the original file.',
  },
  'anvil-edit-agent-nested-workflow-apply-edit-file-step': {
    started: 'Applying the requested edit locally.',
    completed: 'Applied the requested edit locally.',
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
  },
};

const TOOL_STATUS_MESSAGES: Record<string, StatusMessages> = {
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

export function getStreamChunkType(chunk: unknown): string {
  if (!isRecord(chunk)) {
    return 'unknown';
  }

  return getStringValue(chunk, 'type') ?? 'unknown';
}

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

export function getWorkflowFinishStatus(chunk: unknown): string | undefined {
  if (!isRecord(chunk)) {
    return undefined;
  }

  const payload = getNestedRecord(chunk, 'payload');

  return getStringValue(payload ?? {}, 'workflowStatus');
}

function getChunkPayload(chunk: unknown): Record<string, unknown> | undefined {
  return isRecord(chunk) ? getNestedRecord(chunk, 'payload') : undefined;
}

function getWorkflowStepId(chunk: unknown): string | undefined {
  if (!isRecord(chunk)) {
    return undefined;
  }

  const payload = getChunkPayload(chunk);

  return getStringValue(payload ?? {}, 'id') ?? getStringValue(chunk, 'id');
}

function getToolName(chunk: unknown): string | undefined {
  const payload = getChunkPayload(chunk);
  const args = getNestedRecord(payload ?? {}, 'args');

  return (
    getStringValue(payload ?? {}, 'toolName') ??
    getStringValue(args ?? {}, 'toolName')
  );
}

function buildAppStatusEvent({
  type,
  status,
  message,
  step,
  toolName,
}: {
  type: StreamEventType;
  status: AppStreamEventStatus;
  message: string;
  step?: string;
  toolName?: string;
}): AppStreamEvent {
  return {
    type,
    payload: {
      status,
      message,
      step,
      toolName,
    },
  };
}

function getStepEventType(stepId: string | undefined): StreamEventType {
  if (!stepId) {
    return StreamEventType.WORKFLOW_STATUS;
  }

  if (stepId.includes('search')) {
    return StreamEventType.SEARCH_STATUS;
  }

  if (stepId.includes('verify')) {
    return StreamEventType.VERIFICATION_STATUS;
  }

  if (
    stepId.includes('edit') ||
    stepId.includes('download') ||
    stepId.includes('backup') ||
    stepId.includes('upload') ||
    stepId.includes('delete-temp')
  ) {
    return StreamEventType.EDIT_STATUS;
  }

  return StreamEventType.WORKFLOW_STATUS;
}

function getMappedMessage(
  messages: StatusMessages | undefined,
  status: AppStreamEventStatus,
  fallback: string,
): string {
  return messages?.[status] ?? fallback;
}

export function buildAppStreamEvent(chunk: unknown): AppStreamEvent | null {
  const chunkType = getStreamChunkType(chunk);

  switch (chunkType) {
    case 'workflow-execution-start':
    case 'workflow-start':
      return buildAppStatusEvent({
        type: StreamEventType.WORKFLOW_STATUS,
        status: 'started',
        message: 'Started preparing changes.',
        step: 'workflow',
      });
    case 'workflow-execution-suspended':
    case 'workflow-step-suspended':
      return null;
    case 'workflow-execution-abort':
    case 'workflow-canceled':
    case 'abort':
      return buildAppStatusEvent({
        type: StreamEventType.ERROR,
        status: 'failed',
        message: 'The workflow was interrupted.',
        step: 'workflow',
      });
    case 'workflow-finish': {
      const status = getWorkflowFinishStatus(chunk);

      if (status === 'failed') {
        return buildAppStatusEvent({
          type: StreamEventType.ERROR,
          status: 'failed',
          message: 'Something went wrong.',
          step: 'workflow',
        });
      }

      return buildAppStatusEvent({
        type: StreamEventType.COMPLETED,
        status: 'completed',
        message: 'Workflow completed.',
        step: 'workflow',
      });
    }
    case 'workflow-step-start': {
      const stepId = getWorkflowStepId(chunk);

      return buildAppStatusEvent({
        type: getStepEventType(stepId),
        status: 'started',
        message: getMappedMessage(
          WORKFLOW_STEP_STATUS_MESSAGES[stepId ?? ''],
          'started',
          'Started a workflow step.',
        ),
        step: stepId,
      });
    }
    case 'workflow-step-finish':
    case 'workflow-step-result': {
      const stepId = getWorkflowStepId(chunk);

      return buildAppStatusEvent({
        type: getStepEventType(stepId),
        status: 'completed',
        message: getMappedMessage(
          WORKFLOW_STEP_STATUS_MESSAGES[stepId ?? ''],
          'completed',
          'Completed a workflow step.',
        ),
        step: stepId,
      });
    }
    case 'tool-call':
    case 'tool-execution-start': {
      const toolName = getToolName(chunk);

      return buildAppStatusEvent({
        type: StreamEventType.TOOL_STATUS,
        status: 'started',
        message: getMappedMessage(
          TOOL_STATUS_MESSAGES[toolName ?? ''],
          'started',
          'Started a tool action.',
        ),
        toolName,
      });
    }
    case 'tool-result':
    case 'tool-execution-end':
    case 'tool-output': {
      const toolName = getToolName(chunk);

      return buildAppStatusEvent({
        type: StreamEventType.TOOL_STATUS,
        status: 'completed',
        message: getMappedMessage(
          TOOL_STATUS_MESSAGES[toolName ?? ''],
          'completed',
          'Completed a tool action.',
        ),
        toolName,
      });
    }
    case 'tool-error':
    case 'error':
    case 'tripwire':
      return buildAppStatusEvent({
        type: StreamEventType.ERROR,
        status: 'failed',
        message: 'Something went wrong.',
      });
    case 'is-task-complete':
      return buildAppStatusEvent({
        type: StreamEventType.VERIFICATION_STATUS,
        status: 'running',
        message: 'Checking whether the edit satisfies the request.',
        step: 'verification',
      });
    default:
      return null;
  }
}

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
