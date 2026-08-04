import { Agent, type ToolsInput } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { AnvilAgentEditService } from 'src/anvil-agent-edit/anvil-agent-edit.service';
import type { createEditWorkflow } from 'src/anvil-agent-edit/anvil-agent-edit.workflow';
import type { AnvilAgentContext } from 'src/anvil-agent/anvil-agent.types';
import { createAnvilEditAgentTools } from '../tools/anvil-edit-agent-tools';
import { AnvilHistoryService } from 'src/anvil-history/anvil-history.service';

export function createAnvilEditingAgent(deps: {
  anvilAgentEditService: AnvilAgentEditService;
  anvilHistoryService: AnvilHistoryService;
  editWorkflow: ReturnType<typeof createEditWorkflow>;
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

      You receive normalized FILE_EDIT[] instructions. Each file item contains:
      - file_path
      - downloaded_local_file_path
      - backup_file
      - instructions with line_range, action_tokens, precise_instruction, code, and verified
      - error
      - isEdited
      - hash
      - file_exists

      Use tools before invoking run_edit_workflow when file or folder existence is uncertain:
      - verify_file_existing checks a target file.
      - verify_folder_existing checks a target folder.
      - create_file creates an empty file only.
      - create_folder creates one requested folder only.
      - read_file reads a bounded line range for surrounding context.
      - replace_file is reserved for verification corrections that intentionally replace a complete local file; normal requested range edits continue through the workflow.

      For every FILE_EDIT item with file_exists false:
      - Treat the target file as missing.
      - Derive the parent folder chain from file_path.
      - Start from src and move folder-by-folder toward the target file.
      - Verify each folder segment with verify_folder_existing.
      - If a folder segment is missing, create it with create_folder and verify it again.
      - Only after the full parent folder exists, create the target file with create_file.
      - Verify the created target file with verify_file_existing.
      - Update that FILE_EDIT item so file_exists is true.
      - Remove wording about creating the file from precise_instruction before workflow handoff.

      Repeat missing-file preparation until every FILE_EDIT item has file_exists true.

      Delete operations are dangerous:
      - Call delete_file only when the instructions explicitly state that deleting the file is safe.
      - Call delete_folder only when the instructions explicitly state that deleting the folder is safe.
      - If delete safety is ambiguous, reject the delete request and explain what confirmation is missing.

      Invoke run_edit_workflow only when target edit files exist, every FILE_EDIT item has file_exists true, and the edits are confirmed.
      Pass the normalized FILE_EDIT[] as:
      {
        "inputData": [ ... ]
      }

      Call run_edit_workflow at most once for a single edit handoff.
      Do not pass or invent workflow runtime fields such as initialState, resumeData, or suspendedToolRunId.
      If run_edit_workflow returns success false, report the error clearly and do not claim that edits were applied.
      Use append_history for any direct file or folder mutation you perform. The workflow also records authoritative mutation history; do not alter or replace existing history entries.
      `;
    },
    model: 'openai/gpt-5.6-luna',
    tools: createAnvilEditAgentTools({
      anvilAgentEditService: deps.anvilAgentEditService,
      anvilHistoryService: deps.anvilHistoryService,
      editWorkflow: deps.editWorkflow,
    }),
    memory: new Memory(),
  });

  return anvilEditingAgent;
}
