import { OpenAIProviderOptions } from 'node_modules/@mastra/core/dist/llm/model/provider-options';

export const ANVIL_AGENT_CONFIGURATION: OpenAIProviderOptions = {
  reasoningEffort: 'medium',
  store: false,
  parallelToolCalls: true,
  // textVerbosity: 'low',
  forceReasoning: true,
  // reasoningSummary: 'concise',
};
