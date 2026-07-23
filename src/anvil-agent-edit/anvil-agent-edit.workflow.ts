import { createWorkflow, createStep } from '@mastra/core/workflows';
import {
  Z_EDIT_AGENT_WORKFLOW_INPUT,
  Z_FILE_EDIT,
  FILE_EDIT_INSTRUCTION,
  FILE_EDIT,
  EDIT_AGENT_INPUT,
  INSTRUCTION,
} from './anvil-agent-edit.types';
import { z } from 'zod';
import { AnvilAgentEditService } from './anvil-agent-edit.service';
import { readFile } from 'fs/promises';
import { AGENT_DIRECTORY } from 'src/agent.directory';
import { RequestContext } from '@mastra/core/request-context';
import { createRubricScorer } from '@mastra/evals/scorers/prebuilt';

type EditWorkflowDeps = {
  anvilAgentEditService: AnvilAgentEditService;
};

type VerifyAgentContext = {
  localFilePath: string;
  rubric: string;
};

const DOWNLOAD_STEP = 'anvil-edit-agent-nested-workflow-download-file-step';
const BACKUP_STEP =
  'anvil-edit-agent-nested-workflow-backup-original-file-step';
const APPLY_EDIT_STEP = 'anvil-edit-agent-nested-workflow-apply-edit-file-step';
const VERIFY_STEP = 'anvil-edit-agent-nested-workflow-verify-edit-file-step';
const UPLOAD_FILE_STEP =
  'anvil-edit-agent-nested-workflow-upload-edit-file-step';
const DELETE_STEP = 'anvil-edit-agent-nested-workflow-delete-temp-file-step';

const APPLY_EDIT_INPUT = z.object({
  file_path: z.string(),
  instruction: INSTRUCTION,
});

const APPLY_EDIT_INPUTS = z.array(APPLY_EDIT_INPUT);

const UPLOAD_FILE_INPUT = z.object({
  localFilePath: z.string(),
  originalFilePath: z.string(),
  originalHash: z.string(),
});

const CLEANUP_INPUT = z.object({
  file_path: z.string(),
  backupFilePath: z.string(),
  localFilePath: z.string(),
});

// const Z_VERIFY_AGENT_OUTPUT = z.object({
//   verified: z.boolean(),
//   fix_instruction: z
//     .object({
//       file_path: z.string(),
//       instruction: z.string(),
//       code: z.string(),
//       line_range: z.object({
//         startRange: z.number(),
//         endRange: z.number(),
//       }),
//     })
//     .nullable(),
// });

function isSameInstruction(
  left: FILE_EDIT_INSTRUCTION,
  right: FILE_EDIT_INSTRUCTION,
): boolean {
  // TODO: Replace this field-by-field match with instruction.id once FILE_EDIT_INSTRUCTION has a UUID.
  return (
    left.precise_instruction === right.precise_instruction &&
    left.code === right.code &&
    left.line_range.startRange === right.line_range.startRange &&
    left.line_range.endRange === right.line_range.endRange &&
    left.action_tokens.length === right.action_tokens.length &&
    left.action_tokens.every(
      (token, index) => token === right.action_tokens[index],
    )
  );
}

function fatalStateError(stepName: string, filePath: string, detail: string) {
  return new Error(
    `Fatal nested edit workflow state error in ${stepName} for ${filePath}: ${detail}`,
  );
}

function requireFileEditState(
  state: EDIT_AGENT_INPUT | null | undefined,
  filePath: string,
  stepName: string,
): FILE_EDIT {
  if (!Array.isArray(state)) {
    throw fatalStateError(stepName, filePath, 'workflow state is not an array');
  }

  const fileEdit = state.find((item) => item.file_path === filePath);

  if (!fileEdit) {
    throw fatalStateError(stepName, filePath, 'missing FILE_EDIT state');
  }

  return fileEdit;
}

