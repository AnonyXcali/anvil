import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { PORT_REDIS } from './port.constants';
import { PortService } from './port.service';

@Module({
  providers: [
    {
      provide: PORT_REDIS,
      useValue: new Redis({
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT ?? 6379),
        db: 1,
      }),
    },
    PortService,
  ],
  exports: [PORT_REDIS, PortService],
})
export class PortModule {}
