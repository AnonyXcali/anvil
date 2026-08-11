import { Module } from '@nestjs/common';
import { CoreService } from './core.service';
import { CoreController } from './core.controller';
import { BullModule } from '@nestjs/bullmq';
import { DbModule } from 'src/db/db.module';
import { ChannelsModule } from 'src/channels/channels.module';
import { SharedredisModule } from 'src/sharedredis/sharedredis.module';
import { AnvilAgentStreamPublisher } from 'src/anvil-agent/anvil-agent-stream-publisher.service';
import { AnvilAgentSupervisorModule } from 'src/anvil-agent-supervisor/anvil-agent-supervisor.module';

@Module({
  imports: [
    SharedredisModule,
    ChannelsModule,
    DbModule,
    AnvilAgentSupervisorModule,
    BullModule.registerQueue({
      name: 'intent-execution',
    }),
  ],
  providers: [AnvilAgentStreamPublisher, CoreService],
  controllers: [CoreController],
  exports: [CoreService],
})
export class CoreModule {}