function requireStateString(
  value: string | null,
  fieldName: keyof Pick<
    FILE_EDIT,
    'downloaded_local_file_path' | 'hash' | 'backup_file'
  >,
  filePath: string,
  stepName: string,
): string {
  if (!value) {
    throw fatalStateError(stepName, filePath, `${fieldName} is unavailable`);
  }

  return value;
}

const createDeleteStep = (deps: EditWorkflowDeps) => {
  const deleteStep = createStep({
    id: DELETE_STEP,
    inputSchema: CLEANUP_INPUT,
    outputSchema: Z_FILE_EDIT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, requestContext, state } = context;
      const projectId = requestContext.get('projectId');

      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for cleanup step');
      }

      if (!inputData.file_path.trim()) {
        throw new Error('File path is unavailable for cleanup step');
      }

      if (!inputData.backupFilePath.trim()) {
        throw new Error('Backup file path is unavailable for cleanup step');
      }

      if (!inputData.localFilePath.trim()) {
        throw new Error('Local file path is unavailable for cleanup step');
      }

      const fileEdit = requireFileEditState(
        state,
        inputData.file_path,
        DELETE_STEP,
      );
      const backupFilePath = requireStateString(
        fileEdit.backup_file,
        'backup_file',
        inputData.file_path,
        DELETE_STEP,
      );
      const localFilePath = requireStateString(
        fileEdit.downloaded_local_file_path,
        'downloaded_local_file_path',
        inputData.file_path,
        DELETE_STEP,
      );

      await deps.anvilAgentEditService.cleanUp(
        projectId,
        backupFilePath,
        localFilePath,
      );

      return fileEdit;
    },
  });

  return deleteStep;
};

const createUploadFileStep = (deps: EditWorkflowDeps) => {
  const uploadFileStep = createStep({
    id: UPLOAD_FILE_STEP,
    inputSchema: UPLOAD_FILE_INPUT,
    outputSchema: z.object({
      success: z.boolean(),
      file_path: z.string().nullable(),
    }),
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, requestContext, state } = context;
      const projectId = requestContext.get('projectId');

      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for upload step');
      }

      if (!inputData.localFilePath.trim()) {
        throw new Error('Local file path is unavailable for upload step');
      }

      if (!inputData.originalFilePath.trim()) {
        throw new Error('Original file path is unavailable for upload step');
      }

      if (!inputData.originalHash.trim()) {
        throw new Error('Original hash is unavailable for upload step');
      }

      const fileEdit = requireFileEditState(
        state,
        inputData.originalFilePath,
        UPLOAD_FILE_STEP,
      );
      const downloadedLocalFilePath = requireStateString(
        fileEdit.downloaded_local_file_path,
        'downloaded_local_file_path',
        inputData.originalFilePath,
        UPLOAD_FILE_STEP,
      );
      const hash = requireStateString(
        fileEdit.hash,
        'hash',
        inputData.originalFilePath,
        UPLOAD_FILE_STEP,
      );

      if (downloadedLocalFilePath !== inputData.localFilePath) {
        throw new Error(
          `Upload local file path does not match workflow state for ${inputData.originalFilePath}`,
        );
      }

      if (hash !== inputData.originalHash) {
        throw new Error(
          `Upload hash does not match workflow state for ${inputData.originalFilePath}`,
        );
      }

      if (fileEdit.instructions.some((instruction) => !instruction.verified)) {
        throw new Error(
          `Cannot upload ${inputData.originalFilePath} before all instructions are verified`,
        );
      }

      await deps.anvilAgentEditService.upload(
        projectId,
        inputData.localFilePath,
        inputData.originalFilePath,
        inputData.originalHash,
      );

      return {
        success: true,
        file_path: inputData.originalFilePath,
      };
    },
  });

  return uploadFileStep;
};

