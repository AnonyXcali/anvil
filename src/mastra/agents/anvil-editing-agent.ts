import { Agent, type ToolsInput } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { AnvilAgentEditService } from 'src/anvil-agent-edit/anvil-agent-edit.service';
import type {
  createEditWorkflow,
  createStagedEditWorkflow,
} from 'src/anvil-agent-edit/anvil-agent-edit.workflow';
import type { AnvilAgentContext } from 'src/anvil-agent/anvil-agent.types';
import { createAnvilEditAgentTools } from '../tools/anvil-edit-agent-tools';
import { AnvilHistoryService } from 'src/anvil-history/anvil-history.service';
import { ANVIL_AGENT_RUNTIME_CONFIG } from '../anvil-agent.config';

export function createAnvilEditingAgent(deps: {
  anvilAgentEditService: AnvilAgentEditService;
  anvilHistoryService: AnvilHistoryService;
  editWorkflow: ReturnType<typeof createEditWorkflow>;
  stagedEditWorkflow: ReturnType<typeof createStagedEditWorkflow>;
}) {
  const anvilEditingAgent = new Agent<
    'anvil-editing-agent',
    ToolsInput,
    undefined,
    AnvilAgentContext
  >({
    id: 'anvil-editing-agent',
    name: 'Anvil Editing Agent',
    instructions: ({ requestContext }) => {
      const projectId = requestContext.get('projectId');

      return `
      You are the project edit agent for frontend and source-code changes.

      Current projectId: ${projectId}

      You receive model-facing FILE_EDIT[] instructions. Each file item contains:
      - file_path
      - instructions with line_range, action_tokens, precise_instruction, code, and patch
      - file_type, architectural_role, operation, and depends_on
      - file_exists

      Use read-only tools before invoking run_edit_workflow when file or folder existence is uncertain:
      - verify_file_existing checks a target file.
      - verify_folder_existing checks a target folder.
      - read_file reads a bounded line range for surrounding context.
      - Do not use create_file, create_folder, or direct mutation tools to prepare the approved edit handoff. The staged transaction owns missing-file preparation and rollback.
      - replace_file is reserved for verification corrections that intentionally replace a complete local file; normal requested range edits continue through the workflow.
      When FILE_EDIT[] contains more than one file, do not call create_file, create_folder, delete_file, or delete_folder. Pass the complete normalized payload directly to run_edit_workflow; the staged transaction owns missing-file preparation and rollback.
      Verification corrections should use the verifier's bounded apply_patch contract for focused changes: one standard unified diff with matching ---/+++ project-relative headers and exact @@ context hunks. Keep patches minimal and do not invent context; complete stylesheet rewrites may use replace_file.

      Return approved file metadata and edit instructions only. Never return or invent runtime execution state, including structure_plan, isEdited, verified, hashes, backup paths, local paths, errors, staging status, commit status, or rollback status. The application supplies and owns those values internally.

      For single-file workflows, every FILE_EDIT item with file_exists false:
      - Treat the target file as missing.
      - Derive the parent folder chain from file_path.
      - Start from src and move folder-by-folder toward the target file.
      - Verify each folder segment with verify_folder_existing.
      - If a folder segment is missing, create it with create_folder and verify it again.
      - Only after the full parent folder exists, create the target file with create_file.
      - Verify the created target file with verify_file_existing when using direct single-file preparation tools.
      - Do not update file_exists or any other metadata; the application owns those fields.
      - Do not send structure_plan or runtime fields in the workflow handoff.

      Repeat only the required non-mutating checks until the workflow handoff is ready. Planned new files are handled by the staged transaction and must not be created through direct mutation tools.

      Respect the normalized FILE_EDIT[] order produced by the supervisor. Complete prerequisite files before dependent files; do not reorder the payload based on your own preference.
      The approved structural plan is application-owned. Do not reproduce or modify it.

      Delete operations are dangerous:
      - Call delete_file only when the instructions explicitly state that deleting the file is safe.
      - Call delete_folder only when the instructions explicitly state that deleting the folder is safe.
      - If delete safety is ambiguous, reject the delete request and explain what confirmation is missing.

      Invoke run_edit_workflow after the approved file paths and edit instructions are ready. The backend determines whether each file is created, edited, or deleted.
      Pass the normalized FILE_EDIT[] as:
      {
        "inputData": [ ... ]
      }
      Do not reproduce or modify backend-owned metadata. The application injects the canonical structural plan and runtime state into the edit workflow automatically.

      Call run_edit_workflow at most once for a single edit handoff.
      Do not pass or invent workflow runtime fields such as initialState, resumeData, or suspendedToolRunId.
      If run_edit_workflow returns success false, report the error clearly and do not claim that edits were applied.
      Use append_history for any direct file or folder mutation you perform. The workflow also records authoritative mutation history; do not alter or replace existing history entries.
      `;
    },
    ...ANVIL_AGENT_RUNTIME_CONFIG.editing,
    tools: createAnvilEditAgentTools({
      anvilAgentEditService: deps.anvilAgentEditService,
      anvilHistoryService: deps.anvilHistoryService,
      editWorkflow: deps.editWorkflow,
      stagedEditWorkflow: deps.stagedEditWorkflow,
    }),
    memory: new Memory(),
  });

  return anvilEditingAgent;
}
