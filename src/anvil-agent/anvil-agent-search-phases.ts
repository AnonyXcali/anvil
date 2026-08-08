import {
  normalizeSearchFinalPlan,
  SEARCH_STRUCTURED_OUTPUT,
  SEARCH_TOOL_RESPONSE,
  TOOL_REQUEST_SHAPE,
  Z_SEARCH_FINAL_PLAN_OUTPUT,
  Z_SEARCH_TOOL_RESPONSE,
  Z_TOOL_REQUEST_SHAPE,
} from './anvil-agent.types';
import type { SearchExecutionPolicy } from 'src/mastra/anvil-agent.config';

type UnknownRecord = Record<string, unknown>;

export type SearchPhaseEvidence = {
  searchRequests: TOOL_REQUEST_SHAPE[];
  searchResponses: SEARCH_TOOL_RESPONSE[];
  history: string;
};

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null
    ? (value as UnknownRecord)
    : null;
}

function toolName(value: unknown): string | null {
  const record = asRecord(value);
  const payload = asRecord(record?.payload);
  const name = record?.toolName ?? payload?.toolName ?? record?.name;
  return typeof name === 'string' ? name : null;
}

function toolArguments(value: unknown): unknown {
  const record = asRecord(value);
  return record?.args ?? record?.input ?? asRecord(record?.payload)?.args;
}

function toolOutput(value: unknown): unknown {
  const record = asRecord(value);
  return record?.result ?? record?.output ?? asRecord(record?.payload)?.result;
}

function toolCallId(value: unknown): string | null {
  const record = asRecord(value);
  const payload = asRecord(record?.payload);
  const id = record?.toolCallId ?? record?.id ?? payload?.toolCallId;
  return typeof id === 'string' ? id : null;
}

function isRepositorySearch(value: unknown): boolean {
  return ['searchTool', 'anvil-agent-search-tool'].includes(
    toolName(value) ?? '',
  );
}

export function extractSearchPhaseEvidence(input: {
  toolCalls: unknown;
  toolResults: unknown;
  policy: SearchExecutionPolicy;
}): SearchPhaseEvidence {
  const toolCalls: unknown[] = Array.isArray(input.toolCalls)
    ? input.toolCalls
    : [];
  const toolResults: unknown[] = Array.isArray(input.toolResults)
    ? input.toolResults
    : [];
  const searchCalls = toolCalls.filter(isRepositorySearch);
  const searchResults = toolResults.filter(isRepositorySearch);
  const historyResults = toolResults.filter((result) =>
    ['read_history', 'read-history'].includes(toolName(result) ?? ''),
  );

  if (historyResults.length !== 1) {
    throw new Error(
      `Search phase expected exactly one history result, received ${historyResults.length}`,
    );
  }
  const minimumSearches = 1;
  if (
    searchCalls.length < minimumSearches ||
    searchResults.length < minimumSearches
  ) {
    throw new Error(
      `Search phase expected at least one repository search call and result, received ${searchCalls.length} calls and ${searchResults.length} results`,
    );
  }
  if (
    searchCalls.length > input.policy.maxSearchCalls ||
    searchResults.length > input.policy.maxSearchCalls
  ) {
    throw new Error(
      `Search phase exceeded its ${input.policy.maxSearchCalls}-search budget`,
    );
  }

  if (
    searchCalls.length !== searchResults.length ||
    (input.policy.mode === 'greedy' && searchCalls.length !== 1)
  ) {
    throw new Error(
      `Search phase search calls and results are mismatched: ${searchCalls.length} calls and ${searchResults.length} results`,
    );
  }

  const searchRequests: TOOL_REQUEST_SHAPE[] = [];
  const searchResponses: SEARCH_TOOL_RESPONSE[] = [];
  const useToolCallIds =
    searchCalls.every((call) => toolCallId(call) !== null) &&
    searchResults.every((result) => toolCallId(result) !== null);
  const usedResultIndexes = new Set<number>();
  searchCalls.forEach((searchCall, index) => {
    const callId = toolCallId(searchCall);
    const resultIndex = useToolCallIds
      ? searchResults.findIndex(
          (result, resultIndex) =>
            !usedResultIndexes.has(resultIndex) &&
            toolCallId(result) === callId,
        )
      : index;
    if (resultIndex >= 0) {
      usedResultIndexes.add(resultIndex);
    }
    const searchResult = searchResults[resultIndex];
    if (!searchResult) {
      throw new Error('Search phase could not match a search call to a result');
    }

    const request = Z_TOOL_REQUEST_SHAPE.safeParse(toolArguments(searchCall));
    if (!request.success) {
      throw new Error(
        `Invalid search tool arguments: ${request.error.message}`,
      );
    }
    const response = Z_SEARCH_TOOL_RESPONSE.safeParse(toolOutput(searchResult));
    if (!response.success) {
      throw new Error(`Invalid search tool result: ${response.error.message}`);
    }
    searchRequests.push(request.data);
    searchResponses.push(response.data);
  });

  const historyOutput = toolOutput(historyResults[0]);
  const history =
    typeof historyOutput === 'string'
      ? historyOutput
      : JSON.stringify(historyOutput ?? '');

  return {
    searchRequests,
    searchResponses,
    history,
  };
}

export function serializeSearchEvidence(evidence: SearchPhaseEvidence): string {
  return JSON.stringify({
    architectureHistory: evidence.history,
    searchRequests: evidence.searchRequests,
    searchResponses: evidence.searchResponses,
  });
}

export async function finalizeSearchPlan(input: {
  finalizerAgent: {
    generate: (
      prompt: string,
      options: {
        structuredOutput: { schema: typeof Z_SEARCH_FINAL_PLAN_OUTPUT };
        maxSteps: number;
        toolChoice: 'none';
      },
    ) => Promise<{ object: unknown }>;
  };
  request: string;
  evidence: SearchPhaseEvidence;
}): Promise<SEARCH_STRUCTURED_OUTPUT> {
  const execution = await input.finalizerAgent.generate(
    JSON.stringify({
      request: input.request,
      evidence: serializeSearchEvidence(input.evidence),
    }),
    {
      maxSteps: 2,
      toolChoice: 'none',
      structuredOutput: { schema: Z_SEARCH_FINAL_PLAN_OUTPUT },
    },
  );

  const finalPlan = Z_SEARCH_FINAL_PLAN_OUTPUT.safeParse(execution.object);
  if (!finalPlan.success) {
    throw new Error(`Invalid final search plan: ${finalPlan.error.message}`);
  }

  const lastSearchRequest =
    input.evidence.searchRequests[input.evidence.searchRequests.length - 1];
  if (!lastSearchRequest) {
    throw new Error('Cannot normalize a final plan without search evidence');
  }

  return normalizeSearchFinalPlan(lastSearchRequest, finalPlan.data);
}
