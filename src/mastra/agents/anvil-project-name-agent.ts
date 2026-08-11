import { Agent } from '@mastra/core/agent';
import { ANVIL_AGENT_RUNTIME_CONFIG } from '../anvil-agent.config';

const PROJECT_NAME_AGENT_PROMPT = `
You generate concise project names for Anvil projects.

Infer a clear, human-readable name from the user's project description.
Return only the requested structured object. The name should be short, specific,
and suitable for a project list. Do not include quotes, markdown, emojis, or a
description. If the description is vague, choose a neutral but useful name.
`;

export function createAnvilProjectNameAgent() {
  return new Agent({
    id: 'anvil-project-name-agent',
    name: 'Anvil Project Name Agent',
    instructions: PROJECT_NAME_AGENT_PROMPT,
    ...ANVIL_AGENT_RUNTIME_CONFIG.projectName,
  });
}
