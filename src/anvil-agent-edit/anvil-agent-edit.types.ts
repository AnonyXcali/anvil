import { z } from 'zod';
import type {
  ARCHITECTURAL_ROLE,
  FILE_OPERATION,
  FILE_TYPE,
  STRUCTURE_PLAN,
} from 'src/anvil-agent/anvil-agent.types';
import { getEditOperationContractError } from './edit-operation.validation';

export type FILE_MODIFICATION_TOKENS =
  | 'import'
  | 'add'
  | 'delete'
  | 'replace'
  | 'patch'
  | 'replace_file';

export type FILE_EDIT_INSTRUCTION = {
  // TODO: Add a stable instruction UUID so workflow state updates do not rely on field-by-field matching.
  line_range: {
    startRange: number;
    endRange: number;
  };
  action_tokens: FILE_MODIFICATION_TOKENS[];
  precise_instruction: string;
  code: string | null;
  patch: string | null;
  verified: boolean;
};

export type FILE_EDIT = {
  file_path: string;
  downloaded_local_file_path: string | null;
  backup_file: string | null;
  instructions: FILE_EDIT_INSTRUCTION[];
  error: string | null;
  isEdited: boolean;
  hash: string | null;
  file_exists: boolean;
  file_type: FILE_TYPE;
  architectural_role: ARCHITECTURAL_ROLE;
  operation: FILE_OPERATION;
  depends_on: string[];
  structure_plan: STRUCTURE_PLAN;
};

export type EDIT_AGENT_INPUT = Array<FILE_EDIT>;

export const Z_MODEL_EDIT_INSTRUCTION = z
  .object({
    line_range: z.object({
      startRange: z.number(),
      endRange: z.number(),
    }),
    action_tokens: z.array(
      z.enum(['import', 'add', 'delete', 'replace', 'patch', 'replace_file']),
    ),
    precise_instruction: z.string(),
    code: z.string().nullable(),
    patch: z.string().nullable().default(null),
  })
  .strict();

export const Z_MODEL_FILE_EDIT = z
  .object({
    file_path: z.string(),
    file_exists: z.boolean(),
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
    instructions: z.array(Z_MODEL_EDIT_INSTRUCTION),
  })
  .strict()
  .superRefine((value, context) => {
    const actionTokens = value.instructions.flatMap(
      (instruction) => instruction.action_tokens,
    );
    const code =
      value.instructions.find((instruction) => instruction.code !== null)
        ?.code ?? null;
    const error = getEditOperationContractError({
      filePath: value.file_path,
      actionTokens,
      operation: value.operation,
      fileExists: value.file_exists,
      code,
      instructionCount: value.instructions.length,
    });
    if (error) {
      context.addIssue({ code: 'custom', path: [], message: error });
    }
    value.instructions.forEach((instruction, index) => {
      const wholeFileInstruction = instruction.action_tokens.some((token) =>
        ['add', 'patch', 'replace_file'].includes(token),
      );
      if (
        wholeFileInstruction &&
        (instruction.line_range.startRange !== 0 ||
          instruction.line_range.endRange !== 0)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['instructions', index, 'line_range'],
          message: `${
            instruction.action_tokens.find((token) =>
              ['add', 'patch', 'replace_file'].includes(token),
            ) ?? 'whole-file operation'
          } for ${value.file_path} must use line range 0 to 0`,
        });
      }
    });
  });

export const Z_MODEL_EDIT_AGENT_WORKFLOW_INPUT = z
  .array(Z_MODEL_FILE_EDIT)
  .min(1, 'At least one file edit is required');

export type MODEL_EDIT_AGENT_INPUT = z.infer<
  typeof Z_MODEL_EDIT_AGENT_WORKFLOW_INPUT
>;

function withoutVerifiedFlag(
  instruction: FILE_EDIT_INSTRUCTION,
): Omit<FILE_EDIT_INSTRUCTION, 'verified'> {
  const { verified, ...withoutVerified } = instruction;
  void verified;
  return withoutVerified;
}

export function toModelFacingEditInput(
  inputData: EDIT_AGENT_INPUT,
): MODEL_EDIT_AGENT_INPUT {
  return inputData.map((file) => ({
    file_path: file.file_path,
    file_exists: file.file_exists,
    file_type: file.file_type,
    architectural_role: file.architectural_role,
    operation: file.operation,
    depends_on: file.depends_on,
    instructions: file.instructions.map(withoutVerifiedFlag),
  }));
}

