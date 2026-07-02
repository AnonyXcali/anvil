import { Module } from '@nestjs/common';
import { JobService } from './job.service';
import { DbModule } from 'src/db/db.module';

@Module({
  imports: [DbModule],
  providers: [JobService],
  exports: [JobService],
})
export class JobModule {}
