import { Injectable, Inject, Logger } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from 'src/tokens';
import type { DB } from 'src/db/db.types';
import { PortService } from 'src/ssh/port.service';
import { CodeGenService } from 'src/code-gen/code-gen.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JobService } from 'src/job/job.service';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    @InjectQueue('stop-project-queue')
    private readonly stopProjectQueue: Queue<{
      project_id: string;
      container_name: string;
      port: number;
    }>,
    @InjectQueue('start-project-queue')
    private readonly startProjectQueue: Queue<{
      project_id: string;
      container_name: string;
    }>,
    @Inject(KYSELY_DB) private readonly db: Kysely<DB>,
    private readonly portService: PortService,
    private readonly codeGenService: CodeGenService,
    private readonly jobService: JobService,
  ) {}

  async findAll(userId: string) {
    return await this.db
      .selectFrom('preview_platform.project')
      .select(['id', 'active_port', 'name', 'status'])
      .where('user_id', '=', userId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  async findById(userId: string, projectId: string) {
    return await this.db
      .selectFrom('preview_platform.project')
      .select(['id', 'active_port', 'name', 'status'])
      .where('user_id', '=', userId)
      .where('id', '=', projectId)
      .executeTakeFirstOrThrow();
  }

  async insert(name: string, userId: string) {
    const port = await this.portService.acquirePort();
    const { id: projectId } = await this.db
      .insertInto('preview_platform.project')
      .values({
        name,
        user_id: userId,
        template: 'react',
        active_port: port,
        status: 'processing',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (!projectId) {
      this.logger.error('Error retrieving project id');
      throw new Error('Error retrieving project id');
    }

    const { id: conversationId } = await this.db
      .insertInto('preview_platform.conversation')
      .values({
        user_id: userId,
        project_id: projectId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    if (!conversationId) {
      this.logger.error('Error retrieving conversation id');
      throw new Error('Error retrieving conversation id');
    }

    await this.codeGenService.enqueueJob(projectId, port, conversationId);

    return {
      projectId: projectId,
      conversationId: conversationId,
    };
  }

  async delete(projectId: string, userId: string) {
    const exists = await this.db
      .selectFrom('preview_platform.project')
      .select('id')
      .where('id', '=', projectId)
      .where('user_id', '=', userId)
      .where((eb) =>
        eb.or([eb('status', '=', 'active'), eb('status', '=', 'processing')]),
      )
      .limit(1)
      .executeTakeFirst();

    if (exists) {
      throw new Error(
        `The project ${projectId} is currently active or processing, stop it to delete it.`,
      );
    }

    const deleted = await this.db
      .deleteFrom('preview_platform.project')
      .where('id', '=', projectId)
      .where('user_id', '=', userId)
      .where('status', 'not in', ['active', 'processing'])
      .executeTakeFirstOrThrow();

    return Number(deleted.numDeletedRows);
  }

  async update(
    projectId: string,
    updateObject: { name?: string },
    userId: string,
  ) {
    if (!userId) {
      throw new Error('Missing dependencies user id');
    }

    if (!projectId) {
      throw new Error('Missing dependencies project id');
    }

    const patched = await this.db
      .updateTable('preview_platform.project')
      .where('id', '=', projectId)
      .where('user_id', '=', userId)
      .set({
        ...updateObject,
      })
      .executeTakeFirstOrThrow();

    return Number(patched.numUpdatedRows);
  }

  private async projectExists(projectId: string, userId: string) {
    return await this.db
      .selectFrom('preview_platform.project')
      .select(['id', 'active_port', 'container_name'])
      .where('id', '=', projectId)
      .where('user_id', '=', userId)
      .limit(1)
      .executeTakeFirst();
  }

  async stop(projectId: string, userId: string) {
    const exists = await this.projectExists(projectId, userId);

    if (!exists) {
      throw new Error('Cannot stop a non existing project');
    }

    const port = exists.active_port;
    const containerName = exists.container_name;

    if (!port) {
      throw new Error('Invalid port for the container');
    }

    if (!containerName) {
      throw new Error('Invalid name for the container');
    }

    const job = await this.stopProjectQueue.add(
      'stop-container',
      {
        project_id: projectId,
        container_name: containerName,
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
      throw new Error('Job id is not acquired');
    }

    await this.jobService.insertIntoProjectJobs(
      job.id + ':' + 'stop-container',
      projectId,
      'stop-container',
    );

    return {
      job_id: job.id,
    };
  }

  async start(projectId: string, userId: string) {
    //get the container name
    //check it exists
    //start it in the acquired port
    const exists = await this.projectExists(projectId, userId);

    if (!exists) {
      throw new Error('Cannot start a non existing project');
    }

    const containerName = exists.container_name;

    if (!containerName) {
      throw new Error('Invalid name for the container');
    }

    const startJob = await this.startProjectQueue.add(
      'stop-container',
      {
        project_id: projectId,
        container_name: containerName,
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

    //queue job for project processor
    //immediately return the job id and poll frontend for status.

    if (!startJob.id) {
      throw new Error('Job id is not acquired');
    }

    await this.jobService.insertIntoProjectJobs(
      startJob.id + ':' + 'start-container',
      projectId,
      'stop-container',
    );

    return {
      job_id: startJob.id,
    };
  }

  async jobStatus(projectId: string, jobId: string) {
    return await this.db
      .selectFrom('preview_platform.project_jobs')
      .select('state')
      .where('project_id', '=', projectId)
      .where('id', '=', jobId)
      .executeTakeFirstOrThrow();
  }
}
