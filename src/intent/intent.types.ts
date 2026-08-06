import { Job } from 'bullmq';
import { z } from 'zod';

export const IntentClassificationSchema = z.object({
  intent: z.enum(['instant', 'offload', 'unknown']),
});

export type IntentClassification = z.infer<
  typeof IntentClassificationSchema
>['intent'];

export type INTENT_TYPE = {
  query: string;
  conversation_id: string;
  project_id: string;
  stream_id: string;
};

export type INTENT_JOB = Job<INTENT_TYPE>;

export type INTENT_JOB_DTO = Job<{
  jobId: string;
  conversation_id: string;
}>;
