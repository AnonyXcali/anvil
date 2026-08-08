import type {
  FILE_MODIFICATION_TOKENS,
  FILE_OPERATION,
} from 'src/anvil-agent/anvil-agent.types';

export function getEditOperationContractError(input: {
  filePath: string;
  actionTokens: FILE_MODIFICATION_TOKENS[];
  operation: FILE_OPERATION;
  fileExists: boolean;
  code: string | null;
  instructionCount?: number;
}): string | null {
  const hasAdd = input.actionTokens.includes('add');
  const hasCode = input.code !== null && input.code.trim().length > 0;

  if (hasAdd && input.operation !== 'create') {
    return `add requires operation create for ${input.filePath}`;
  }
  if (hasAdd && input.fileExists) {
    return `add requires file_exists false for ${input.filePath}`;
  }
  if (hasAdd && !hasCode) {
    return `add requires non-empty code for ${input.filePath}`;
  }
  if (input.operation === 'create' && !hasAdd) {
    return `operation create requires add for ${input.filePath}`;
  }
  if (
    input.operation === 'create' &&
    (input.actionTokens.length !== 1 || !hasAdd)
  ) {
    return `create requires only the add action token for ${input.filePath}`;
  }
  if (
    input.operation === 'create' &&
    input.instructionCount !== undefined &&
    input.instructionCount !== 1
  ) {
    return `create requires exactly one instruction for ${input.filePath}`;
  }
  if (input.operation === 'delete' && !input.fileExists) {
    return `delete requires file_exists true for ${input.filePath}`;
  }

  return null;
}
