import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CodeGenService } from './code-gen.service';
import { CodeGenController } from './code-gen.controller';
import { CodeGenProcessor } from './code-gen.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'code-execution',
    }),
  ],
  providers: [CodeGenService, CodeGenProcessor],
  controllers: [CodeGenController],
})
export class CodeGenModule {}
