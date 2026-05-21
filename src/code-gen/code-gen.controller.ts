import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { CodeGenService } from './code-gen.service';

//TODO: p0-dev-user-01 is an unsecure user.
@Controller('code-gen')
export class CodeGenController {
  constructor(private readonly codeGenService: CodeGenService) {}

  @Get()
  async test() {
    return await this.codeGenService.enqueue('Start coding');
  }

  @Get(':jobId')
  getJobById(@Param('jobId') jobId: string) {
    return `Get job ${jobId}`;
  }

  //TODO: provide better typing
  @Post()
  async generate(@Body() body: { message: string }): Promise<{
    jobId: string | undefined;
    status: string;
  }> {
    return await this.codeGenService.enqueue(body.message);
  }
}
