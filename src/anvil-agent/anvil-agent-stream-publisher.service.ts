import { Injectable } from '@nestjs/common';
import { ChannelsService } from 'src/channels/channels.service';
import { generateKeys } from 'src/utils';
import {
  buildStreamEnvelope,
  isEmptyStreamChunk,
  type StreamEnvelopeSource,
} from './anvil-agent-streaming.helpers';

/**
 * Publishes one Mastra stream chunk through the Redis-backed stream contract.
 *
 * The publisher owns only infrastructure concerns: filtering empty chunks,
 * building the existing envelope, generating Redis keys, and delegating the
 * durable-store-plus-Pub/Sub write to ChannelsService. Workflow decisions and
 * application-event mapping remain in the calling orchestrator.
 */
@Injectable()
export class AnvilAgentStreamPublisher {
  constructor(private readonly channelService: ChannelsService) {}

  /**
   * Stores and publishes a raw or application stream event.
   *
   * The conversation channel and Redis key format remain unchanged. Returns
   * false when the chunk is an empty delta and therefore intentionally omitted.
   */
  async publish({
    chunk,
    conversationId,
    jobId,
    envelopeJobId,
    source,
    approvalRequestId,
    streamId,
  }: {
    chunk: unknown;
    conversationId: string;
    jobId: string;
    envelopeJobId?: string;
    source: StreamEnvelopeSource;
    approvalRequestId?: string;
    streamId?: string;
  }): Promise<boolean> {
    if (isEmptyStreamChunk(chunk)) {
      return false;
    }

    const { seqKey, listKey, metaKey, channelKey } = generateKeys(
      conversationId,
      jobId,
    );

    await this.channelService.publishAndStoreChunk(
      JSON.stringify(
        buildStreamEnvelope({
          chunk,
          conversationId,
          source,
          jobId: envelopeJobId,
          approvalRequestId,
        }),
      ),
      seqKey,
      listKey,
      metaKey,
      channelKey,
      streamId ? { streamId } : undefined,
    );

    return true;
  }
}
