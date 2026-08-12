import { Job } from 'bullmq';
import { z } from 'zod';
import { MessageListInput } from '@mastra/core/agent/message-list';
import { isProjectRelativePath } from './anvil-agent-search.path';

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

export type FILE_MODIFICATION_TOKENS =
  | 'import'
  | 'add'
  | 'delete'
  | 'replace'
  | 'patch'
  | 'replace_file';

export type STRUCTURE_PHASE_ID =
  | 'structure'
  | 'shared'
  | 'feature'
  | 'integration'
  | 'validation';

export type FILE_TYPE =
  | 'component'
  | 'stylesheet'
  | 'route'
  | 'layout'
  | 'config'
  | 'asset'
  | 'test'
  | 'service';

export type ARCHITECTURAL_ROLE =
  | 'app-shell'
  | 'feature-page'
  | 'feature-component'
  | 'shared-primitive'
  | 'feature-style'
  | 'global-style'
  | 'route-registration'
  | 'configuration'
  | 'test';

export type FILE_OPERATION = 'create' | 'edit' | 'delete';

export type STRUCTURE_PLAN = {
  feature_root: string;
  phases: Array<{
    id: STRUCTURE_PHASE_ID;
    file_paths: string[];
  }>;
  directories_to_create: string[];
  preserve: string[];
  existing_paths: string[];
};

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

export const Z_TOOL_REQUEST_SHAPE: z.ZodType<TOOL_REQUEST_SHAPE> = z
  .object({
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
                startLine: z.number().int().positive(),
                endLine: z.number().int().positive(),
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
  })
  .superRefine((request, context) => {
    if (request.type === 'file_search' && !request.query.keyword?.length) {
      context.addIssue({
        code: 'custom',
        path: ['query', 'keyword'],
        message: 'file_search requires at least one keyword',
      });
    }

    if (request.type === 'content_search') {
      if (!request.query.files_paths_for_content_search.length) {
        context.addIssue({
          code: 'custom',
          path: ['query', 'files_paths_for_content_search'],
          message: 'content_search requires at least one file path',
        });
      }
      if (!request.query.keyword?.length) {
        context.addIssue({
          code: 'custom',
          path: ['query', 'keyword'],
          message: 'content_search requires at least one keyword',
        });
      }
    }

    if (request.type === 'expand_context') {
      const expansion = request.query.files_path_for_expansion;

      if (!expansion) {
        context.addIssue({
          code: 'custom',
          path: ['query', 'files_path_for_expansion'],
          message: 'expand_context requires a file path',
        });
        return;
      }

      if (!isProjectRelativePath(expansion.file_name)) {
        context.addIssue({
          code: 'custom',
          path: ['query', 'files_path_for_expansion', 'file_name'],
          message: 'file_name must be a project-relative path',
        });
      }

      if (!expansion.ranges?.length) {
        context.addIssue({
          code: 'custom',
          path: ['query', 'files_path_for_expansion', 'ranges'],
          message: 'expand_context requires at least one line range',
        });
        return;
      }

      expansion.ranges.forEach((range, index) => {
        if (range.startLine > range.endLine) {
          context.addIssue({
            code: 'custom',
            path: ['query', 'files_path_for_expansion', 'ranges', index],
            message: 'startLine must be less than or equal to endLine',
          });
        }
      });
    }
  });

export type FINAL_RESPONSE_SHAPE = {
  file_path: string;
  line_range: {
    startRange: number;
    endRange: number;
  };
  file_exists: boolean;
  action_tokens: FILE_MODIFICATION_TOKENS[];
  precise_instruction: string;
  code: string | null;
  patch: string | null;
  file_type: FILE_TYPE;
  architectural_role: ARCHITECTURAL_ROLE;
  operation: FILE_OPERATION;
  depends_on: string[];
};

export type ERROR = {
  error_type: SEARCH_ERROR_TYPES;
  error_message: string;
} | null;

const Z_SEARCH_ERROR_TYPES: z.ZodType<SEARCH_ERROR_TYPES> = z.enum([
  'unknown_error',
  'unknown_query',
  'max_calls_exceeded',
  'sensitive_data_breach',
]);