const createVerifyStep = () => {
  const verifyStep = createStep({
    id: VERIFY_STEP,
    inputSchema: APPLY_EDIT_INPUT,
    outputSchema: APPLY_EDIT_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, mastra, state } = context;
      const fileEdit = requireFileEditState(
        state,
        inputData.file_path,
        VERIFY_STEP,
      );
      const downloadedLocalFilePath = requireStateString(
        fileEdit.downloaded_local_file_path,
        'downloaded_local_file_path',
        inputData.file_path,
        VERIFY_STEP,
      );

      const fileContent = await readFile(downloadedLocalFilePath, 'utf8');
      const verifyAgent = mastra.getAgent(AGENT_DIRECTORY.anvilVerifyAgent);
      const rubricScorer = createRubricScorer({
        model: 'openai/gpt-5-mini',
      });
      const requestContext = new RequestContext<VerifyAgentContext>();
      const rubric = `Changes should satisfy ${inputData.instruction.precise_instruction}`;
      let scorerComplete = false;
      let scorerFailureReason: string | undefined;

      requestContext.set('localFilePath', downloadedLocalFilePath);
      requestContext.set('rubric', rubric);

      await verifyAgent.generate(
        [
          'Verify this local file edit instruction.',
          `Local file path: ${downloadedLocalFilePath}`,
          `Project file path: ${inputData.file_path}`,
          `Precise instruction: ${inputData.instruction.precise_instruction}`,
          `Action tokens: ${inputData.instruction.action_tokens.join(', ')}`,
          `Expected code: ${inputData.instruction.code ?? '<null>'}`,
          `Line range: ${JSON.stringify(inputData.instruction.line_range)}`,
          'Current local file content:',
          fileContent,
        ].join('\n\n'),
        {
          maxSteps: 20,
          // structuredOutput: {
          //   schema: Z_VERIFY_AGENT_OUTPUT,
          // },
          requestContext,
          isTaskComplete: {
            scorers: [rubricScorer],
            strategy: 'all',
            timeout: 30000,
            parallel: true,
            suppressFeedback: false,
            onComplete: (result) => {
              scorerComplete = result.complete;

              if (!scorerComplete) {
                scorerFailureReason =
                  result.completionReason ??
                  result.scorers
                    .filter((scorerResult) => !scorerResult.passed)
                    .map((scorerResult) => scorerResult.reason)
                    .filter(Boolean)
                    .join('\n');
              }
            },
          },
          onIterationComplete: (iterationContext) => {
            if (iterationContext.iteration > 20) {
              return {
                continue: false,
                feedback: 'Maximum verification iterations reached.',
              };
            }
          },
        },
      );

      // const parsed = Z_VERIFY_AGENT_OUTPUT.safeParse(execution.object);

      // if (!parsed.success) {
      //   throw new Error(`Invalid verify output: ${parsed.error.message}`);
      // }

      if (!scorerComplete) {
        throw new Error(
          scorerFailureReason ||
            `Verification failed for ${inputData.file_path}`,
        );
      }

      // if (parsed.data.fix_instruction !== null) {
      //   throw new Error(
      //     `Verified output must not include a fix instruction for ${inputData.file_path}`,
      //   );
      // }

      let instructionWasUpdated = false;
      const verifiedInstruction: FILE_EDIT_INSTRUCTION = {
        ...inputData.instruction,
        verified: true,
      };

      const nextState = state.map((item) =>
        item.file_path === inputData.file_path
          ? {
              ...item,
              instructions: item.instructions.map((instruction) => {
                if (
                  !instructionWasUpdated &&
                  isSameInstruction(instruction, inputData.instruction)
                ) {
                  instructionWasUpdated = true;
                  return verifiedInstruction;
                }

                return instruction;
              }),
            }
          : item,
      );

      if (!instructionWasUpdated) {
        throw new Error(
          `No matching instruction found for ${inputData.file_path}`,
        );
      }

      requireFileEditState(nextState, inputData.file_path, VERIFY_STEP);
      await context.setState(nextState);

      return {
        file_path: inputData.file_path,
        instruction: verifiedInstruction,
      };
    },
  });

  return verifyStep;
};

