export interface Storage {
  storeChunk(chunk: string, key: string): Promise<void>;
}
