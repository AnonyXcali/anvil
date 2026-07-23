import { Module } from '@nestjs/common';
import { AnvilAgentEditService } from './anvil-agent-edit.service';
import { SshModule } from 'src/ssh/ssh.module';

@Module({
  imports: [SshModule],
  providers: [AnvilAgentEditService],
  exports: [AnvilAgentEditService],
})
export class AnvilAgentEditModule {}
