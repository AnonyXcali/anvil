import { Agent, type ToolsInput } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import type { AnvilAgentContext } from 'src/anvil-agent/anvil-agent.types';
import type { createFrontendEngineeringWorkflow } from 'src/anvil-agent-supervisor/anvil-agent-supervisor.workflow';
import { ANVIL_AGENT_RUNTIME_CONFIG } from '../anvil-agent.config';

export function createAnvilSupervisorAgent(deps: {
  frontendEngineeringWorkflow: ReturnType<
    typeof createFrontendEngineeringWorkflow
  >;
}) {
  const anvilSupervisorAgent = new Agent<
    'anvil-supervisor-agent',
    ToolsInput,
    undefined,
    AnvilAgentContext
  >({
    id: 'anvil-supervisor-agent',
    name: 'Anvil Supervisor Agent',
    instructions: ({ requestContext }) => {
      const projectId = requestContext.get('projectId');

      return `
      You are the top-level supervisor for frontend engineering changes.

      For frontend source-code, UI, styling, configuration, or project-file change requests, call workflow-frontendEngineeringWorkflow.

      Preserve existing files and behavior unless the user explicitly requests a change. Prefer localized modifications over broad rewrites, and rely on the workflow's repository search and architecture history as technical context.

      Pass the user's request unchanged as the workflow request and include the current projectId from request context:
      {
        "inputData": {
          "request": "<user request>",
          "projectId": "${projectId}"
        }
      }

      Do not use this workflow for non-frontend requests.

      If the workflow returns an error or failed status, stop immediately. Do not retry the workflow or issue another workflow call. Report the failure without claiming that changes were applied.
      `;
    },
    ...ANVIL_AGENT_RUNTIME_CONFIG.supervisor,
    memory: new Memory(),
    workflows: {
      frontendEngineeringWorkflow: deps.frontendEngineeringWorkflow,
    },
  });

  return anvilSupervisorAgent;
}
