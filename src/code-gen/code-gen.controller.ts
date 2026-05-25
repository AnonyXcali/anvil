import { Controller, Get, Param, Post, Body, HttpCode } from '@nestjs/common';
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
    @Body() body: { message: string; project_name: string },
  ): Promise<{
    jobId: string | undefined;
    status: string;
  }> {
    return await this.codeGenService.enqueue(body.message, body.project_name);
  }

  //pass the project
  @Post('edit')
  @HttpCode(202)
  async edit(@Body() body: { project_id: string; message: string }) {
    return this.codeGenService.editEnqueue(body.project_id, body.message);
  }
}
