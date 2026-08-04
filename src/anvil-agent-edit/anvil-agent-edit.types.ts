import { z } from 'zod';

export type FILE_MODIFICATION_TOKENS =
  | 'import'
  | 'add'
  | 'delete'
  | 'replace'
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
};

export type EDIT_AGENT_INPUT = Array<FILE_EDIT>;

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
  'replace_file',
]);

export const INSTRUCTION: z.ZodType<FILE_EDIT_INSTRUCTION> = z.object({
  // TODO: Add an id field once FILE_EDIT_INSTRUCTION supports stable instruction UUIDs.
  line_range: z.object({
    startRange: z.number(),
    endRange: z.number(),
  }),
  action_tokens: z.array(Z_FILE_MODIFICATION_TOKENS),
  precise_instruction: z.string(),
  code: z.string().nullable(),
  verified: z.boolean(),
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
