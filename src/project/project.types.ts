import { Job } from 'bullmq';

export type PROJECT_PROCESS_TYPE = {
  project_id: string;
  container_name: string;
  port: number;
};

export type PROJECT_PROCESS_JOB = Job<PROJECT_PROCESS_TYPE>;
