import { Module } from '@nestjs/common';
import { CoreService } from './core.service';
import { CoreController } from './core.controller';
import { BullModule } from '@nestjs/bullmq';
import { DbModule } from 'src/db/db.module';

@Module({
  imports: [
    DbModule,
    BullModule.registerQueue({
      name: 'intent-execution',
    }),
  ],
  providers: [CoreService],
  controllers: [CoreController],
})
export class CoreModule {}