export type SEARCH_STRUCTURED_OUTPUT = {
  is_final: boolean;
  tool: TOOL_REQUEST_SHAPE;
  final: {
    files_that_require_change: Array<FINAL_RESPONSE_SHAPE>;
    structure_plan: STRUCTURE_PLAN;
  } | null;
  error: ERROR;
};

export type SEARCH_FINAL_PLAN_OUTPUT = {
  files_that_require_change: Array<FINAL_RESPONSE_SHAPE>;
  structure_plan: STRUCTURE_PLAN;
};

export const Z_ERROR_SHAPE: z.ZodType<ERROR> = z
  .object({
    error_type: Z_SEARCH_ERROR_TYPES,
    error_message: z.string(),
  })
  .nullable();

export const Z_FINAL_SHAPE_RESPONSE: z.ZodType<FINAL_RESPONSE_SHAPE> = z
  .object({
    file_path: z.string(),
    line_range: z.object({
      startRange: z.number(),
      endRange: z.number(),
    }),
    file_exists: z.boolean(),
    action_tokens: z.array(
      z.enum(['import', 'add', 'delete', 'replace', 'patch', 'replace_file']),
    ),
    precise_instruction: z.string(),
    code: z.string().nullable(),
    patch: z.string().nullable().default(null),
    file_type: z
      .enum([
        'component',
        'stylesheet',
        'route',
        'layout',
        'config',
        'asset',
        'test',
        'service',
      ])
      .default('component'),
    architectural_role: z
      .enum([
        'app-shell',
        'feature-page',
        'feature-component',
        'shared-primitive',
        'feature-style',
        'global-style',
        'route-registration',
        'configuration',
        'test',
      ])
      .default('feature-component'),
    operation: z.enum(['create', 'edit', 'delete']).default('edit'),
    depends_on: z.array(z.string()).default([]),
  })
  .superRefine((value, context) => {
    const hasPatchToken = value.action_tokens.includes('patch');
    const hasReplaceFileToken = value.action_tokens.includes('replace_file');
    const hasAddToken = value.action_tokens.includes('add');
    const hasPatchPayload =
      value.patch !== null && value.patch.trim().length > 0;
    const hasAddCode = value.code !== null && value.code.trim().length > 0;

    if (hasPatchToken !== hasPatchPayload) {
      context.addIssue({
        code: 'custom',
        path: ['patch'],
        message: 'The patch token requires a non-empty unified diff in patch',
      });
    }

    if (hasPatchToken && value.action_tokens.includes('replace_file')) {
      context.addIssue({
        code: 'custom',
        path: ['action_tokens'],
        message: 'patch cannot be combined with replace_file',
      });
    }

    if (hasAddToken && value.operation !== 'create') {
      context.addIssue({
        code: 'custom',
        path: ['operation'],
        message: 'add requires operation create',
      });
    }
    if (hasAddToken && value.file_exists) {
      context.addIssue({
        code: 'custom',
        path: ['file_exists'],
        message: 'add requires file_exists false',
      });
    }
    if (hasAddToken && !hasAddCode) {
      context.addIssue({
        code: 'custom',
        path: ['code'],
        message: 'add requires non-empty code',
      });
    }
    if (value.operation === 'create' && !hasAddToken) {
      context.addIssue({
        code: 'custom',
        path: ['action_tokens'],
        message: 'operation create requires add',
      });
    }
    if (value.operation === 'delete' && !value.file_exists) {
      context.addIssue({
        code: 'custom',
        path: ['file_exists'],
        message: 'delete requires file_exists true',
      });
    }

    const { startRange, endRange } = value.line_range;
    const usesWholeFileRange =
      hasPatchToken || hasReplaceFileToken || hasAddToken;

    if (usesWholeFileRange) {
      if (
        !Number.isInteger(startRange) ||
        !Number.isInteger(endRange) ||
        startRange !== 0 ||
        endRange !== 0
      ) {
        context.addIssue({
          code: 'custom',
          path: ['line_range'],
          message: `${hasPatchToken ? 'patch' : hasReplaceFileToken ? 'replace_file' : 'add'} requires line range 0 to 0`,
        });
      }
      return;
    }

    if (!Number.isInteger(startRange) || startRange <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['line_range', 'startRange'],
        message: 'startRange must be a positive integer',
      });
    }

    if (!Number.isInteger(endRange) || endRange <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['line_range', 'endRange'],
        message: 'endRange must be a positive integer',
      });
    }

    if (
      Number.isInteger(startRange) &&
      Number.isInteger(endRange) &&
      startRange > endRange
    ) {
      context.addIssue({
        code: 'custom',
        path: ['line_range'],
        message: 'startRange must be less than or equal to endRange',
      });
    }
  });

