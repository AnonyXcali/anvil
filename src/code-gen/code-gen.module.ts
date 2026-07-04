import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CodeGenService } from './code-gen.service';
import { CodeGenController } from './code-gen.controller';
import { CodeGenProcessor } from './code-gen.processor';
import { SshModule } from '../ssh/ssh.module';
import { LlmModule } from '../llm/llm.module';
import { DbModule } from '../db/db.module';
import { PortModule } from '../ssh/port.module';
import { CodeGenEditProcessor } from './code-gen-edit.processor';
import { ChannelsModule } from 'src/channels/channels.module';
import { JobModule } from 'src/job/job.module';

/**
 * POST /projects/:projectId/messages
 *   -> generate App.tsx
 *   -> save build row
 *   -> enqueue build job
 *   -> return buildId
 *
 * Worker processes job
 *   -> select VM dynamically
 *   -> reserve VM build slot
 *   -> SSH to selected VM
 *   -> write/upload files
 *   -> docker build
 *   -> run preview container
 *   -> save vm_id, container_name, preview_url
 *   -> release build slot
 */

@Module({
  imports: [
    PortModule,
    SshModule,
    LlmModule,
    DbModule,
    ChannelsModule,
    JobModule,
    BullModule.registerQueue({
      name: 'code-execution',
    }),
    BullModule.registerQueue({
      name: 'edit-code-execution',
    }),
  ],
  providers: [CodeGenService, CodeGenProcessor, CodeGenEditProcessor],
  controllers: [CodeGenController],
  exports: [CodeGenService],
})
export class CodeGenModule {}
