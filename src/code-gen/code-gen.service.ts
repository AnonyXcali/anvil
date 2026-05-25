import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DbService } from '../db/db.service';
import { PortService } from '../ssh/port.service';

/**
 * Controller
 *   -> CodeGenService
 *     -> create project row
 *     -> create message row
 *     -> call LLM
 *     -> store App.tsx in DB
 *     -> create project_build row
 *     -> enqueue BullMQ job
 *
 * Worker
 *   -> load App.tsx from DB
 *   -> scaffold files
 *   -> SSH to VM
 *   -> build Docker image
 *   -> run container
 *   -> update project_build
 */

@Injectable()
export class CodeGenService {
  constructor(
    @InjectQueue('code-execution')
    private readonly queue: Queue<{
      message: string;
      projectId: string;
      buildId: string;
      port: number;
    }>,
    @InjectQueue('edit-code-execution')
    private readonly editQueue: Queue<{
      port: number;
      buildId: string;
      projectId: string;
      message: string;
    }>,
    private readonly dbService: DbService,
    private readonly portService: PortService,
  ) {}

  async enqueue(message: string, projectName: string) {
    //acquire port
    const port = await this.portService.acquirePort();

    //call db service here to create a project
    const db = await this.dbService.query<{ id: string }>(
      `
        INSERT INTO preview_platform.project(name, status, active_port)
        VALUES ($1, 'active', $2)
        RETURNING id;
    `,
      [projectName, port],
    );

    //DB: build row create
    const buildRow = await this.dbService.query<{ id: string }>(
      `
      INSERT INTO preview_platform.project_build(project_id, status, host_port, started_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id;
    `,
      [db.rows[0].id, 'queued', port, new Date()],
    );

    //add to the queue
    const job = await this.queue.add(
      'run-code',
      {
        message,
        projectId: db.rows[0].id,
        buildId: buildRow.rows[0].id,
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

    return {
      jobId: job.id,
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
    const buildRow = await this.dbService.query<{ id: string }>(
      `
      INSERT INTO preview_platform.project_build(project_id, status, host_port, started_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id;
    `,
      [projectId, 'queued', activePort, new Date()],
    );

    const job = await this.editQueue.add(
      'run-code',
      {
        port: port.rows[0].active_port,
        buildId: buildRow.rows[0].id,
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
