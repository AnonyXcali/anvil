import { Module } from '@nestjs/common';
import { AnvilAgentSupervisorService } from './anvil-agent-supervisor.service';
import { AnvilSupervisorAgentProcessor } from './anvil-agent-supervisor.processor';
import { BullModule } from '@nestjs/bullmq';
import { ConversationModule } from 'src/conversation/conversation.module';
import { JobModule } from 'src/job/job.module';
import { ChannelsModule } from 'src/channels/channels.module';
import { DbModule } from 'src/db/db.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'anvil-supervisor-agent-processor',
    }),
    ConversationModule,
    JobModule,
    ChannelsModule,
    DbModule,
  ],
  providers: [AnvilAgentSupervisorService, AnvilSupervisorAgentProcessor],
  exports: [AnvilAgentSupervisorService],
})
export class AnvilAgentSupervisorModule {}