export function toInternalEditInput(
  inputData: MODEL_EDIT_AGENT_INPUT,
  structurePlan: STRUCTURE_PLAN,
): EDIT_AGENT_INPUT {
  return inputData.map((file) => ({
    file_path: file.file_path,
    downloaded_local_file_path: null,
    backup_file: null,
    instructions: file.instructions.map((instruction) => ({
      ...instruction,
      verified: false,
    })),
    error: null,
    isEdited: false,
    hash: null,
    file_exists: file.file_exists,
    file_type: file.file_type,
    architectural_role: file.architectural_role,
    operation: file.operation,
    depends_on: file.depends_on,
    structure_plan: structurePlan,
  }));
}

export type STAGED_FILE_ENTRY = {
  projectPath: string;
  localPath: string;
  operation: FILE_OPERATION;
  existedRemotely: boolean;
  originalHash: string | null;
  backupPath: string | null;
  instructionIndexes: number[];
  applied: boolean;
  verified: boolean;
  validationStatus: 'pending' | 'passed' | 'failed';
  commitStatus:
    | 'pending'
    | 'commit-started'
    | 'uploaded'
    | 'deleted'
    | 'rolled-back'
    | 'rollback-failed'
    | 'untouched';
};

export type STAGING_MANIFEST = {
  projectId: string;
  editRunId: string;
  stagingRoot: string;
  files: STAGED_FILE_ENTRY[];
  directoriesToCreate: string[];
  createdDirectories: string[];
  totalBytes: number;
  fileCount: number;
  structurePlan: STRUCTURE_PLAN | null;
};

export type UNIFIED_PATCH_RESULT = {
  localFilePath: string;
  projectPath: string;
  hunksApplied: number;
  changed: boolean;
};

type ANVIL_AGENT_TOOL_REQUEST_FILE_OPERATIONS = {
  file_path: string;
  file_name: string;
}[];

type ANVIL_AGENT_TOOL_REQUEST_FOLDER_OPERATIONS = {
  folder_path: string;
  folder_name: string;
}[];

export const Z_ANVIL_AGENT_TOOL_REQUEST_FILE_OPERATIONS: z.ZodType<ANVIL_AGENT_TOOL_REQUEST_FILE_OPERATIONS> =
  z.array(
    z.object({
      file_path: z.string(),
      file_name: z.string(),
    }),
  );

export const Z_ANVIL_AGENT_TOOL_REQUEST_FOLDER_OPERATIONS: z.ZodType<ANVIL_AGENT_TOOL_REQUEST_FOLDER_OPERATIONS> =
  z.array(
    z.object({
      folder_name: z.string(),
      folder_path: z.string(),
    }),
  );

//WORKFLOWS
//DOWNLOAD (ENTRY)

//can be used for output.

const Z_FILE_MODIFICATION_TOKENS: z.ZodType<FILE_MODIFICATION_TOKENS> = z.enum([
  'import',
  'add',
  'delete',
  'replace',
  'patch',
  'replace_file',
]);

export const INSTRUCTION: z.ZodType<FILE_EDIT_INSTRUCTION> = z
  .object({
    // TODO: Add an id field once FILE_EDIT_INSTRUCTION supports stable instruction UUIDs.
    line_range: z.object({
      startRange: z.number(),
      endRange: z.number(),
    }),
    action_tokens: z.array(Z_FILE_MODIFICATION_TOKENS),
    precise_instruction: z.string(),
    code: z.string().nullable(),
    patch: z.string().nullable().default(null),
    verified: z.boolean(),
  })
  .superRefine((value, context) => {
    const hasPatchToken = value.action_tokens.includes('patch');
    const hasPatchPayload =
      value.patch !== null && value.patch.trim().length > 0;

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
  });

export const INSTRUCTIONS = z.array(INSTRUCTION);

export const Z_FILE_EDIT: z.ZodType<FILE_EDIT> = z.object({
  file_path: z.string(),
  downloaded_local_file_path: z.string().nullable(),
  backup_file: z.string().nullable(),
  instructions: INSTRUCTIONS,
  error: z.string().nullable(),
  isEdited: z.boolean(),
  hash: z.string().nullable(),
  file_exists: z.boolean(),
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
});

export const Z_EDIT_AGENT_WORKFLOW_INPUT: z.ZodType<EDIT_AGENT_INPUT> =
  z.array(Z_FILE_EDIT);

//CREATE BACKUP (parallel to download)
//src/App.tsx.anvil-bak-<jobId>

//APPLY EDIT

//VERIFY
//UPLOAD FILE
//HASH CHECK
//DELETE (CLEAN UP / EXIT)
