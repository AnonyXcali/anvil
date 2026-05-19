import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

@Injectable()
export class CodeGenService {
  constructor(
    @InjectQueue('code-execution')
    private readonly queue: Queue<{ message: string }>,
  ) {}

  async enqueue(message: string) {
    const job = await this.queue.add(
      'run-code',
      {
        message,
      },
      {
        attempts: 1,
        removeOnComplete: {
          age: 60 * 60,
          count: 100,
        },
        removeOnFail: {
          age: 24 * 60 * 60,
          count: 100,
        },
      },
    );

    return {
      jobId: job.id,
      status: 'queued',
    };
  }

  async getJob(id: string) {
    return await this.queue.getJob(id);
  }
}
