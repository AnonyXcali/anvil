import { Controller, Get, Param, Post, Body, HttpCode } from '@nestjs/common';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import { CodeGenService } from './code-gen.service';

//TODO: p0-dev-user-01 is an unsecure user.
@Controller('code-gen')
export class CodeGenController {
  constructor(private readonly codeGenService: CodeGenService) {}

  @Get(':jobId')
  getJobById(@Param('jobId') jobId: string) {
    return `Get job ${jobId}`;
  }

  //TODO: provide better typing
  @Post()
  @HttpCode(202)
  async generate(
    @Body() body: { description: string },
    @Session() session: UserSession,
  ): Promise<{
    jobId: string;
    projectId: string;
    conversationId: string;
    status: string;
  }> {
    return await this.codeGenService.enqueue(body.description, session.user.id);
  }

  //pass the project
  @Post('edit')
  @HttpCode(202)
  async edit(@Body() body: { project_id: string; message: string }) {
    return this.codeGenService.editEnqueue(body.project_id, body.message);
  }
}
