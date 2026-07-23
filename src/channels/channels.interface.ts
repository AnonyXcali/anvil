export interface ChannelsInterface {
  publish(channelId: string, message: string): Promise<void>;
  subscribe(
    channelId: string,
    listener: (message: string) => void,
  ): Promise<() => Promise<void>>;
  publishAndStoreChunk(
    chunk: string,
    seqKey: string,
    listKey: string,
    metaKey: string,
    channelKey: string,
    metadata?: ChannelChunkMetadata,
  ): Promise<void>;
}

export type ChannelChunkMetadata = {
  streamId?: string;
};

export const CHANNELS_REDIS = 'CHANNELS_REDIS';
