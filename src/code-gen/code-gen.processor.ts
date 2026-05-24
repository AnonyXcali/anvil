import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SshService } from '../ssh/ssh.service';
import { LlmService } from '../llm/llm.service';
import { extractCode_v2 } from '../utils';
import { DbService } from '../db/db.service';

type TaskJobData = {
  message: string;
  type: string;
  projectId: string;
  buildId: string;
  port: number;
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
    private readonly dbService: DbService,
  ) {
    super();
  }

  async process(job: Job<TaskJobData>) {
    const { type, message, projectId, buildId } = job.data;

    console.log(`Processing job ${job.id}`);
    console.log(`Message: ${message}`);

    await this.dbService.query(
      `
      UPDATE preview_platform.project_build
      SET job_id = $1,
          updated_at = now(),
          status = 'building'
      WHERE id = $2
  `,
      [String(job.id), buildId],
    );

    switch (type) {
      case 'init':
        return {
          original: job.data.message,
          processed: await this.init(job),
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

  private async init(job: Job<TaskJobData>) {
    await job.updateProgress(25);

    const dbResponse = await this.dbService.query<{ content: string }>(
      `
    SELECT content FROM preview_platform.project_file WHERE project_id = $1;
    `,
      [job.data.projectId],
    );

    const rawCode = dbResponse.rows[0].content;

    if (!rawCode) {
      await this.dbService.query(
        `
            UPDATE preview_platform.project_build
            SET status = 'failed',
                error = $1,
                logs = $2,
                completed_at = now(),
                updated_at = now()
            WHERE id = $3;
  `,
        ['TBA', [], job.data.buildId],
      );
      throw new Error('Job failed, no code received');
    }

    const extractCode = extractCode_v2(rawCode);

    const runLogs = await this.sshService.runPreviewBuild(
      extractCode,
      job.data.buildId,
      `preview-${job.data.buildId}`,
      `preview-${job.data.buildId}`,
      job.data.port,
    );

    await job.updateProgress(75);
    const result = JSON.stringify(runLogs);
    await job.updateProgress(100);

    //success
    await this.dbService.query(
      `
          UPDATE preview_platform.project_build
          SET status = 'running',
              preview_url = $1,
              container_name = $2,
              image_name = $2,
              logs = $3,
              completed_at = now(),
              updated_at = now()
          WHERE id = $4;
  `,
      // TODO(security): Do not expose previews through direct unauthenticated HTTP URLs.
      // Route them through an authenticated HTTPS proxy or enforce network allowlists.
      [
        `http://${process.env.SSH_HOST}:${job.data.port}/`,
        `preview-${job.data.buildId}`,
        result,
        job.data.buildId,
      ],
    );
    return result;
  }

  private async update(job: Job<TaskJobData>, type: string) {
    await job.updateProgress(25);

    //TODO: should come from backend storage
    const existingCode = await this.dbService.query<{ content: string }>(
      `
    SELECT content FROM preview_platform.project_file WHERE project_id = $1 
    `,
      [job.data.projectId],
    );

    if (!existingCode) {
      await this.init(job);
      return;
    }

    const rawCode = await this.llmService.chat(
      job.data.message,
      type,
      existingCode.rows[0].content,
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
