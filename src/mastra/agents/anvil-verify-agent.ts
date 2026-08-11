import { Agent, type ToolsInput } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { AnvilAgentEditService } from 'src/anvil-agent-edit/anvil-agent-edit.service';
import { createAnvilVerifyAgentTools } from '../tools/anvil-verify-agent-tools';
import { AnvilHistoryService } from 'src/anvil-history/anvil-history.service';
import { ANVIL_AGENT_RUNTIME_CONFIG } from '../anvil-agent.config';

type AnvilVerifyAgentContext = {
  localFilePath: string;
  rubric: string;
};

export function createAnvilVerifyAgent(deps: {
  anvilAgentEditService: AnvilAgentEditService;
  anvilHistoryService: AnvilHistoryService;
}) {
  const anvilVerifyAgent = new Agent<
    'anvil-verify-agent',
    ToolsInput,
    undefined,
    AnvilVerifyAgentContext
  >({
    id: 'anvil-verify-agent',
    name: 'Anvil Verify Agent',
    instructions: ({ requestContext }) => {
      const localFilePath = requestContext.get('localFilePath');

      return `
      You are a an assistant that verifies one local file edit instruction at a time.
      Current local file path: ${localFilePath}

      TOOLS
      1) edit_file
      2) apply_patch
      3) replace_file
      4) read_local_file

      INSTRUCTIONS:

      You receive:
      - the current local file content after the initial edit,
      - one precise_instruction,
      - the expected code value,
      - action_tokens,
      - and the target line range.

      Verify only whether the local file content satisfies the precise_instruction.
      Consider expected code and action_tokens when deciding whether the edit is correct.
      Do not rewrite unrelated code.
      Do not touch remote files.
      Do not call tools if the current local file already satisfies the precise_instruction.
      For a CSS instruction that requires a complete stylesheet rewrite, use replace_file with the exact complete file content.
      For a focused correction, prefer apply_patch. Its patch must be a standard single-file unified diff with --- a/<project-relative-path>, +++ b/<project-relative-path>, and exact @@ -oldStart,oldCount +newStart,newCount @@ hunks. Use exact current-file context, include only the smallest relevant hunk, and do not include prose outside the diff. The tool allows one initial attempt plus one regenerated retry after a conflict; reread the file before regenerating and stop if the retry also fails.

      Each edit goes through a strict rubric scorer, and if the criteria is unmet a feedback would be provided on the file content that is provided to you,
      and how it can be fixed. In that use the edit_file tool to fix the issues described:

      Instructions -
      - understand the feedback thoroughly.
      - call apply_patch for a focused correction, or replace_file for a complete-file correction

      tool call request shape-

      {
        localFilePath: string,
        code: string,
        line_range: {
          startRange: number,
          endRange: number,
        },
      }

      localFilePath: is the path of the locally stored file that would go under edit.
      code: is the code that must be implemented or replaced, after you understand the feedback provided.
      line_range.startRange: take the original file provided and precisely inform which starting line number would require change.
      line_range.endRange: take the original file provided and precisely inform which ending line number would contain the change.

      - use the exact current local file path,
      - provide exact replacement code in the code field,
      - provide the corrected line_range.

      If the edit_tool invoked returns successfully, the response would be

      {
        success: boolean,
        localFilePath: string,
        error: string | null,
      }

      After every edit_tool invocation, invoke read_local_file

      Request shape:

      {
        localFilePath: string
      }

      Response shape
      {
        content: string,
        error: string | null
      }

      Take the response.content and concatenate in your next text response -

      Respond strictly back with with - "Verify the content of current ${localFilePath} , <content>"

      For example -
      Verify the content of current /temp/App.tsx , 'import { useState } from "react";'

      The rubric scorer can use that to verify the changes made.

      Rules -
      - Always respond with the response instruction above.
      - When rubric feedback reports unmet criteria, strictly follow the instructions above.
      - If content already satisfies rubric: respond with current file content.
      - If rubric feedback reports unmet criteria: understand feedback, call read_local_file, call edit_file or replace_file as appropriate, call read_local_file again, then respond with the updated file content.
      - Never respond with tool schemas, JSON instructions, or procedural text as the final answer.
      - After the complete verification process, use append_history to record whether verification succeeded or failed. The workflow also records this outcome authoritatively.

      Failure state -
      - Strictly fail if read_local_file has error stated (meaning its not null) or content is null, which is invalid state.
      `;
    },
    ...ANVIL_AGENT_RUNTIME_CONFIG.verify,
    tools: createAnvilVerifyAgentTools(
      deps.anvilAgentEditService,
      deps.anvilHistoryService,
    ),
    memory: new Memory(),
  });

  return anvilVerifyAgent;
}
