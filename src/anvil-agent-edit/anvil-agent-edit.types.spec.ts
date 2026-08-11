import {
  toInternalEditInput,
  toModelFacingEditInput,
  Z_MODEL_EDIT_AGENT_WORKFLOW_INPUT,
  type EDIT_AGENT_INPUT,
} from './anvil-agent-edit.types';

describe('model edit handoff validation', () => {
  it('rejects an empty edit handoff', () => {
    const result = Z_MODEL_EDIT_AGENT_WORKFLOW_INPUT.safeParse([]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'At least one file edit is required',
      );
    }
  });
});

const structurePlan = {
  feature_root: 'src/features/flowers',
  phases: [
    {
      id: 'feature' as const,
      file_paths: [
        'src/features/flowers/data/flowers.ts',
        'src/features/flowers/components/FlowerCard.tsx',
      ],
    },
  ],
  directories_to_create: ['src/features/flowers'],
  preserve: ['src/main.tsx'],
  existing_paths: ['src/main.tsx'],
};

const internalInput: EDIT_AGENT_INPUT = [
  {
    file_path: 'src/features/flowers/data/flowers.ts',
    downloaded_local_file_path: null,
    backup_file: null,
    instructions: [
      {
        line_range: { startRange: 0, endRange: 0 },
        action_tokens: ['add'],
        precise_instruction: 'Create the flower data module.',
        code: 'export const flowers = [];',
        patch: null,
        verified: false,
      },
    ],
    error: null,
    isEdited: false,
    hash: null,
    file_exists: false,
    file_type: 'component',
    architectural_role: 'feature-component',
    operation: 'create',
    depends_on: [],
    structure_plan: structurePlan,
  },
];

describe('edit payload ownership adapters', () => {
  it('removes runtime fields and structure plan from model-facing input', () => {
    const modelInput = toModelFacingEditInput(internalInput);

    expect(modelInput[0]).toEqual({
      file_path: 'src/features/flowers/data/flowers.ts',
      file_exists: false,
      file_type: 'component',
      architectural_role: 'feature-component',
      operation: 'create',
      depends_on: [],
      instructions: [
        {
          line_range: { startRange: 0, endRange: 0 },
          action_tokens: ['add'],
          precise_instruction: 'Create the flower data module.',
          code: 'export const flowers = [];',
          patch: null,
        },
      ],
    });
  });

  it('injects the canonical plan and initializes runtime fields', () => {
    const modelInput = Z_MODEL_EDIT_AGENT_WORKFLOW_INPUT.parse(
      toModelFacingEditInput(internalInput),
    );

    const reconstructed = toInternalEditInput(modelInput, structurePlan);

    expect(reconstructed[0].structure_plan).toEqual(structurePlan);
    expect(reconstructed[0].downloaded_local_file_path).toBeNull();
    expect(reconstructed[0].backup_file).toBeNull();
    expect(reconstructed[0].hash).toBeNull();
    expect(reconstructed[0].error).toBeNull();
    expect(reconstructed[0].isEdited).toBe(false);
    expect(reconstructed[0].instructions[0].verified).toBe(false);
  });

  it('rejects runtime fields in model file payloads', () => {
    const modelFile = toModelFacingEditInput(internalInput)[0];
    const result = Z_MODEL_EDIT_AGENT_WORKFLOW_INPUT.safeParse([
      { ...modelFile, isEdited: null },
    ]);

    expect(result.success).toBe(false);
  });

  it('rejects runtime fields in model instructions', () => {
    const modelFile = toModelFacingEditInput(internalInput)[0];
    const result = Z_MODEL_EDIT_AGENT_WORKFLOW_INPUT.safeParse([
      {
        ...modelFile,
        instructions: [{ ...modelFile.instructions[0], verified: null }],
      },
    ]);

    expect(result.success).toBe(false);
  });

  it('rejects structure plans in model payloads', () => {
    const modelFile = toModelFacingEditInput(internalInput)[0];
    const result = Z_MODEL_EDIT_AGENT_WORKFLOW_INPUT.safeParse([
      { ...modelFile, structure_plan: structurePlan },
    ]);

    expect(result.success).toBe(false);
  });

  it.each(['add', 'patch', 'replace_file'] as const)(
    'includes the file path for invalid %s whole-file ranges',
    (token) => {
      const modelFile = toModelFacingEditInput(internalInput)[0];
      const result = Z_MODEL_EDIT_AGENT_WORKFLOW_INPUT.safeParse([
        {
          ...modelFile,
          operation: token === 'add' ? 'create' : 'edit',
          file_exists: token === 'add' ? false : true,
          instructions: [
            {
              ...modelFile.instructions[0],
              action_tokens: [token],
              line_range: { startRange: 1, endRange: 1 },
              code: token === 'add' ? modelFile.instructions[0].code : null,
              patch: token === 'patch' ? '--- a/file\n+++ b/file\n' : null,
            },
          ],
        },
      ]);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: [0, 'instructions', 0, 'line_range'],
              message: `${token} for ${modelFile.file_path} must use line range 0 to 0`,
            }),
          ]),
        );
      }
    },
  );
});
