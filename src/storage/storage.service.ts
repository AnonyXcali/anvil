import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from 'src/tokens';
import { Storage } from './storage.interface';

@Injectable()
export class StorageService implements Storage {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async storeChunk(chunk: string, key: string): Promise<void> {
    //await this.redis.set(key, JSON.stringify(chunk), 'EX', 600);
  }

  // async getChunks(conversationId: string, jobId: string) {
  //   const listKey = `conversation:${conversationId}:job:${jobId}:chunks`;

  //   const chunks = await this.redis.lrange(listKey, 0, -1);

  //   return chunks.map((chunk) => JSON.parse(chunk));
  // }
  //

  // async getFinalText(conversationId: string, jobId: string) {
  //   const chunks = await this.getChunks(conversationId, jobId);

  //   return chunks
  //     .sort((a, b) => a.seq - b.seq)
  //     .map((chunk) => chunk.content)
  //     .join('');
  // }
}
