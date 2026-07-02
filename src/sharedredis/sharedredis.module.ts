import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from 'src/tokens';

@Module({
  providers: [
    {
      provide: REDIS,
      useValue: new Redis({
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT ?? 6379),
        db: 1,
      }),
    },
  ],
  exports: [REDIS],
})
export class SharedredisModule {}
