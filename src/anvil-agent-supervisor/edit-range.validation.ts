import type {
  FILE_MODIFICATION_TOKENS,
  FINAL_RESPONSE_SHAPE,
} from 'src/anvil-agent/anvil-agent.types';

function assertPositiveInteger(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
}

export function validateCompressedFileLineRange(
  filePath: string,
  actionTokens: FILE_MODIFICATION_TOKENS[],
  lineRange: FINAL_RESPONSE_SHAPE['line_range'],
): void {
  const isAdd = actionTokens.includes('add');
  const isPatch = actionTokens.includes('patch');
  const isReplaceFile = actionTokens.includes('replace_file');
  const wholeFileAction = isAdd || isPatch || isReplaceFile;

  if (wholeFileAction) {
    if (
      !Number.isInteger(lineRange.startRange) ||
      !Number.isInteger(lineRange.endRange) ||
      lineRange.startRange !== 0 ||
      lineRange.endRange !== 0
    ) {
      const action = isPatch ? 'patch' : isReplaceFile ? 'replace_file' : 'add';
      throw new Error(`${action} for ${filePath} must use line range 0 to 0`);
    }
  } else {
    assertPositiveInteger(lineRange.startRange, 'startRange');
    assertPositiveInteger(lineRange.endRange, 'endRange');
  }

  if (lineRange.startRange > lineRange.endRange) {
    throw new Error('startRange must be less than or equal to endRange');
  }
}
