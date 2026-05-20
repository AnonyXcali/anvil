import { Controller, Get, Param } from '@nestjs/common';
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
}
