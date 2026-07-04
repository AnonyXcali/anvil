type LineRange = {
  start: number;
  end: number;
};

const RG_EXCLUSIONS = [
  '!node_modules/**',
  '!.git/**',
  '!dist/**',
  '!build/**',
  '!coverage/**',
  '!.next/**',
] as const;

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function validateWorkspacePath(workspacePath: string): void {
  if (!workspacePath.trim()) {
    throw new Error('workspacePath must not be empty');
  }
}

function validateSearchPattern(pattern: string): void {
  if (!pattern.trim()) {
    throw new Error('Search pattern must not be empty');
  }
}

function validateRelativeFilePath(filePath: string): void {
  if (!filePath.trim()) {
    throw new Error('File path must not be empty');
  }

  if (filePath.startsWith('/') || filePath.includes('..')) {
    throw new Error(`Unsafe file path: ${filePath}`);
  }
}

function validateRange(range: LineRange): void {
  if (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 1 ||
    range.end < range.start
  ) {
    throw new Error(`Invalid line range: ${range.start}-${range.end}`);
  }
}

function buildRgExclusionArgs(): string {
  return RG_EXCLUSIONS.map((glob) => `-g ${shellEscape(glob)}`).join(' ');
}

export function buildFileSearchCommand(parameters: {
  workspacePath: string;
  pattern: string;
  caseInsensitive?: boolean;
}): string {
  validateWorkspacePath(parameters.workspacePath);
  validateSearchPattern(parameters.pattern);

  const caseFlag = parameters.caseInsensitive === false ? '' : '-i';

  return [
    `cd -- ${shellEscape(parameters.workspacePath)}`,
    [
      'rg --files',
      buildRgExclusionArgs(),
      '|',
      'rg',
      caseFlag,
      '--',
      shellEscape(parameters.pattern),
    ]
      .filter(Boolean)
      .join(' '),
  ].join(' && ');
}

export function buildContentSearchCommand(parameters: {
  workspacePath: string;
  pattern: string;
  files: readonly string[];
  caseInsensitive?: boolean;
}): string {
  validateWorkspacePath(parameters.workspacePath);
  validateSearchPattern(parameters.pattern);

  if (parameters.files.length <= 0) {
    throw new Error('At least one file path is required for content search');
  }

  parameters.files.forEach(validateRelativeFilePath);

  const caseFlag = parameters.caseInsensitive ? '-i' : '';
  const fileArguments = parameters.files.map(shellEscape).join(' ');

  const command = [
    'rg',
    '-n',
    '--column',
    '--json',
    caseFlag,
    buildRgExclusionArgs(),
    '--',
    shellEscape(parameters.pattern),
    fileArguments,
  ]
    .filter(Boolean)
    .join(' ');

  return `cd -- ${shellEscape(parameters.workspacePath)} && ${command}`;
}

export function buildExpandContextCommand(parameters: {
  workspacePath: string;
  file: string;
  range: LineRange;
}): string {
  validateWorkspacePath(parameters.workspacePath);
  validateRelativeFilePath(parameters.file);
  validateRange(parameters.range);

  const sedExpression = `${parameters.range.start},${parameters.range.end}p`;

  return [
    `cd -- ${shellEscape(parameters.workspacePath)}`,
    `sed -n ${shellEscape(sedExpression)} -- ${shellEscape(parameters.file)}`,
  ].join(' && ');
}
