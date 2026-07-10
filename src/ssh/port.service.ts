import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from 'src/tokens';

@Injectable()
export class PortService implements OnModuleInit {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleInit() {
    const exists = await this.redis.exists('available_ports');
    if (!exists) {
      const ports = Array.from({ length: 1000 }, (_, i) => 31000 + i);
      await this.redis.rpush('available_ports', ...ports);
    }
  }

  async acquirePort(): Promise<number> {
    // TODO(security): Track port leases by build/container owner and clean them up on failures
    // so stale previews do not remain exposed and ports cannot be double-assigned.
    const port = await this.redis.lpop('available_ports');
    if (!port) throw new Error('No ports available');
    return parseInt(port);
  }

  async releasePort(port: number): Promise<void> {
    // TODO(security): Make release idempotent and ownership-aware before returning ports
    // to the shared pool to prevent duplicate allocations and cross-project routing.
    try {
      await this.redis.rpush('available_ports', port);
    } catch (e: unknown) {
      if (e instanceof Error) {
        throw new Error(e.message);
      }
    }
  }
}
