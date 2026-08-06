import { Module } from '@nestjs/common';
import { IntentProcessor } from './intent.processor';
import { ConversationModule } from 'src/conversation/conversation.module';
import { DbModule } from 'src/db/db.module';
import { IntentService } from './intent.service';
import { JobModule } from 'src/job/job.module';
import { AnvilAgentSupervisorModule } from 'src/anvil-agent-supervisor/anvil-agent-supervisor.module';
import { ChannelsModule } from 'src/channels/channels.module';
import { AnvilAgentStreamPublisher } from 'src/anvil-agent/anvil-agent-stream-publisher.service';

@Module({
  imports: [
    ConversationModule,
    DbModule,
    JobModule,
    AnvilAgentSupervisorModule,
    ChannelsModule,
  ],
  providers: [IntentProcessor, IntentService, AnvilAgentStreamPublisher],
})
export class IntentModule {}
