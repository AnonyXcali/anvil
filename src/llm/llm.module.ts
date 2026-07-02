import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { LlmController } from './llm.controller';
import { ChannelsModule } from 'src/channels/channels.module';
import { DbModule } from 'src/db/db.module';

@Module({
  imports: [ChannelsModule, DbModule],
  providers: [LlmService],
  controllers: [LlmController],
  exports: [LlmService],
})
export class LlmModule {}
