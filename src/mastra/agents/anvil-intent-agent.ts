import { Agent } from '@mastra/core/agent';
import { INTENT_CLASSIFIER_PROMPT } from 'src/llm/llm.prompts';

/**
 * Creates the non-streaming classifier that chooses the next Anvil routing path.
 * Its structured result is consumed internally by IntentService; it is never
 * published as a Redis or SSE event.
 */
export function createAnvilIntentAgent(deps: { model: string }) {
  return new Agent({
    id: 'anvil-intent-agent',
    name: 'Anvil Intent Agent',
    instructions: INTENT_CLASSIFIER_PROMPT,
    model: deps.model,
  });
}
