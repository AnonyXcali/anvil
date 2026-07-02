import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { SharedredisModule } from 'src/sharedredis/sharedredis.module';

@Module({
  imports: [SharedredisModule],
  providers: [StorageService],
})
export class StorageModule {}