const createDownloadStep = (deps: EditWorkflowDeps) => {
  const downloadStep = createStep({
    id: DOWNLOAD_STEP,
    inputSchema: Z_FILE_EDIT,
    outputSchema: z.object({ file_path: z.string() }),
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, requestContext, state } = context;
      const projectId = requestContext.get('projectId');

      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for download step');
      }

      if (!inputData.file_exists) {
        throw new Error(
          `Cannot download ${inputData.file_path} before the file exists`,
        );
      }

      // TODO: Handle local downloaded file collisions.
      const { localFilePath, hash } =
        await deps.anvilAgentEditService.downloadFile(
          projectId,
          inputData.file_path,
        );

      await context.writer.custom({
        type: 'edit_download_diagnostics',
        payload: {
          file_path: inputData.file_path,
          localFilePath,
          hash,
        },
      });

      const existingState = Array.isArray(state) ? state : [];
      const hasCurrentFileState = existingState.some(
        (fileEdit) => fileEdit.file_path === inputData.file_path,
      );
      const nextState = hasCurrentFileState
        ? existingState.map((fileEdit) =>
            fileEdit.file_path === inputData.file_path
              ? {
                  ...fileEdit,
                  downloaded_local_file_path: localFilePath,
                  hash,
                }
              : fileEdit,
          )
        : [
            ...existingState,
            {
              ...inputData,
              downloaded_local_file_path: localFilePath,
              hash,
            },
          ];

      // Nested workflow state can be missing when the workflow tool is invoked
      // without initialState, so seed it from inputData and assert integrity.
      requireFileEditState(nextState, inputData.file_path, DOWNLOAD_STEP);
      await context.setState(nextState);

      return { file_path: inputData.file_path };
    },
  });

  return downloadStep;
};

const createApplyEditStep = (deps: EditWorkflowDeps) => {
  const applyEditStep = createStep({
    id: APPLY_EDIT_STEP,
    inputSchema: APPLY_EDIT_INPUT,
    outputSchema: APPLY_EDIT_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, state } = context;
      const { instruction } = inputData;
      const fileEdit = requireFileEditState(
        state,
        inputData.file_path,
        APPLY_EDIT_STEP,
      );
      const downloadedLocalFilePath = requireStateString(
        fileEdit.downloaded_local_file_path,
        'downloaded_local_file_path',
        inputData.file_path,
        APPLY_EDIT_STEP,
      );

      if (
        instruction.code === null &&
        !instruction.action_tokens.includes('delete')
      ) {
        throw new Error(
          `Instruction code is required for ${inputData.file_path}`,
        );
      }

      const targetChange = instruction.code ?? '';

      await deps.anvilAgentEditService.edit(
        downloadedLocalFilePath,
        targetChange,
        {
          start: instruction.line_range.startRange,
          end: instruction.line_range.endRange,
        },
      );

      const nextState = state.map((item) =>
        item.file_path === inputData.file_path
          ? {
              ...item,
              isEdited: true,
            }
          : item,
      );
      requireFileEditState(nextState, inputData.file_path, APPLY_EDIT_STEP);
      await context.setState(nextState);

      return inputData;
    },
  });

  return applyEditStep;
};

