import { Processor, WorkerHost } from '@nestjs/bullmq';
import { INTENT_JOB } from './intent.types';

@Processor('intent-execution', {
  concurrency: 1,
})
export class IntentProcessor extends WorkerHost {
  async process(job: INTENT_JOB) {
    await job.updateProgress(10);
    //call lightweight llm
    //push status update to redis channel?
    //update database row for this job id, with status
    //queue the next job based on intent returned
    await job.updateProgress(100);
    return 'done';
  }
}
