import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SshService } from '../ssh/ssh.service';
import { LlmService } from '../llm/llm.service';
import { extractCode_v2 } from '../utils';
import { DbService } from '../db/db.service';

type TaskJobData = {
  message: string;
  projectId: string;
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
    const { message } = job.data;

    console.log(`Processing job ${job.id}`);
    console.log(`Message: ${message}`);

    await this.dbService.query(
      `
        UPDATE preview_platform.project
        SET updated_at = now(),
            status = 'building'
        WHERE id = $1
    `,
      [job.data.projectId],
    );

    return {
      original: job.data.message,
      processed: await this.init(job),
      processedAt: new Date().toISOString(),
    };
  }

  private async init(job: Job<TaskJobData>) {
    await job.updateProgress(25);

    //generate code
    const rawCode = await this.llmService.chat(job.data.message);

    if (!rawCode) {
      await this.dbService.query(
        `
          UPDATE preview_platform.project
          SET updated_at = now(),
              status = 'errored'
          WHERE id = $1
      `,
        [job.data.projectId],
      );
      throw new Error('Job failed, no code received');
    }

    //store code
    await this.dbService.query<{ content: string }>(
      `
      INSERT INTO preview_platform.project_file(project_id, path, content)
      VALUES ($1, $2, $3)
      RETURNING content;
    `,
      [job.data.projectId, 'src/App.tsx', rawCode],
    );

    const extractedCode = extractCode_v2(rawCode);

    const runLogs = await this.sshService.runnerBuild(
      job.data.port,
      extractedCode,
      `preview-dev-${job.data.projectId}`,
      `preview-${job.data.projectId}`,
      job.data.projectId,
    );

    await job.updateProgress(75);
    const result = JSON.stringify(runLogs);
    await job.updateProgress(100);

    //success
    //   await this.dbService.query(
    //     `
    //         UPDATE preview_platform.project_build
    //         SET status = 'running',
    //             artifact_url = $1,
    //             container_name = $2,
    //             image_name = $3,
    //             logs = $4,
    //             completed_at = now(),
    //             updated_at = now()
    //         WHERE id = $5;
    // `,
    //     // TODO(security): Do not expose previews through direct unauthenticated HTTP URLs.
    //     // Route them through an authenticated HTTPS proxy or enforce network allowlists.
    //     [
    //       `http://${process.env.SSH_HOST}:${job.data.port}/`,
    //       `preview-${job.data.projectId}`,
    //       `preview-${job.data.projectId}-${job.data.buildId}`,
    //       result,
    //       job.data.buildId,
    //     ],
    //   );
    //

    await this.dbService.query(
      `
      UPDATE preview_platform.project
      SET preview_url = $1,
          status = $2,
          updated_at = now()
      WHERE id = $3
      `,
      [
        `http://${process.env.SSH_HOST}:${job.data.port}/`,
        'preview',
        job.data.projectId,
      ],
    );
    return result;
  }
}
