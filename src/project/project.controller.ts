import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { ProjectService } from './project.service';

@Controller('project')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get()
  async getAllProjects(@Session() session: UserSession) {
    return await this.projectService.findAll(session.user.id);
  }

  @Get('/:projectId')
  async getProjectById(
    @Param() params: { projectId: string },
    @Session() session: UserSession,
  ) {
    const userId = session.user.id;
    const projectId = params.projectId;
    return await this.projectService.findById(userId, projectId);
  }

  @Post()
  async createProject(
    @Body() body: { description: string },
    @Session() session: UserSession,
  ) {
    return await this.projectService.insert(body.description, session.user.id);
  }

  @Delete('/:projectId')
  async deleteProject(
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Session() session: UserSession,
  ) {
    return this.projectService.delete(projectId, session.user.id);
  }

  @Patch('/:projectId')
  async patchProject(
    @Body() body: { name?: string },
    @Param('projectId', new ParseUUIDPipe()) projectId: string,
    @Session() session: UserSession,
  ) {
    return this.projectService.update(projectId, body, session.user.id);
  }

  //TODO: need to solve common queue id problem
  @Post('/stop')
  async stopProject(
    @Body() body: { projectId: string },
    @Session() session: UserSession,
  ) {
    return await this.projectService.stop(body.projectId, session.user.id);
  }

  //TODO: need to solve common queue id problem
  @Post('/start')
  async startProject(
    @Body() body: { projectId: string },
    @Session() session: UserSession,
  ) {
    return await this.projectService.start(body.projectId, session.user.id);
  }

  //TODO: need to solve common queue id problem
  @Get('/:projectId/job/:jobId')
  async getJobStatus(
    @Param('projectId') projectId: string,
    @Param('jobId') jobId: string,
  ) {
    return await this.projectService.jobStatus(projectId, jobId);
  }
}
