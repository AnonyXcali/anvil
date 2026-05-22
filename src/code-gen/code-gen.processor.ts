import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SshService } from '../ssh/ssh.service';
import { LlmService } from '../llm/llm.service';
import { extractCode_v2 } from '../utils';

type TaskJobData = {
  message: string;
  type: string;
};

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
    const { type, message } = job.data;

    console.log(`Processing job ${job.id}`);
    console.log(`Message: ${message}`);

    switch (type) {
      case 'init':
        return {
          original: job.data.message,
          processed: await this.init(job, 'init'),
          processedAt: new Date().toISOString(),
        };
      case 'edit':
        return {
          original: job.data.message,
          processed: await this.update(job, 'edit'),
          processedAt: new Date().toISOString(),
        };
      default:
        throw new Error('unknown type');
    }
  }

  private async init(job: Job<TaskJobData>, type: string) {
    await job.updateProgress(25);

    const rawCode = await this.llmService.chat(job.data.message, type);

    if (!rawCode) {
      throw new Error('Job failed, no code recieved');
    }

    const extractCode = extractCode_v2(rawCode);

    await this.sshService.runPreviewBuild(extractCode);

    await job.updateProgress(75);
    const result = job.data.message.toUpperCase();
    await job.updateProgress(100);
    return result;
  }

  private async update(job: Job<TaskJobData>, type: string) {
    await job.updateProgress(25);

    //TODO: should come from backend storage
    const existingCode = await this.sshService.readFile();

    if (!existingCode) {
      await this.init(job, 'init');
      return;
    }

    const rawCode = await this.llmService.chat(
      job.data.message,
      type,
      existingCode,
    );

    if (!rawCode) {
      throw new Error('Job failed, no code recieved');
    }

    const extractCode = extractCode_v2(rawCode);
    await this.sshService.updateFile(extractCode);

    await job.updateProgress(75);
    const result = job.data.message.toUpperCase();
    await job.updateProgress(100);
    return result;
  }
}
