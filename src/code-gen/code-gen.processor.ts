import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

type TaskJobData = {
  message: string;
};

@Processor('code-execution', {
  concurrency: 1,
})
export class CodeGenProcessor extends WorkerHost {
  async process(job: Job<TaskJobData>) {
    console.log(`Processing job ${job.id}`);
    console.log(`Message: ${job.data.message}`);
    await job.updateProgress(25);
    await this.sleep(1000);
    await job.updateProgress(75);
    const result = job.data.message.toUpperCase();
    await this.sleep(1000);
    await job.updateProgress(100);
    return {
      original: job.data.message,
      processed: result,
      processedAt: new Date().toISOString(),
    };
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}