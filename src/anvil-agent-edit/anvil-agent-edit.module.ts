import { Module } from '@nestjs/common';
import { AnvilAgentEditService } from './anvil-agent-edit.service';
import { AnvilEditStagingService } from './anvil-edit-staging.service';
import { SshModule } from 'src/ssh/ssh.module';
import { DbModule } from 'src/db/db.module';
import { AnvilRepairStateService } from './anvil-repair-state.service';

@Module({
  imports: [SshModule, DbModule],
  providers: [
    AnvilAgentEditService,
    AnvilEditStagingService,
    AnvilRepairStateService,
  ],
  exports: [
    AnvilAgentEditService,
    AnvilEditStagingService,
    AnvilRepairStateService,
  ],
})
export class AnvilAgentEditModule {}
