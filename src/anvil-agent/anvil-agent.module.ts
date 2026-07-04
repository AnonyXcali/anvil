import { Module } from '@nestjs/common';
import { AnvilAgentService } from './anvil-agent.service';
import { AnvilAgentProcessor } from './anvil-agent.processor';
import { BullModule } from '@nestjs/bullmq';
import { AnvilAgentController } from './anvil-agent.controller';
import { SshModule } from 'src/ssh/ssh.module';
import { ChannelsModule } from 'src/channels/channels.module';
import { JobModule } from 'src/job/job.module';
import { DbModule } from 'src/db/db.module';
import { AnvilAgentSearchModule } from './anvil-agent-search.module';

@Module({
  imports: [
    DbModule,
    BullModule.registerQueue({
      name: 'anvil-agent-processor',
    }),
    SshModule,
    ChannelsModule,
    JobModule,
    AnvilAgentSearchModule,
  ],
  controllers: [AnvilAgentController],
  providers: [AnvilAgentService, AnvilAgentProcessor],
  exports: [AnvilAgentService],
})
export class AnvilAgentModule {}
