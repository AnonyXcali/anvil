export type CssDiagnostic = {
  code:
    | 'unclosed-comment'
    | 'unclosed-string'
    | 'unbalanced-delimiter'
    | 'scss-artifact'
    | 'trailing-content'
    | 'unresolved-selector';
  message: string;
  line: number;
  column: number;
  relatedFilePath?: string;
};

export type CssValidationResult = {
  valid: boolean;
  diagnostics: CssDiagnostic[];
};

export function isCssFilePath(filePath: string): boolean {
  return filePath.trim().toLowerCase().endsWith('.css');
}

function getLocation(
  content: string,
  index: number,
): Pick<CssDiagnostic, 'line' | 'column'> {
  const before = content.slice(0, index);
  const lastNewline = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length,
    column: index - lastNewline,
  };
}

function diagnostic(
  content: string,
  index: number,
  code: CssDiagnostic['code'],
  message: string,
): CssDiagnostic {
  return { code, message, ...getLocation(content, index) };
}

/**
 * Performs a conservative, dependency-free CSS syntax check. It deliberately
 * validates only syntax that is safe to check without a browser: comments,
 * strings, and balanced CSS grouping. Browser/layout checks remain manual.
 */
export function validateCssContent(content: string): CssValidationResult {
  const diagnostics: CssDiagnostic[] = [];
  const delimiters: Array<{ character: string; index: number }> = [];
  let quote: '"' | "'" | null = null;
  let quoteIndex = -1;
  let escaped = false;
  let commentIndex = -1;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (commentIndex >= 0) {
      if (character === '*' && nextCharacter === '/') {
        commentIndex = -1;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '/' && nextCharacter === '*') {
      commentIndex = index;
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      quoteIndex = index;
      continue;
    }

    if (character === '{' || character === '(' || character === '[') {
      delimiters.push({ character, index });
      continue;
    }

    if (character !== '}' && character !== ')' && character !== ']') {
      continue;
    }

    const expected = character === '}' ? '{' : character === ')' ? '(' : '[';
    const opening = delimiters.pop();
    if (!opening || opening.character !== expected) {
      diagnostics.push(
        diagnostic(
          content,
          index,
          'unbalanced-delimiter',
          `Unexpected '${character}'.`,
        ),
      );
    }
  }

  if (commentIndex >= 0) {
    diagnostics.push(
      diagnostic(
        content,
        commentIndex,
        'unclosed-comment',
        'Unterminated CSS comment.',
      ),
    );
  }

  if (quote) {
    diagnostics.push(
      diagnostic(
        content,
        quoteIndex,
        'unclosed-string',
        'Unterminated CSS string.',
      ),
    );
  }

  for (const opening of delimiters.reverse()) {
    diagnostics.push(
      diagnostic(
        content,
        opening.index,
        'unbalanced-delimiter',
        `Unterminated '${opening.character}' block.`,
      ),
    );
  }

  const withoutComments = content.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const lastBlockEnd = withoutComments.lastIndexOf('}');
  if (lastBlockEnd >= 0 && /\S/.test(withoutComments.slice(lastBlockEnd + 1))) {
    const trailingIndex =
      lastBlockEnd +
      1 +
      (withoutComments.slice(lastBlockEnd + 1).search(/\S/) ?? 0);
    diagnostics.push(
      diagnostic(
        content,
        trailingIndex,
        'trailing-content',
        'Non-comment content appears after the final CSS block.',
      ),
    );
  }

  const scssPatterns: Array<[RegExp, string]> = [
    [/^\s*\/\//m, 'SCSS-style line comments are not valid in a CSS file.'],
    [/\$[A-Za-z_-][\w-]*\s*:/, 'SCSS variables are not valid in a CSS file.'],
    [
      /@(?:mixin|include|extend|if|else|for|each|while)\b/,
      'SCSS directives are not valid in a CSS file.',
    ],
    [/&(?:[.:#]|\s*\{)/, 'Nested SCSS selectors are not valid in a CSS file.'],
  ];
  for (const [pattern, message] of scssPatterns) {
    const match = pattern.exec(content);
    if (match && match.index !== undefined) {
      diagnostics.push(
        diagnostic(content, match.index, 'scss-artifact', message),
      );
    }
  }

  return { valid: diagnostics.length === 0, diagnostics };
}

// Short aliases keep the validator convenient for workflow callers and tests.
export const validateCss = validateCssContent;

export type StagedFile = {
  projectFilePath: string;
  localFilePath?: string;
  content: string;
};

export type CssEditValidationResult = {
  applicable: boolean;
  valid: boolean;
  findings: CssDiagnostic[];
};

/** Validates CSS syntax and high-confidence static CSS/TSX selector integration. */
export function validateCssEdit(input: {
  cssFilePath: string;
  cssContent: string;
  stagedFiles?: StagedFile[];
}): CssEditValidationResult {
  if (!isCssFilePath(input.cssFilePath)) {
    return { applicable: false, valid: true, findings: [] };
  }

  const findings = [...validateCssContent(input.cssContent).diagnostics];
  const stagedFiles = input.stagedFiles ?? [];
  const relatedTsx = stagedFiles.filter((file) =>
    /\.(tsx|jsx)$/.test(file.projectFilePath),
  );
  const cssBaseName = input.cssFilePath.split('/').pop() ?? input.cssFilePath;
  const escapedCssBaseName = cssBaseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  for (const file of relatedTsx) {
    const importPattern = new RegExp(
      `(?:import|from)[^;\\n]*['"](?:[^'"]*)${escapedCssBaseName}['"]`,
    );
    if (!importPattern.test(file.content)) {
      continue;
    }

    const staticSelectors = [
      ...Array.from(
        file.content.matchAll(/className\s*=\s*["']([^"'{}`]+)["']/g),
      ).flatMap((match) =>
        match[1]
          .split(/\s+/)
          .filter(Boolean)
          .map((name) => ({ selector: `.${name}`, index: match.index ?? 0 })),
      ),
      ...Array.from(file.content.matchAll(/id\s*=\s*["']([^"'{}`]+)["']/g)).map(
        (match) => ({
          selector: `#${match[1]}`,
          index: match.index ?? 0,
        }),
      ),
    ];
    for (const { selector, index } of staticSelectors) {
      if (
        !new RegExp(
          `(^|[,{\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s,{:.#>+~]|$)`,
          'm',
        ).test(input.cssContent)
      ) {
        findings.push({
          code: 'unresolved-selector',
          message: `Static selector ${selector} used by ${file.projectFilePath} is not defined in ${input.cssFilePath}.`,
          ...getLocation(file.content, index),
          relatedFilePath: file.projectFilePath,
        });
      }
    }
  }

  return { applicable: true, valid: findings.length === 0, findings };
}
