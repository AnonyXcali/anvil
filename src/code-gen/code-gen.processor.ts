import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SshService } from '../ssh/ssh.service';
import { LlmService } from '../llm/llm.service';
import { extractCode_v2 } from '../utils';

type TaskJobData = {
  message: string;
};

/**
 * 1. The worker receives the task.
 * 2. The worker than performs a SSH connection to the remote server
 * 3. The server already has the image in it.
 */

//TODO: see below
/**
 * Cloudflare / Traefik
 *   -> only expose 80/443
 *   -> route preview domains to containers
 */

@Processor('code-execution', {
  concurrency: 1,
})
export class CodeGenProcessor extends WorkerHost {
  constructor(
    private readonly sshService: SshService,
    private readonly llmService: LlmService,
  ) {
    super();
  }

  async process(job: Job<TaskJobData>) {
    console.log(`Processing job ${job.id}`);
    console.log(`Message: ${job.data.message}`);
    await job.updateProgress(25);
    const rawCode = await this.llmService.chat(job.data.message);

    if (!rawCode) {
      throw new Error('Job failed, no code recieved');
    }

    const extractCode = extractCode_v2(rawCode);
    await this.sshService.runPreviewBuild(extractCode);
    await job.updateProgress(75);
    const result = job.data.message.toUpperCase();
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
