import type { AgentConfig } from '@mastra/core/agent';
import { StreamErrorRetryProcessor } from '@mastra/core/processors';

type AgentRuntimeConfig = Pick<
  AgentConfig,
  'model' | 'maxRetries' | 'maxProcessorRetries' | 'errorProcessors'
>;

export type SearchExecutionMode = 'normal' | 'greedy';

export type SearchExecutionPolicy = {
  mode: SearchExecutionMode;
  maxSearchCalls: number;
  maxSteps: number;
};

export const ANVIL_SEARCH_EXECUTION_POLICIES: Record<
  SearchExecutionMode,
  SearchExecutionPolicy
> = {
  normal: { mode: 'normal', maxSearchCalls: 10, maxSteps: 20 },
  greedy: { mode: 'greedy', maxSearchCalls: 1, maxSteps: 4 },
};

export const ANVIL_SEARCH_MODE: SearchExecutionMode = 'normal';

export const ANVIL_AGENT_RUNTIME_CONFIG = {
  conversation: { model: 'openai/gpt-5.5' },
  intent: { model: 'openai/gpt-5.5' },
  projectName: { model: 'openai/gpt-5.5' },
  search: {
    model: 'anthropic/claude-opus-5',
    maxRetries: 0,
    maxProcessorRetries: 1,
    errorProcessors: [
      new StreamErrorRetryProcessor({
        maxRetries: 1,
        maxRetryAfterMs: 30_000,
      }),
    ],
  },
  supervisor: { model: 'openai/gpt-5.6-luna' },
  planning: { model: 'anthropic/claude-opus-5' },
  editing: { model: 'openai/gpt-5.6-luna' },
  verify: { model: 'openai/gpt-5.6-luna' },
  weather: { model: 'openai/gpt-5-mini' },
} satisfies Record<string, AgentRuntimeConfig>;
