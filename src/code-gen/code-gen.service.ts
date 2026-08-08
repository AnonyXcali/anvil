import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DbService } from '../db/db.service';
import { PortService } from '../ssh/port.service';
import { KYSELY_DB } from 'src/tokens';
import { Kysely } from 'kysely';
import { DB } from 'src/db/db.types';
import { JobService } from 'src/job/job.service';

@Injectable()
export class CodeGenService {
  constructor(
    @InjectQueue('code-execution')
    private readonly queue: Queue<{
      conversationId: string;
      projectId: string;
      port: number;
    }>,
    @InjectQueue('edit-code-execution')
    private readonly editQueue: Queue<{
      port: number;
      projectId: string;
      message: string;
    }>,
    private readonly dbService: DbService,
    private readonly portService: PortService,
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    private readonly jobService: JobService,
  ) {}

  async enqueueJob(projectId: string, port: number, conversationId: string) {
    const job = await this.queue.add(
      'scaffold-project',
      {
        conversationId,
        projectId,
        port,
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

    if (!job.id) {
      throw new Error('No Job ID Found for updating');
    }

    const jobId = job.id + ':' + 'scaffold-project';

    await this.jobService.insert(jobId, conversationId, 'scaffold-project');

    return String(job.id);
  }

  async enqueue(description: string, userId: string) {
    const port = await this.portService.acquirePort();

    const { id: projectId } = await this.db
      .insertInto('preview_platform.project')
      .values({
        name: 'anvil-project-pending',
        description,
        user_id: userId,
        template: 'react',
        active_port: port,
        status: 'processing',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const { id: conversationId } = await this.db
      .insertInto('preview_platform.conversation')
      .values({ user_id: userId, project_id: projectId })
      .returning('id')
      .executeTakeFirstOrThrow();

    await this.db
      .insertInto('preview_platform.message')
      .values({
        message: description,
        role: 'user',
        conversation_id: conversationId,
      })
      .execute();

    const jobId = await this.enqueueJob(projectId, port, conversationId);

    return {
      jobId,
      projectId,
      conversationId,
      status: 'queued',
    };
  }

  async editEnqueue(projectId: string, message: string) {
    //pre worker tasks
    //get the port
    const port = await this.dbService.query<{ active_port: number }>(
      `
      SELECT active_port
      FROM preview_platform.project
      WHERE id = $1
      `,
      [projectId],
    );

    const activePort = port.rows[0]?.active_port;

    if (!activePort) {
      throw new Error(`Project ${projectId} does not have an active port`);
    }

    //DB: build row create
    // const buildRow = await this.dbService.query<{ id: string }>(
    //   `
    //   INSERT INTO preview_platform.project_build(project_id, status, host_port, started_at)
    //   VALUES ($1, $2, $3, $4)
    //   RETURNING id;
    // `,
    //   [projectId, 'queued', activePort, new Date()],
    // );

    const job = await this.editQueue.add(
      'edit-code',
      {
        port: port.rows[0].active_port,
        projectId,
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
    //on worker tasks
  }

  async getJob(id: string) {
    return await this.queue.getJob(id);
  }
}
