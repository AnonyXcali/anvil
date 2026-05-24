import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LlmController } from './llm.controller';
import { SshService } from 'src/ssh/ssh.service';
import { DbService } from '../db/db.service';

@Module({
  providers: [LlmService, SshService, DbService],
  controllers: [LlmController],
  exports: [LlmService],
})
export class LlmModule {}
