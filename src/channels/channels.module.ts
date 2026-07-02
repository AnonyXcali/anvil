import { Module } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { SharedredisModule } from 'src/sharedredis/sharedredis.module';

@Module({
  providers: [ChannelsService],
  imports: [SharedredisModule],
  exports: [ChannelsService],
})
export class ChannelsModule {}
