import type { FILE_EDIT } from './anvil-agent-edit.types';
import { validateAndOrderStagedInput } from './staged-transaction.validation';

const plan = {
  feature_root: 'src/features/catalog',
  phases: [
    {
      id: 'feature' as const,
      file_paths: [
        'src/features/catalog/Card.css',
        'src/features/catalog/Card.tsx',
      ],
    },
  ],
  directories_to_create: ['src/features/catalog'],
  preserve: ['src/app/App.tsx'],
  existing_paths: ['src/app/App.tsx'],
};

function file(filePath: string, depends_on: string[] = []): FILE_EDIT {
  return {
    file_path: filePath,
    downloaded_local_file_path: null,
    backup_file: null,
    instructions: [],
    error: null,
    isEdited: false,
    hash: null,
    file_exists: false,
    file_type: 'component',
    architectural_role: 'feature-component',
    operation: 'create',
    depends_on,
    structure_plan: plan,
  };
}

describe('staged transaction validation', () => {
  it('canonicalizes paths and orders dependencies', () => {
    const ordered = validateAndOrderStagedInput([
      file('./src/features/catalog/Card.tsx', [
        './src/features/catalog/Card.css',
      ]),
      file('src/features/catalog/Card.css'),
    ]);

    expect(ordered.map((entry) => entry.file_path)).toEqual([
      'src/features/catalog/Card.css',
      'src/features/catalog/Card.tsx',
    ]);
  });

  it.each([
    ['duplicate paths', () => [file('src/a.ts'), file('./src/a.ts')]],
    ['missing dependency', () => [file('src/a.ts', ['src/missing.ts'])]],
    [
      'circular dependencies',
      () => [file('src/a.ts', ['src/b.ts']), file('src/b.ts', ['src/a.ts'])],
    ],
  ])('rejects %s', (_label, makeInput) => {
    expect(() => validateAndOrderStagedInput(makeInput())).toThrow();
  });

  it('rejects inconsistent plans and protected deletes', () => {
    const inconsistent = file('src/a.ts');
    inconsistent.structure_plan = { ...plan, feature_root: 'src/other' };
    expect(() =>
      validateAndOrderStagedInput([file('src/b.ts'), inconsistent]),
    ).toThrow('Structural plans are inconsistent');

    const preservedDelete = file('src/app/App.tsx');
    preservedDelete.structure_plan = { ...plan, phases: [] };
    expect(() =>
      validateAndOrderStagedInput([
        { ...preservedDelete, operation: 'delete' },
      ]),
    ).toThrow('Preserved path');
  });
});
