import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { SharedredisModule } from 'src/sharedredis/sharedredis.module';
import { BullModule } from '@nestjs/bullmq';
import { DbModule } from 'src/db/db.module';
import { ChannelsModule } from 'src/channels/channels.module';
import { ConversationProcessor } from './conversation.processor';
import { JobModule } from 'src/job/job.module';
import { ProjectModule } from 'src/project/project.module';
import { ConversationTranscriptService } from './conversation-transcript.service';

@Module({
  imports: [
    SharedredisModule,
    DbModule,
    ChannelsModule,
    JobModule,
    ProjectModule,
    BullModule.registerQueue({
      name: 'conversation-processor',
    }),
  ],
  providers: [
    ConversationService,
    ConversationProcessor,
    ConversationTranscriptService,
  ],
  exports: [ConversationService, ConversationTranscriptService],
})
export class ConversationModule {}
