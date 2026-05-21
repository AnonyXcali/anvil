import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CodeGenService } from './code-gen.service';
import { CodeGenController } from './code-gen.controller';
import { CodeGenProcessor } from './code-gen.processor';
import { SshService } from '../ssh/ssh.service';
import { LlmService } from '../llm/llm.service';

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
    BullModule.registerQueue({
      name: 'code-execution',
    }),
  ],
  providers: [CodeGenService, CodeGenProcessor, SshService, LlmService],
  controllers: [CodeGenController],
})
export class CodeGenModule {}
