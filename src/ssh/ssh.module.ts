import { Module } from '@nestjs/common';
import { SshService } from './ssh.service';
import { SshController } from './ssh.controller';
import { PortModule } from './port.module';

@Module({
  imports: [PortModule],
  providers: [SshService],
  controllers: [SshController],
  exports: [SshService],
})
export class SshModule {}
