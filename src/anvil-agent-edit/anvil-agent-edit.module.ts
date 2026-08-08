import { Module } from '@nestjs/common';
import { AnvilAgentEditService } from './anvil-agent-edit.service';
import { AnvilEditStagingService } from './anvil-edit-staging.service';
import { SshModule } from 'src/ssh/ssh.module';

@Module({
  imports: [SshModule],
  providers: [AnvilAgentEditService, AnvilEditStagingService],
  exports: [AnvilAgentEditService, AnvilEditStagingService],
})
export class AnvilAgentEditModule {}
