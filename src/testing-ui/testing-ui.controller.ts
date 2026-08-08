import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Render,
  Res,
} from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';
import { TestingUiService } from './testing-ui.service';

@Controller('testing')
export class TestingUiController {
  constructor(private readonly testingUiService: TestingUiService) {}

  @Get('/auth')
  @AllowAnonymous()
  @Render('testing-ui/auth')
  auth() {
    return this.testingUiService.authModel();
  }

  @Get()
  @Render('testing-ui/dashboard')
  async dashboard(
    @Session() session: UserSession,
    @Query('projectId') projectId?: string,
  ) {
    this.testingUiService.assertEnabled();
    return this.testingUiService.dashboardModel(session.user.id, projectId);
  }

  @Post('/projects')
  async createProject(
    @Body() body: { description: string },
    @Session() session: UserSession,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.testingUiService.assertEnabled();
    const created = await this.testingUiService.createProject(
      body.description,
      session.user.id,
    );
    return response.redirect(
      `/testing/projects/${created.projectId}/conversations/${created.conversationId}`,
    );
  }

  @Get('/projects/:projectId/conversations/new')
  @Render('testing-ui/conversation-new')
  async newConversation(
    @Param('projectId') projectId: string,
    @Session() session: UserSession,
  ) {
    this.testingUiService.assertEnabled();
    return this.testingUiService.newConversationModel(
      session.user.id,
      projectId,
    );
  }

  @Post('/projects/:projectId/conversations')
  async startConversation(
    @Param('projectId') projectId: string,
    @Body() body: { query: string },
    @Session() session: UserSession,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.testingUiService.assertEnabled();
    const result = await this.testingUiService.startConversation(
      body.query,
      session.user.id,
      projectId,
    );
    return response.redirect(
      `/testing/projects/${projectId}/conversations/${result.conversation_id}`,
    );
  }

  @Get('/projects/:projectId/conversations/:conversationId')
  @Render('testing-ui/conversation')
  async conversation(
    @Param('projectId') projectId: string,
    @Param('conversationId') conversationId: string,
    @Session() session: UserSession,
  ) {
    this.testingUiService.assertEnabled();
    return this.testingUiService.conversationModel(
      session.user.id,
      projectId,
      conversationId,
    );
  }

  @Post('/projects/:projectId/conversations/:conversationId/messages')
  async sendMessage(
    @Param('projectId') projectId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: { query: string },
    @Session() session: UserSession,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.testingUiService.assertEnabled();
    await this.testingUiService.sendMessage(
      body.query,
      session.user.id,
      projectId,
      conversationId,
    );
    return response.redirect(
      `/testing/projects/${projectId}/conversations/${conversationId}`,
    );
  }

  @Post('/projects/:projectId/start')
  async startProject(
    @Param('projectId') projectId: string,
    @Session() session: UserSession,
  ) {
    this.testingUiService.assertEnabled();
    return this.testingUiService.startProject(projectId, session.user.id);
  }

  @Post('/projects/:projectId/stop')
  async stopProject(
    @Param('projectId') projectId: string,
    @Session() session: UserSession,
  ) {
    this.testingUiService.assertEnabled();
    return this.testingUiService.stopProject(projectId, session.user.id);
  }

  @Delete('/projects/:projectId')
  async deleteProject(
    @Param('projectId') projectId: string,
    @Session() session: UserSession,
  ) {
    this.testingUiService.assertEnabled();
    return this.testingUiService.deleteProject(projectId, session.user.id);
  }

  @Get('/projects/:projectId/jobs/:jobId')
  async jobStatus(
    @Param('projectId') projectId: string,
    @Param('jobId') jobId: string,
    @Session() session: UserSession,
  ) {
    this.testingUiService.assertEnabled();
    return this.testingUiService.jobStatus(projectId, jobId, session.user.id);
  }

  @Get('/projects/:projectId/conversations/:conversationId/sse-test')
  async sseTest(@Param('conversationId') conversationId: string) {
    this.testingUiService.assertEnabled();
    await this.testingUiService.triggerSseTest(conversationId);
    return { success: true };
  }
}
