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
  ): Promise<void>;
}

export const CHANNELS_REDIS = 'CHANNELS_REDIS';