export const Z_SEARCH_STRUCTURED_OUTPUT: z.ZodType<SEARCH_STRUCTURED_OUTPUT> =
  z.object({
    is_final: z.boolean(),
    tool: Z_TOOL_REQUEST_SHAPE,
    final: z
      .object({
        files_that_require_change: z.array(Z_FINAL_SHAPE_RESPONSE),
        structure_plan: z
          .object({
            feature_root: z.string(),
            phases: z.array(
              z.object({
                id: z.enum([
                  'structure',
                  'shared',
                  'feature',
                  'integration',
                  'validation',
                ]),
                file_paths: z.array(z.string()),
              }),
            ),
            directories_to_create: z.array(z.string()),
            preserve: z.array(z.string()),
            existing_paths: z.array(z.string()).default([]),
          })
          .default({
            feature_root: 'src',
            phases: [],
            directories_to_create: [],
            preserve: [],
            existing_paths: [],
          }),
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

export const Z_SEARCH_FINAL_PLAN_OUTPUT: z.ZodType<SEARCH_FINAL_PLAN_OUTPUT> = z
  .object({
    files_that_require_change: z.array(Z_FINAL_SHAPE_RESPONSE),
    structure_plan: z
      .object({
        feature_root: z.string(),
        phases: z.array(
          z.object({
            id: z.enum([
              'structure',
              'shared',
              'feature',
              'integration',
              'validation',
            ]),
            file_paths: z.array(z.string()),
          }),
        ),
        directories_to_create: z.array(z.string()),
        preserve: z.array(z.string()),
        existing_paths: z.array(z.string()).default([]),
      })
      .default({
        feature_root: 'src',
        phases: [],
        directories_to_create: [],
        preserve: [],
        existing_paths: [],
      }),
  })
  .strict();

export function normalizeSearchFinalPlan(
  searchRequest: TOOL_REQUEST_SHAPE,
  finalPlan: SEARCH_FINAL_PLAN_OUTPUT,
): SEARCH_STRUCTURED_OUTPUT {
  return {
    is_final: true,
    tool: searchRequest,
    final: finalPlan,
    error: null,
  };
}

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
  conversationId?: string;
  jobId?: string;
  originatingRunId?: string;
  repairRunId?: string;
  editTransactionId?: string;
  repairApprovalId?: string;
  callCount: number;
  maxSearchCalls?: number;
  structurePlan?: STRUCTURE_PLAN;
  editProgress?: EditProgressSink;
  editDiagnostic?: EditDiagnosticSink;
  editWorkflowFailure?: string;
  multiFileHandoff?: boolean;
  editCleanupTargets?: EditCleanupTarget[];
};

export type EditProgressStatus = 'started' | 'completed' | 'failed';

export type EditProgressSink = (event: {
  step: string;
  status: EditProgressStatus;
  message: string;
}) => Promise<void>;

export type EditDiagnosticSink = (event: {
  type: string;
  payload: Record<string, unknown>;
}) => Promise<void>;

export type EditCleanupTarget = {
  projectId: string;
  localFilePath: string;
  backupFilePath?: string;
};

export type AnvilSupervisionContext = {
  projectId: string;
};

export type AnvilSearchAgentContext = {
  projectId: string;
  callCount: number;
};
