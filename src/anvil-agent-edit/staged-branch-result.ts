import { Z_FILE_EDIT, type FILE_EDIT } from './anvil-agent-edit.types';

export const STAGED_CREATE_BRANCH_STEP =
  'anvil-agent-staged-create-file-branch-step';
export const STAGED_EXISTING_BRANCH_STEP =
  'anvil-agent-staged-existing-file-branch-step';

const STAGED_CREATE_BRANCH_SUFFIX = 'staged-create-file-branch-step';
const STAGED_EXISTING_BRANCH_SUFFIX = 'staged-existing-file-branch-step';

export function unwrapStagedBranchResult(
  branchResult: unknown,
  filePath?: string,
): FILE_EDIT {
  const fileContext = filePath ? ` for ${filePath}` : '';
  if (typeof branchResult !== 'object' || branchResult === null) {
    throw new Error(
      `Staged file workflow branch did not return a keyed FILE_EDIT result${fileContext}`,
    );
  }

  const keyedResult = branchResult as Record<string, unknown>;
  const branchValues = Object.entries(keyedResult).flatMap(
    ([branchStepId, value]) => {
      const isKnownBranch =
        branchStepId === STAGED_CREATE_BRANCH_STEP ||
        branchStepId === STAGED_EXISTING_BRANCH_STEP ||
        branchStepId.endsWith(STAGED_CREATE_BRANCH_SUFFIX) ||
        branchStepId.endsWith(STAGED_EXISTING_BRANCH_SUFFIX);
      return !isKnownBranch || value === undefined
        ? []
        : [{ branchStepId, value }];
    },
  );

  if (branchValues.length === 0) {
    throw new Error(
      `Staged file workflow branch returned no FILE_EDIT result${fileContext}; received keys: ${
        Object.keys(keyedResult).join(', ') || '(none)'
      }`,
    );
  }

  if (branchValues.length > 1) {
    throw new Error(
      `Staged file workflow returned multiple branch results: ${branchValues
        .map(({ branchStepId }) => branchStepId)
        .join(', ')}`,
    );
  }

  const parsed = Z_FILE_EDIT.safeParse(branchValues[0].value);
  if (!parsed.success) {
    throw new Error(
      `Staged file workflow returned an invalid FILE_EDIT from ${branchValues[0].branchStepId}: ${parsed.error.message}`,
    );
  }

  return parsed.data;
}
