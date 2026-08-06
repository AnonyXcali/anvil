import { Module } from '@nestjs/common';
import { SshModule } from 'src/ssh/ssh.module';
import { AnvilHistoryService } from './anvil-history.service';

@Module({
  imports: [SshModule],
  providers: [AnvilHistoryService],
  exports: [AnvilHistoryService],
})
export class AnvilHistoryModule {}