const createGeneratedBackupStep = (deps: EditWorkflowDeps) => {
  const backupStep = createStep({
    id: BACKUP_STEP,
    inputSchema: z.object({ file_path: z.string() }),
    outputSchema: APPLY_EDIT_INPUTS,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    execute: async (context) => {
      const { inputData, requestContext, state } = context;
      const projectId = requestContext.get('projectId');

      if (typeof projectId !== 'string' || !projectId.trim()) {
        throw new Error('Project ID is unavailable for backup step');
      }

      const fileEdit = requireFileEditState(
        state,
        inputData.file_path,
        BACKUP_STEP,
      );

      const backupFilePath = await deps.anvilAgentEditService.createBackupFile(
        projectId,
        inputData.file_path,
      );

      const nextState = state.map((item) =>
        item.file_path === inputData.file_path
          ? {
              ...item,
              backup_file: backupFilePath,
            }
          : item,
      );
      const nextFileEdit = requireFileEditState(
        nextState,
        inputData.file_path,
        BACKUP_STEP,
      );
      requireStateString(
        nextFileEdit.backup_file,
        'backup_file',
        inputData.file_path,
        BACKUP_STEP,
      );
      await context.setState(nextState);

      return fileEdit.instructions.map((instruction) => ({
        file_path: inputData.file_path,
        instruction,
      }));
    },
  });

  return backupStep;
};

const createNestedEditWorkflow = (deps: EditWorkflowDeps) => {
  const nestedEditWorkflow = createWorkflow({
    id: 'anvil-agent-nested-edit-workflow',
    inputSchema: Z_FILE_EDIT,
    outputSchema: Z_FILE_EDIT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
  })
    .then(createDownloadStep(deps))
    .then(createGeneratedBackupStep(deps))
    .foreach(createApplyEditStep(deps))
    .foreach(createVerifyStep())
    // eslint-disable-next-line @typescript-eslint/require-await
    .map(async ({ inputData, state }) => {
      if (inputData.length === 0) {
        throw new Error('No verified instructions available for upload');
      }

      const filePath = inputData[0].file_path;

      if (inputData.some((item) => item.file_path !== filePath)) {
        throw new Error('Upload step received instructions for multiple files');
      }

      const fileEdit = requireFileEditState(state, filePath, UPLOAD_FILE_STEP);
      const downloadedLocalFilePath = requireStateString(
        fileEdit.downloaded_local_file_path,
        'downloaded_local_file_path',
        filePath,
        UPLOAD_FILE_STEP,
      );
      const hash = requireStateString(
        fileEdit.hash,
        'hash',
        filePath,
        UPLOAD_FILE_STEP,
      );

      return {
        localFilePath: downloadedLocalFilePath,
        originalFilePath: fileEdit.file_path,
        originalHash: hash,
      };
    })
    .then(createUploadFileStep(deps))
    // eslint-disable-next-line @typescript-eslint/require-await
    .map(async ({ inputData, state }) => {
      if (!inputData.success || !inputData.file_path) {
        throw new Error('Upload did not produce a file path for cleanup');
      }

      const fileEdit = requireFileEditState(
        state,
        inputData.file_path,
        DELETE_STEP,
      );
      const backupFilePath = requireStateString(
        fileEdit.backup_file,
        'backup_file',
        inputData.file_path,
        DELETE_STEP,
      );
      const downloadedLocalFilePath = requireStateString(
        fileEdit.downloaded_local_file_path,
        'downloaded_local_file_path',
        inputData.file_path,
        DELETE_STEP,
      );

      // TODO: Add workflow lifecycle cleanup for controlled failures before upload completes.
      return {
        file_path: fileEdit.file_path,
        backupFilePath,
        localFilePath: downloadedLocalFilePath,
      };
    })
    .then(createDeleteStep(deps))
    .commit();

  return nestedEditWorkflow;
};

export const createEditWorkflow = (deps: EditWorkflowDeps) => {
  const editWorkflow = createWorkflow({
    id: 'anvil-agent-edit-workflow',
    inputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    outputSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
    stateSchema: Z_EDIT_AGENT_WORKFLOW_INPUT,
  })
    // TODO: Add a parent workflow revert step that restores every touched
    // remote file from backup_file values if any post-backup step fails, then
    // clean local temp files and backups where appropriate.
    .foreach(createNestedEditWorkflow(deps))
    .commit();

  return editWorkflow;
};
