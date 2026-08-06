import {
  isCssFilePath,
  validateCssContent,
  validateCssEdit,
} from './css-validation';

describe('css validation', () => {
  it('recognizes CSS files case-insensitively', () => {
    expect(isCssFilePath('src/App.CSS')).toBe(true);
    expect(isCssFilePath('src/App.tsx')).toBe(false);
  });

  it('accepts balanced CSS with comments and strings', () => {
    expect(
      validateCssContent(`.card { content: "}"; /* { ignored */ color: red; }`),
    ).toEqual({ valid: true, diagnostics: [] });
  });

  it('reports malformed grouping and unterminated strings/comments', () => {
    const result = validateCssContent('.card { content: "oops;');

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      'Unterminated CSS string.',
      "Unterminated '{' block.",
    ]);
  });

  it('reports unexpected closing delimiters with a location', () => {
    const result = validateCssContent('.card }');

    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]).toEqual({
      code: 'unbalanced-delimiter',
      message: "Unexpected '}'.",
      line: 1,
      column: 7,
    });
  });

  it('rejects SCSS artifacts and trailing declarations', () => {
    const result = validateCssContent('.card { color: red; }\nheight: 48px;');

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map(({ code }) => code)).toContain(
      'trailing-content',
    );
    expect(
      validateCssContent('&::before { content: ""; }').diagnostics.map(
        ({ code }) => code,
      ),
    ).toContain('scss-artifact');
  });

  it('checks high-confidence static selectors in imported TSX', () => {
    const result = validateCssEdit({
      cssFilePath: 'src/App.css',
      cssContent: '.card { color: red; }',
      stagedFiles: [
        {
          projectFilePath: 'src/App.tsx',
          content: `import './App.css'; export const App = () => <main className="card missing" />;`,
        },
      ],
    });

    expect(result.valid).toBe(false);
    expect(
      result.findings.some(({ code }) => code === 'unresolved-selector'),
    ).toBe(true);
  });
});
