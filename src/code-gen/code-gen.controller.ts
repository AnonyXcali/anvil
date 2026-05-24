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
    @Body() body: { type: string; message: string; project_name: string },
  ): Promise<{
    jobId: string | undefined;
    status: string;
  }> {
    return await this.codeGenService.enqueue(
      body.type,
      body.message,
      body.project_name,
    );
  }
}
