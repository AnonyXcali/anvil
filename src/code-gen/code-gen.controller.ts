import { Controller, Get, Param } from '@nestjs/common';
import { CodeGenService } from './code-gen.service';

@Controller('code-gen')
export class CodeGenController {
  constructor(private readonly codeGenService: CodeGenService) {}

  @Get()
  async test() {
    return await this.codeGenService.enqueue('hello');
  }

  @Get(':jobId')
  getJobById(@Param('jobId') jobId: string) {
    return `Get job ${jobId}`;
  }
}
