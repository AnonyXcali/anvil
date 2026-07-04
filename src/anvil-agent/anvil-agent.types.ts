import { Job } from 'bullmq';
import { z } from 'zod';
import { MessageListInput } from '@mastra/core/agent/message-list';

type SEARCH_TOOL = 'search_tool';

export type OFFLOAD_TYPE = {
  messages: MessageListInput;
  conversation_id: string;
  project_id: string;
};

export type ANVIL_AGENT_JOB = Job<OFFLOAD_TYPE>;

export type ANVIL_AGENT_JOB_DTO = Job<{
  message: string | undefined;
  conversationId: string | undefined;
  status: 'done' | 'error';
}>;

type SEARCH_TYPES = 'file_search' | 'content_search' | 'expand_context';

type SEARCH_ERROR_TYPES =
  | 'unknown_error'
  | 'unknown_query'
  | 'max_calls_exceeded'
  | 'sensitive_data_breach';

type FILE_MODIFICATION_TOKENS = 'import' | 'add' | 'delete' | 'replace';

export type TOOL_REQUEST_SHAPE = {
  tool_call: SEARCH_TOOL;
  type: SEARCH_TYPES;
  query: {
    files_paths_for_content_search: string[];
    files_path_for_expansion: {
      file_name: string;
      ranges: Array<{
        startLine: number;
        endLine: number;
      }> | null;
    } | null;
    keyword: Array<string> | null;
  };
  history: Array<{
    tool_call: SEARCH_TOOL;
    type: SEARCH_TYPES;
    intent: string;
  }>;
};

export const Z_TOOL_REQUEST_SHAPE: z.ZodType<TOOL_REQUEST_SHAPE> = z.object({
  tool_call: z.enum(['search_tool']),
  type: z.enum(['file_search', 'content_search', 'expand_context']),
  query: z.object({
    files_paths_for_content_search: z.array(z.string()),
    files_path_for_expansion: z
      .object({
        file_name: z.string(),
        ranges: z
          .array(
            z.object({
              startLine: z.number(),
              endLine: z.number(),
            }),
          )
          .nullable(),
      })
      .nullable(),
    keyword: z.array(z.string()).nullable(),
  }),
  history: z.array(
    z.object({
      tool_call: z.enum(['search_tool']),
      type: z.enum(['file_search', 'content_search', 'expand_context']),
      intent: z.string(),
    }),
  ),
});

export type FINAL_RESPONSE_SHAPE = {
  file_path: string;
  line_range: {
    startRange: number;
    endRange: number;
  };
  action_tokens: FILE_MODIFICATION_TOKENS[];
  precise_instruction: string;
};

export type SEARCH_STRUCTURED_OUTPUT = {
  is_final: boolean;
  tool: TOOL_REQUEST_SHAPE;
  final: {
    files_that_require_change: Array<FINAL_RESPONSE_SHAPE>;
  } | null;
  error: {
    error_type: SEARCH_ERROR_TYPES;
    error_message: string;
  } | null;
};

export const Z_SEARCH_STRUCTURED_OUTPUT: z.ZodType<SEARCH_STRUCTURED_OUTPUT> =
  z.object({
    is_final: z.boolean(),
    tool: Z_TOOL_REQUEST_SHAPE,
    final: z
      .object({
        files_that_require_change: z.array(
          z.object({
            file_path: z.string(),
            line_range: z.object({
              startRange: z.number(),
              endRange: z.number(),
            }),
            action_tokens: z.array(
              z.enum(['import', 'add', 'delete', 'replace']),
            ),
            precise_instruction: z.string(),
          }),
        ),
      })
      .nullable(),
    error: z
      .object({
        error_type: z.enum([
          'unknown_error',
          'unknown_query',
          'max_calls_exceeded',
          'sensitive_data_breach',
        ]),
        error_message: z.string(),
      })
      .nullable(),
  });

export type SEARCH_TOOL_RESPONSE = {
  search_type: SEARCH_TYPES;
  results: Array<{
    file_path: string;
    line_number: number | null;
    column_number: number | null;
    relevant_text: string | null;
  }>;
  length: number;
  calls: number;
  intent_history: Array<{
    tool_call: string;
    type: SEARCH_TYPES;
    intent: string;
  }>;
};

export const Z_SEARCH_TOOL_RESPONSE: z.ZodType<SEARCH_TOOL_RESPONSE> = z.object(
  {
    search_type: z.enum(['file_search', 'content_search', 'expand_context']),
    results: z.array(
      z.object({
        file_path: z.string(),
        line_number: z.number().nullable(),
        column_number: z.number().nullable(),
        relevant_text: z.string().nullable(),
      }),
    ),
    length: z.number(),
    calls: z.number(),
    intent_history: z.array(
      z.object({
        tool_call: z.string(),
        type: z.enum(['file_search', 'content_search', 'expand_context']),
        intent: z.string(),
      }),
    ),
  },
);

interface BeginEvent {
  type: 'begin';
  data: {
    path: {
      text: string;
    };
  };
}

interface MatchEvent {
  type: 'match';
  data: {
    path: {
      text: string;
    };
    lines: {
      text: string;
    };
    line_number: number;
    absolute_offset: number;
    submatches: {
      match: {
        text: string;
      };
      start: number;
      end: number;
    }[];
  };
}

interface EndEvent {
  type: 'end';
  data: {
    path: {
      text: string;
    };
    binary_offset: number | null;
    stats: {
      elapsed: {
        secs: number;
        nanos: number;
        human: string;
      };
      searches: number;
      searches_with_match: number;
      bytes_searched: number;
      bytes_printed: number;
      matched_lines: number;
      matches: number;
    };
  };
}

interface SummaryEvent {
  type: 'summary';
  data: {
    elapsed_total: {
      human: string;
    };
    stats: {
      matched_lines: number;
      matches: number;
    };
  };
}

export type RgEvent = BeginEvent | MatchEvent | EndEvent | SummaryEvent;

export type AnvilAgentContext = {
  projectId: string;
  callCount: number;
};
