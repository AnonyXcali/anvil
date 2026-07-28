import { Agent, type ToolsInput } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import type { AnvilAgentContext } from 'src/anvil-agent/anvil-agent.types';
import type { createFrontendEngineeringWorkflow } from 'src/anvil-agent-supervisor/anvil-agent-supervisor.workflow';

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

      Pass the user's request unchanged as the workflow request and include the current projectId from request context:
      {
        "inputData": {
          "request": "<user request>",
          "projectId": "${projectId}"
        }
      }

      Do not use this workflow for non-frontend requests.
      `;
    },
    model: 'openai/gpt-5.6-luna',
    memory: new Memory(),
    workflows: {
      frontendEngineeringWorkflow: deps.frontendEngineeringWorkflow,
    },
  });

  return anvilSupervisorAgent;
}
