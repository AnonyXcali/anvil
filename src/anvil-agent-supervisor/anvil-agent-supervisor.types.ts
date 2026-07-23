import {
  FINAL_RESPONSE_SHAPE,
  ERROR,
  Z_ERROR_SHAPE,
  Z_FINAL_SHAPE_RESPONSE,
} from 'src/anvil-agent/anvil-agent.types';
import {
  EDIT_AGENT_INPUT,
  Z_EDIT_AGENT_WORKFLOW_INPUT,
} from 'src/anvil-agent-edit/anvil-agent-edit.types';
import { z } from 'zod';

export type ANVIL_SUPERVISOR_AGENT_JOB_DATA = {
  conversation_id: string;
  query: string;
  messages: Array<Record<string, string>>;
  project_id: string;
};

type SEARCH_OUTPUT_PLAN_INPUT = {
  result: Array<FINAL_RESPONSE_SHAPE>;
  error: ERROR;
};

//STEP 1: Search
type AnvilAgentSupervisorWorkflowSearchStepInputSchema = {
  request: string;
  projectId: string;
};

type AnvilAgentSupervisorWorkflowSearchStepOutputSchema = {
  response: SEARCH_OUTPUT_PLAN_INPUT;
};

type AnvilAgentSupervisorWorkflowOutputSchema = {
  response: string | null;
};

//STEP 2: Plan

type AnvilAgentSupervisorWorkflowPlanStepOutputSchema = {
  files: Array<FINAL_RESPONSE_SHAPE>;
};

type AnvilAgentSupervisorWorkflowPlanApprovalResumeInputSchema = {
  approved: boolean;
};

type AnvilAgentSupervisorWorkflowPlanApprovalSuspendOutputSchema = {
  type: 'approval_required';
  payload: {
    title: 'Apply proposed changes?';
    message: 'The AI has prepared a set of changes that require your approval.';
    summary: string;
  };
};

type AnvilAgentSupervisorWorkflowEditHandoffSchema = EDIT_AGENT_INPUT;

const WorkflowInput: z.ZodType<AnvilAgentSupervisorWorkflowSearchStepInputSchema> =
  z.object({
    request: z.string(),
    projectId: z.string(),
  });

const WorkflowOutput: z.ZodType<AnvilAgentSupervisorWorkflowOutputSchema> =
  z.object({
    response: z.string().nullable(),
  });

const SearchStepOutput: z.ZodType<AnvilAgentSupervisorWorkflowSearchStepOutputSchema> =
  z.object({
    response: z.object({
      result: z.array(Z_FINAL_SHAPE_RESPONSE),
      error: Z_ERROR_SHAPE,
    }),
  });

const PlanStepOutput: z.ZodType<AnvilAgentSupervisorWorkflowPlanStepOutputSchema> =
  z.object({
    files: z.array(Z_FINAL_SHAPE_RESPONSE),
  });

const PlanApprovalResumeInput: z.ZodType<AnvilAgentSupervisorWorkflowPlanApprovalResumeInputSchema> =
  z.object({
    approved: z.boolean(),
  });

const PlanApprovalSuspendOutput: z.ZodType<AnvilAgentSupervisorWorkflowPlanApprovalSuspendOutputSchema> =
  z.object({
    type: z.literal('approval_required'),
    payload: z.object({
      title: z.literal('Apply proposed changes?'),
      message: z.literal(
        'The AI has prepared a set of changes that require your approval.',
      ),
      summary: z.string(),
    }),
  });

const EditHandoffOutput: z.ZodType<AnvilAgentSupervisorWorkflowEditHandoffSchema> =
  Z_EDIT_AGENT_WORKFLOW_INPUT;

export {
  WorkflowInput,
  WorkflowOutput,
  SearchStepOutput,
  PlanStepOutput,
  PlanApprovalResumeInput,
  PlanApprovalSuspendOutput,
  EditHandoffOutput,
};
