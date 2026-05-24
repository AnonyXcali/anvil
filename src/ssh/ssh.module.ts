import { Module } from '@nestjs/common';
import { SshService } from './ssh.service';
import { SshController } from './ssh.controller';
import { DbService } from '../db/db.service';

@Module({
  providers: [SshService, DbService],
  controllers: [SshController],
  exports: [SshService],
})
export class SshModule {}
