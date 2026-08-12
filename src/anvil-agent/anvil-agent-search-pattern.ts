export class InvalidFileSearchPatternError extends Error {
  constructor(
    readonly pattern: string,
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'InvalidFileSearchPatternError';
  }
}

function escapeRegexCharacter(character: string): string {
  return /[\\^$.*+?()[\]|]/.test(character) ? `\\${character}` : character;
}

function assertValidPattern(pattern: string): void {
  if (!pattern.trim()) {
    throw new InvalidFileSearchPatternError(pattern, 'must not be empty');
  }

  if (
    [...pattern].some((character) => {
      const code = character.charCodeAt(0);
      return (code >= 0 && code <= 31) || code === 127;
    })
  ) {
    throw new InvalidFileSearchPatternError(
      pattern,
      'must not contain control characters',
    );
  }

  if (
    pattern.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(pattern) ||
    pattern.split(/[\\/]/).includes('..')
  ) {
    throw new InvalidFileSearchPatternError(
      pattern,
      'must be a project-relative pattern without traversal',
    );
  }

  if (pattern.includes('\\')) {
    throw new InvalidFileSearchPatternError(
      pattern,
      'must use forward slashes and not contain escape characters',
    );
  }

  if (
    pattern.includes('[') ||
    pattern.includes(']') ||
    pattern.includes('{') ||
    pattern.includes('}')
  ) {
    throw new InvalidFileSearchPatternError(
      pattern,
      'contains unsupported glob syntax',
    );
  }
}

function compilePattern(pattern: string): string {
  assertValidPattern(pattern);

  let compiled = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          compiled += '(?:.*/)?';
          index += 2;
        } else {
          compiled += '.*';
          index += 1;
        }
      } else {
        compiled += '[^/]*';
      }
    } else if (character === '?') {
      compiled += '[^/]';
    } else {
      compiled += escapeRegexCharacter(character);
    }
  }

  return compiled;
}

/**
 * Validates file-search keywords and returns one deterministic regex pattern.
 * Plain values are treated as literals; only *, **, and ? have glob meaning.
 */
export function normalizeFileSearchKeywords(
  keywords: readonly string[],
): string {
  if (!keywords.length) {
    throw new InvalidFileSearchPatternError(
      '',
      'must contain at least one keyword',
    );
  }

  return `(?:${keywords.map(compilePattern).join('|')})`;
}
