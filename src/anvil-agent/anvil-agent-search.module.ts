import { Module } from '@nestjs/common';
import { SshModule } from 'src/ssh/ssh.module';
import { AnvilAgentSearchService } from './anvil-agent-search.service';

@Module({
  imports: [SshModule],
  providers: [AnvilAgentSearchService],
  exports: [AnvilAgentSearchService],
})
export class AnvilAgentSearchModule {}
