import { Module } from '@nestjs/common';
import { SshService } from './ssh.service';
import { SshController } from './ssh.controller';
import { LlmService } from '../llm/llm.service';

@Module({
  providers: [SshService],
  controllers: [SshController],
  exports: [SshService],
})
export class SshModule {}
