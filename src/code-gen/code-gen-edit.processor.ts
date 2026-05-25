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
@Processor('edit-code-execution', {
  concurrency: 1,
})
export class CodeGenEditProcessor extends WorkerHost {
  constructor(
    private readonly sshService: SshService,
    private readonly llmService: LlmService,
    private readonly dbService: DbService,
  ) {
    super();
  }

  async process(job: Job<TaskJobData>) {
    await job.updateProgress(25);

    console.log(`Processing Edit job ${job.id}`);
    console.log(`Message: ${job.data.message}`);

    await this.dbService.query(
      `
      UPDATE preview_platform.project_build
      SET job_id = $1,
          updated_at = now(),
          status = 'building'
      WHERE id = $2
  `,
      [String(job.id), job.data.buildId],
    );

    const { port, buildId } = job.data || {};

    //get existing code
    const existingCode = await this.dbService.query<{ content: string }>(
      `
    SELECT content FROM preview_platform.project_file WHERE project_id = $1
    `,
      [job.data.projectId],
    );

    if (!existingCode) {
      //TODO: should emit event for a init phase.
      throw new Error('No existing code exists');
    }

    const rawCode = await this.llmService.generateNewEdit(
      job.data.message,
      existingCode.rows[0].content,
    );

    if (!rawCode) {
      throw new Error('Job failed, no code recieved');
    }

    //update existing row where project_id exists
    await this.dbService.query<{ content: string }>(
      `
      UPDATE preview_platform.project_file
      SET content = $1
      WHERE project_id = $2
      RETURNING content;
    `,
      [rawCode, job.data.projectId],
    );

    /**
     * buildId: string,
     imageName: string,
     containerName: string,
     port: number,
     */
    const imageName = `preview-${job.data.projectId}-${job.data.buildId}`;
    const containerName = `preview-${job.data.projectId}`;

    const extractCode = extractCode_v2(rawCode);
    const logs = await this.sshService.updateFile(
      extractCode,
      buildId,
      imageName,
      containerName,
      port,
    );

    await job.updateProgress(75);
    const result = JSON.stringify(logs);
    await job.updateProgress(100);

    //success
    await this.dbService.query(
      `
          UPDATE preview_platform.project_build
          SET status = 'running',
              preview_url = $1,
              container_name = $2,
              image_name = $3,
              logs = $4,
              completed_at = now(),
              updated_at = now()
          WHERE id = $5;
  `,
      // TODO(security): Do not expose previews through direct unauthenticated HTTP URLs.
      // Route them through an authenticated HTTPS proxy or enforce network allowlists.
      [
        `http://${process.env.SSH_HOST}:${job.data.port}/`,
        `preview-${job.data.projectId}`,
        `preview-${job.data.projectId}-${job.data.buildId}`,
        result,
        job.data.buildId,
      ],
    );

    return result;
  }
}
