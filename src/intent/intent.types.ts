import { Job } from 'bullmq';

export type INTENT_TYPE = {
  query: string;
  conversation_id: string;
};

export type INTENT_JOB = Job<INTENT_TYPE>;

export type INTENT_JOB_DTO = Job<{
  jobId: string;
  conversation_id: string;
}>;
