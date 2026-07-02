import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ChannelsInterface } from './channels.interface';
import { REDIS } from 'src/tokens';

const ERROR_MSG = 'Channel ID is not present or undefined';

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
    const subscriber = this.redis.duplicate();

    subscriber.on('message', (channel, message) => {
      if (channel === channelId) {
        this.logger.log(message);
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
  ) {
    const seq = await this.redis.incr(seqKey); //this could still fail

    const payload = {
      seq,
      chunk,
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
        }),
      )

      .exec();
  }

  private throwErrorMessageForMissingChannelID() {
    this.logger.error(ERROR_MSG);
    throw new Error(ERROR_MSG);
  }
}
