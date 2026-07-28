import { Module } from '@nestjs/common';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';
import { DbModule } from 'src/db/db.module';
import { PortModule } from 'src/ssh/port.module';
import { CodeGenModule } from 'src/code-gen/code-gen.module';
import { BullModule } from '@nestjs/bullmq';
import { ProjectStopProcessor } from './project.stop-processor';
import { ProjectStartProcessor } from './project.start-processor';
import { JobModule } from 'src/job/job.module';
import { SshModule } from 'src/ssh/ssh.module';

@Module({
  imports: [
    DbModule,
    PortModule,
    CodeGenModule,
    JobModule,
    SshModule,
    BullModule.registerQueue({
      name: 'stop-project-queue',
    }),
    BullModule.registerQueue({
      name: 'start-project-queue',
    }),
  ],
  controllers: [ProjectController],
  providers: [ProjectService, ProjectStopProcessor, ProjectStartProcessor],
  exports: [ProjectService],
})
export class ProjectModule {}
