import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DbService } from '../db/db.service';
import { LlmService } from '../llm/llm.service';
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
      type: string;
      projectId: string;
      buildId: string;
      port: number;
    }>,
    private readonly dbService: DbService,
    private readonly llmService: LlmService,
    private readonly portService: PortService,
  ) {}

  async enqueue(type: string, message: string, projectName: string) {
    //call db service here to create a project
    const db = await this.dbService.query<{ id: string }>(
      `
        INSERT INTO preview_platform.project(name, status)
        VALUES ($1, 'active')
        RETURNING id;
    `,
      [projectName],
    );
    //generate app.tsx file here
    const rawCode = await this.llmService.chat(message, type);

    //store the generated App.tsx in the db
    await this.dbService.query<{ content: string }>(
      `
      INSERT INTO preview_platform.project_file(project_id, path, content)
      VALUES ($1, $2, $3)
      RETURNING content;
    `,
      [db.rows[0].id, 'src/App.tsx', rawCode],
    );

    //DB: build row create
    const buildRow = await this.dbService.query<{ id: string }>(
      `
      INSERT INTO preview_platform.project_build(project_id, status, started_at)
      VALUES ($1, $2, $3)
      RETURNING id;
    `,
      [db.rows[0].id, 'queued', new Date()],
    );

    //acquire port
    const port = await this.portService.acquirePort();

    //add to the queue
    const job = await this.queue.add(
      'run-code',
      {
        message,
        type,
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

  async getJob(id: string) {
    return await this.queue.getJob(id);
  }
}
