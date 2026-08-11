import { unwrapStagedBranchResult } from './staged-branch-result';
import type { FILE_EDIT } from './anvil-agent-edit.types';

const fileEdit: FILE_EDIT = {
  file_path: 'src/features/flowers/FlowerCard.tsx',
  downloaded_local_file_path: '/tmp/FlowerCard.tsx',
  backup_file: null,
  instructions: [
    {
      line_range: { startRange: 1, endRange: 1 },
      action_tokens: ['replace'],
      precise_instruction: 'Update the heading.',
      code: 'const heading = "Flowers";',
      patch: null,
      verified: false,
    },
  ],
  error: null,
  isEdited: false,
  hash: 'original-hash',
  file_exists: true,
  file_type: 'component',
  architectural_role: 'feature-component',
  operation: 'edit',
  depends_on: [],
  structure_plan: {
    feature_root: 'src/features/flowers',
    phases: [],
    directories_to_create: [],
    preserve: [],
    existing_paths: [],
  },
};

describe('staged branch result unwrapping', () => {
  it.each([
    'anvil-agent-staged-create-file-branch-step',
    'anvil-agent-staged-existing-file-branch-step',
    'anvil-edit-agent-staged-existing-file-branch-step',
  ])('unwraps the %s result', (branchStepId) => {
    expect(unwrapStagedBranchResult({ [branchStepId]: fileEdit })).toEqual(
      fileEdit,
    );
  });

  it('rejects a missing branch result', () => {
    expect(() =>
      unwrapStagedBranchResult({}, 'src/features/flowers/FlowerCard.tsx'),
    ).toThrow(
      'returned no FILE_EDIT result for src/features/flowers/FlowerCard.tsx',
    );
  });

  it('rejects multiple branch results', () => {
    expect(() =>
      unwrapStagedBranchResult({
        'anvil-agent-staged-create-file-branch-step': fileEdit,
        'anvil-agent-staged-existing-file-branch-step': fileEdit,
      }),
    ).toThrow('returned multiple branch results');
  });

  it('rejects an invalid selected branch value', () => {
    expect(() =>
      unwrapStagedBranchResult({
        'anvil-agent-staged-existing-file-branch-step': {
          ...fileEdit,
          instructions: undefined,
        },
      }),
    ).toThrow('returned an invalid FILE_EDIT');
  });
});
