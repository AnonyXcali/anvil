import { Z_FINAL_SHAPE_RESPONSE } from './anvil-agent.types';

const baseFile = {
  file_path: 'src/app/App.tsx',
  file_exists: true,
  precise_instruction: 'Update the application shell.',
  code: 'content',
  patch: null,
  file_type: 'component' as const,
  architectural_role: 'app-shell' as const,
  operation: 'edit' as const,
  depends_on: [],
};

describe('final file-change contract', () => {
  it('rejects a normal edit with the replace_file sentinel range', () => {
    const result = Z_FINAL_SHAPE_RESPONSE.safeParse({
      ...baseFile,
      action_tokens: ['replace'],
      line_range: { startRange: 0, endRange: 0 },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'startRange must be a positive integer',
    );
  });

  it('rejects replace_file with a normal edit range', () => {
    const result = Z_FINAL_SHAPE_RESPONSE.safeParse({
      ...baseFile,
      action_tokens: ['replace_file'],
      line_range: { startRange: 1, endRange: 20 },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'replace_file requires line range 0 to 0',
    );
  });

  it('accepts the valid range for each edit strategy', () => {
    expect(
      Z_FINAL_SHAPE_RESPONSE.safeParse({
        ...baseFile,
        action_tokens: ['replace'],
        line_range: { startRange: 1, endRange: 20 },
      }).success,
    ).toBe(true);

    expect(
      Z_FINAL_SHAPE_RESPONSE.safeParse({
        ...baseFile,
        action_tokens: ['replace_file'],
        line_range: { startRange: 0, endRange: 0 },
      }).success,
    ).toBe(true);

    expect(
      Z_FINAL_SHAPE_RESPONSE.safeParse({
        ...baseFile,
        file_exists: false,
        operation: 'create',
        action_tokens: ['add'],
        line_range: { startRange: 0, endRange: 0 },
      }).success,
    ).toBe(true);
  });

  it('rejects add with an existing-file range', () => {
    const result = Z_FINAL_SHAPE_RESPONSE.safeParse({
      ...baseFile,
      file_exists: false,
      operation: 'create',
      action_tokens: ['add'],
      line_range: { startRange: 1, endRange: 20 },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      'add requires line range 0 to 0',
    );
  });

  it('rejects add with edit operation', () => {
    expect(
      Z_FINAL_SHAPE_RESPONSE.safeParse({
        ...baseFile,
        file_exists: false,
        operation: 'edit',
        action_tokens: ['add'],
        line_range: { startRange: 0, endRange: 0 },
      }).success,
    ).toBe(false);
  });

  it('rejects add with an existing target', () => {
    expect(
      Z_FINAL_SHAPE_RESPONSE.safeParse({
        ...baseFile,
        file_exists: true,
        operation: 'create',
        action_tokens: ['add'],
        line_range: { startRange: 0, endRange: 0 },
      }).success,
    ).toBe(false);
  });

  it('rejects add without content', () => {
    expect(
      Z_FINAL_SHAPE_RESPONSE.safeParse({
        ...baseFile,
        code: '  ',
        file_exists: false,
        operation: 'create',
        action_tokens: ['add'],
        line_range: { startRange: 0, endRange: 0 },
      }).success,
    ).toBe(false);
  });

  it('rejects create without add and delete for a missing file', () => {
    expect(
      Z_FINAL_SHAPE_RESPONSE.safeParse({
        ...baseFile,
        operation: 'create',
        action_tokens: ['replace_file'],
        line_range: { startRange: 0, endRange: 0 },
      }).success,
    ).toBe(false);

    expect(
      Z_FINAL_SHAPE_RESPONSE.safeParse({
        ...baseFile,
        file_exists: false,
        operation: 'delete',
        action_tokens: ['delete'],
        line_range: { startRange: 1, endRange: 20 },
      }).success,
    ).toBe(false);
  });
});
