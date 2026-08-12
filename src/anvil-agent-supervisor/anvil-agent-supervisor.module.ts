import { Module } from '@nestjs/common';
import { AnvilAgentSupervisorService } from './anvil-agent-supervisor.service';
import { AnvilSupervisorAgentProcessor } from './anvil-agent-supervisor.processor';
import { BullModule } from '@nestjs/bullmq';
import { JobModule } from 'src/job/job.module';
import { ChannelsModule } from 'src/channels/channels.module';
import { DbModule } from 'src/db/db.module';
import { AnvilAgentStreamPublisher } from 'src/anvil-agent/anvil-agent-stream-publisher.service';
import { ConversationTranscriptService } from 'src/conversation/conversation-transcript.service';
import { AnvilAgentEditModule } from 'src/anvil-agent-edit/anvil-agent-edit.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'anvil-supervisor-agent-processor',
    }),
    JobModule,
    ChannelsModule,
    DbModule,
    AnvilAgentEditModule,
  ],
  providers: [
    AnvilAgentStreamPublisher,
    AnvilAgentSupervisorService,
    AnvilSupervisorAgentProcessor,
    ConversationTranscriptService,
  ],
  exports: [AnvilAgentSupervisorService],
})
export class AnvilAgentSupervisorModule {}
