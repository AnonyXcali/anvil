import { Job } from 'bullmq';

export type INTENT_TYPE = {
  query: string;
};

export type INTENT_JOB = Job<INTENT_JOB>;
