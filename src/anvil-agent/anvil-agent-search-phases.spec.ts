import {
  extractSearchPhaseEvidence,
  finalizeSearchPlan,
} from './anvil-agent-search-phases';
import {
  SEARCH_FINAL_PLAN_OUTPUT,
  TOOL_REQUEST_SHAPE,
} from './anvil-agent.types';
import type { SearchExecutionPolicy } from 'src/mastra/anvil-agent.config';

const greedyPolicy: SearchExecutionPolicy = {
  mode: 'greedy',
  maxSearchCalls: 1,
  maxSteps: 4,
};

const normalPolicy: SearchExecutionPolicy = {
  mode: 'normal',
  maxSearchCalls: 10,
  maxSteps: 20,
};

const searchRequest: TOOL_REQUEST_SHAPE = {
  tool_call: 'search_tool',
  type: 'content_search',
  query: {
    files_paths_for_content_search: ['src/app/App.tsx'],
    files_path_for_expansion: null,
    keyword: ['className'],
  },
  history: [],
};

const searchResponse = {
  search_type: 'content_search' as const,
  results: [
    {
      file_path: 'src/app/App.tsx',
      line_number: 1,
      column_number: 1,
      relevant_text: '<main className="hero" />',
    },
  ],
  length: 1,
  calls: 1,
  intent_history: [],
};

const finalPlan: SEARCH_FINAL_PLAN_OUTPUT = {
  files_that_require_change: [
    {
      file_path: 'src/app/App.tsx',
      line_range: { startRange: 1, endRange: 1 },
      file_exists: true,
      action_tokens: ['replace'],
      precise_instruction: 'Update the hero markup while preserving behavior.',
      code: '<main className="hero" />',
      patch: null,
      file_type: 'component',
      architectural_role: 'app-shell',
      operation: 'edit',
      depends_on: [],
    },
  ],
  structure_plan: {
    feature_root: 'src',
    phases: [],
    directories_to_create: [],
    preserve: ['existing behavior'],
    existing_paths: ['src/app/App.tsx'],
  },
};

describe('search execution phases', () => {
  it('extracts validated search evidence without a combined output object', () => {
    const evidence = extractSearchPhaseEvidence({
      toolCalls: [{ toolName: 'searchTool', args: searchRequest }],
      toolResults: [
        { toolName: 'read_history', output: 'history content' },
        { toolName: 'searchTool', output: searchResponse },
      ],
      policy: greedyPolicy,
    });

    expect(evidence.searchRequests).toEqual([searchRequest]);
    expect(evidence.searchResponses).toEqual([searchResponse]);
    expect(evidence.history).toBe('history content');
  });

  it('rejects a search phase with no repository result', () => {
    expect(() =>
      extractSearchPhaseEvidence({
        toolCalls: [],
        toolResults: [],
        policy: greedyPolicy,
      }),
    ).toThrow('exactly one history result');
  });

  it('rejects missing or duplicate history and search evidence', () => {
    expect(() =>
      extractSearchPhaseEvidence({
        toolCalls: [{ toolName: 'searchTool', args: searchRequest }],
        toolResults: [{ toolName: 'searchTool', output: searchResponse }],
        policy: greedyPolicy,
      }),
    ).toThrow('exactly one history result');

    expect(() =>
      extractSearchPhaseEvidence({
        toolCalls: [
          { toolName: 'searchTool', args: searchRequest },
          { toolName: 'searchTool', args: searchRequest },
        ],
        toolResults: [
          { toolName: 'read_history', output: 'history content' },
          { toolName: 'searchTool', output: searchResponse },
          { toolName: 'searchTool', output: searchResponse },
        ],
        policy: greedyPolicy,
      }),
    ).toThrow('exceeded its 1-search budget');
  });

  it('accepts multiple validated searches in normal mode', () => {
    const evidence = extractSearchPhaseEvidence({
      toolCalls: [
        { toolName: 'searchTool', args: searchRequest },
        { toolName: 'searchTool', args: searchRequest },
      ],
      toolResults: [
        { toolName: 'read_history', output: 'history content' },
        { toolName: 'searchTool', output: searchResponse },
        { toolName: 'searchTool', output: searchResponse },
      ],
      policy: normalPolicy,
    });

    expect(evidence.searchRequests).toHaveLength(2);
    expect(evidence.searchResponses).toHaveLength(2);
  });

  it('rejects legacy fields in the compact final plan', async () => {
    const finalizerAgent = {
      generate: jest.fn().mockResolvedValue({
        object: { ...finalPlan, is_final: true, error: null },
      }),
    };

    await expect(
      finalizeSearchPlan({
        finalizerAgent,
        request: 'Update the hero',
        evidence: {
          searchRequests: [searchRequest],
          searchResponses: [searchResponse],
          history: 'history content',
        },
      }),
    ).rejects.toThrow('Invalid final search plan');
  });

  it('normalizes the compact finalizer result to the legacy handoff', async () => {
    const finalizerAgent = {
      generate: jest.fn().mockResolvedValue({ object: finalPlan }),
    };

    const result = await finalizeSearchPlan({
      finalizerAgent,
      request: 'Update the hero',
      evidence: {
        searchResponses: [searchResponse],
        searchRequests: [searchRequest],
        history: 'history content',
      },
    });

    expect(finalizerAgent.generate).toHaveBeenCalledWith(
      expect.stringContaining('Update the hero'),
      expect.objectContaining({ toolChoice: 'none' }),
    );
    expect(result).toMatchObject({
      is_final: true,
      tool: searchRequest,
      final: finalPlan,
      error: null,
    });
  });
});
