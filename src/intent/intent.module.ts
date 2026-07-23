import { Module } from '@nestjs/common';
import { LlmModule } from 'src/llm/llm.module';
import { IntentProcessor } from './intent.processor';
import { ConversationModule } from 'src/conversation/conversation.module';
import { DbModule } from 'src/db/db.module';
import { IntentService } from './intent.service';
import { JobModule } from 'src/job/job.module';
import { AnvilAgentSupervisorModule } from 'src/anvil-agent-supervisor/anvil-agent-supervisor.module';

@Module({
  imports: [
    LlmModule,
    ConversationModule,
    DbModule,
    JobModule,
    AnvilAgentSupervisorModule,
  ],
  providers: [IntentProcessor, IntentService],
})
export class IntentModule {}
