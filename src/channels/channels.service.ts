import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import {
  ChannelsInterface,
  type ChannelChunkMetadata,
} from './channels.interface';
import { REDIS } from 'src/tokens';

const ERROR_MSG = 'Channel ID is not present or undefined';

// TODO: Replace these temporary debug log maps with configurable stream logging after edit workflow debugging.
const STREAM_LOGGABLE_STEPS = {
  'anvil-agent-workflow-search-step': false,
  'anvil-agent-workflow-plan-step': false,
  'anvil-agent-workflow-edit-input-compression': false,
  'anvil-agent-workflow-edit-step': true,
  'anvil-edit-agent-nested-workflow-download-file-step': true,
  'anvil-edit-agent-nested-workflow-backup-original-file-step': true,
  'anvil-edit-agent-nested-workflow-apply-edit-file-step': true,
  'anvil-edit-agent-nested-workflow-verify-edit-file-step': true,
  'anvil-edit-agent-nested-workflow-upload-edit-file-step': true,
  'anvil-edit-agent-nested-workflow-delete-temp-file-step': true,
} as const;

const STREAM_LOGGABLE_TOOLS = {
  run_edit_workflow: false,
  read_file: false,
  create_file: false,
  create_folder: false,
  verify_file_existing: false,
  verify_folder_existing: false,
  delete_file: false,
  delete_folder: false,
  edit_file: true,
  replace_file: true,
} as const;

const STREAM_LOGGABLE_TYPES = {
  edit_progress: true,
  edit_agent_diagnostics: true,
  edit_download_diagnostics: true,
  edit_verification_started: true,
  edit_verification_iteration: true,
  edit_verification_scorer: true,
  edit_verification_completed: true,
  edit_verification_failed: true,
  css_validation: true,
  history_read_warning: true,
  history_write_warning: true,
  edit_workflow_invocation_failure: true,
  error: true,
  'workflow-finish': true,
} as const;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function parseJsonRecord(value: string): UnknownRecord | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getNestedRecord(
  record: UnknownRecord,
  path: string[],
): UnknownRecord | null {
  let current: unknown = record;

  for (const key of path) {
    if (!isRecord(current)) {
      return null;
    }

    current = current[key];
  }

  return isRecord(current) ? current : null;
}

function getNestedString(record: UnknownRecord, path: string[]): string | null {
  let current: unknown = record;

  for (const key of path) {
    if (!isRecord(current)) {
      return null;
    }

    current = current[key];
  }

  return typeof current === 'string' ? current : null;
}

function isLoggableMapValue<T extends Record<string, boolean>>(
  map: T,
  key: string | null,
): boolean {
  return key !== null && map[key as keyof T] === true;
}

function getStreamChunk(message: string): UnknownRecord | null {
  const outer = parseJsonRecord(message);

  if (!outer) {
    return null;
  }

  const chunk = outer.chunk;

  if (typeof chunk === 'string') {
    return parseJsonRecord(chunk);
  }

  return isRecord(chunk) ? chunk : outer;
}

function shouldLogStreamMessage(message: string): boolean {
  const chunk = getStreamChunk(message);

  if (!chunk) {
    return true;
  }

  const raw = getNestedRecord(chunk, ['raw']);
  const payload = getNestedRecord(chunk, ['payload']);
  const rawPayload = raw ? getNestedRecord(raw, ['payload']) : null;
  const type =
    getNestedString(chunk, ['type']) ?? (raw && getNestedString(raw, ['type']));
  const step =
    (rawPayload && getNestedString(rawPayload, ['stepName'])) ??
    (rawPayload && getNestedString(rawPayload, ['id'])) ??
    (rawPayload && getNestedString(rawPayload, ['step'])) ??
    (payload && getNestedString(payload, ['step']));
  const tool =
    (rawPayload && getNestedString(rawPayload, ['toolName'])) ??
    (payload && getNestedString(payload, ['toolName']));

  return (
    isLoggableMapValue(STREAM_LOGGABLE_TYPES, type) ||
    isLoggableMapValue(STREAM_LOGGABLE_STEPS, step) ||
    isLoggableMapValue(STREAM_LOGGABLE_TOOLS, tool)
  );
}

@Injectable()
export class ChannelsService implements ChannelsInterface {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async subscribe(
    channelId: string,
    listener: (message: string) => void,
  ): Promise<() => Promise<void>> {
    if (!channelId) {
      this.throwErrorMessageForMissingChannelID();
    }
    //Question to self: Why did we duplicate?
    const subscriber = this.redis.duplicate();

    subscriber.on('message', (channel, message) => {
      if (channel === channelId) {
        if (shouldLogStreamMessage(message)) {
          this.logger.log(message);
        }

        listener(message);
      }
    });

    await subscriber.subscribe(channelId);

    return async () => {
      await subscriber.unsubscribe();
    };
  }

  async publish(channelId: string, message: string): Promise<void> {
    if (!channelId) {
      this.throwErrorMessageForMissingChannelID();
    }
    await this.redis.publish(channelId, message);
  }

  async publishAndStoreChunk(
    chunk: string,
    seqKey: string,
    listKey: string,
    metaKey: string,
    channelKey: string,
    metadata?: ChannelChunkMetadata,
  ) {
    const seq = await this.redis.incr(seqKey); //this could still fail

    const payload = {
      seq,
      chunk,
      ...metadata,
      createdAt: new Date().toISOString(),
    };

    await this.redis
      .multi()
      .rpush(listKey, JSON.stringify(payload))
      .hset(metaKey, {
        lastSeq: seq,
        updatedAt: payload.createdAt,
      })
      .expire(listKey, 600)
      .expire(seqKey, 600)
      .expire(metaKey, 600)
      .publish(
        channelKey,
        JSON.stringify({
          seq,
          chunk,
          ...metadata,
        }),
      )

      .exec();
  }

  private throwErrorMessageForMissingChannelID() {
    this.logger.error(ERROR_MSG);
    throw new Error(ERROR_MSG);
  }
}
