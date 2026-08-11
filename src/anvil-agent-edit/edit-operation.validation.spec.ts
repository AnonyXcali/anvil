import { getEditOperationContractError } from './edit-operation.validation';

const base = {
  filePath: 'src/features/flowers/data/flowers.ts',
  actionTokens: ['add'] as const,
  operation: 'create' as const,
  fileExists: false,
  code: 'export const flowers = [];',
};

describe('edit operation contract', () => {
  it('accepts a valid new-file operation', () => {
    expect(getEditOperationContractError(base)).toBeNull();
  });

  it.each([
    ['add requires operation create', { operation: 'edit' as const }],
    ['add requires file_exists false', { fileExists: true }],
    ['add requires non-empty code', { code: '  ' }],
  ])('rejects %s', (message, override) => {
    expect(getEditOperationContractError({ ...base, ...override })).toContain(
      message,
    );
  });

  it('requires add for create operations', () => {
    expect(
      getEditOperationContractError({
        ...base,
        actionTokens: [],
      }),
    ).toContain('operation create requires add');
  });

  it('allows only the add token for create operations', () => {
    expect(
      getEditOperationContractError({
        ...base,
        actionTokens: ['add', 'replace_file'],
      }),
    ).toContain('create requires only the add action token');
  });

  it('requires one instruction for create operations when provided', () => {
    expect(
      getEditOperationContractError({
        ...base,
        instructionCount: 2,
      }),
    ).toContain('create requires exactly one instruction');
  });

  it('requires existing files for deletes', () => {
    expect(
      getEditOperationContractError({
        ...base,
        actionTokens: ['delete'],
        operation: 'delete',
        fileExists: false,
      }),
    ).toContain('delete requires file_exists true');
  });
});
