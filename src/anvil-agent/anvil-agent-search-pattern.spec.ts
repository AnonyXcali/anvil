import {
  InvalidFileSearchPatternError,
  normalizeFileSearchKeywords,
} from './anvil-agent-search-pattern';

describe('normalizeFileSearchKeywords', () => {
  it('escapes literal regex characters', () => {
    const pattern = normalizeFileSearchKeywords(['a+b|c.ts']);

    expect(pattern).toBe('(?:a\\+b\\|c\\.ts)');
    expect(new RegExp(pattern).test('a+b|c.ts')).toBe(true);
    expect(new RegExp(pattern).test('aaaabbbbbc.ts')).toBe(false);
  });

  it.each(['*.tsx', '*.ts', '*.css'])('supports %s', (keyword) => {
    const pattern = new RegExp(normalizeFileSearchKeywords([keyword]));

    expect(pattern.test(keyword.replace('*', 'src/App'))).toBe(true);
  });

  it('supports **/ with zero or more directories', () => {
    const pattern = new RegExp(
      `^${normalizeFileSearchKeywords(['src/**/*.ts'])}$`,
    );

    expect(pattern.test('src/App.ts')).toBe(true);
    expect(pattern.test('src/features/App.ts')).toBe(true);
    expect(pattern.test('src/features/App.css')).toBe(false);
  });

  it('supports ? within one path segment', () => {
    const pattern = new RegExp(
      `^${normalizeFileSearchKeywords(['src/App?.ts'])}$`,
    );

    expect(pattern.test('src/App1.ts')).toBe(true);
    expect(pattern.test('src/App12.ts')).toBe(false);
    expect(pattern.test('src/features/App1.ts')).toBe(false);
  });

  it.each([
    ['', 'must not be empty'],
    ['../src/App.ts', 'project-relative pattern'],
    ['/src/App.ts', 'project-relative pattern'],
    ['C:/src/App.ts', 'project-relative pattern'],
    ['src/[A].ts', 'unsupported glob syntax'],
    ['src/{a,b}.ts', 'unsupported glob syntax'],
    ['src\\App.ts', 'forward slashes'],
    ['src/\u0000App.ts', 'control characters'],
  ])('rejects %j', (keyword, reason) => {
    expect(() => normalizeFileSearchKeywords([keyword])).toThrow(
      InvalidFileSearchPatternError,
    );
    expect(() => normalizeFileSearchKeywords([keyword])).toThrow(reason);
  });

  it('produces deterministic output and combines keywords', () => {
    const keywords = ['*.tsx', '*.ts', 'index.html'];

    expect(normalizeFileSearchKeywords(keywords)).toBe(
      normalizeFileSearchKeywords([...keywords]),
    );
    expect(normalizeFileSearchKeywords(keywords)).toBe(
      '(?:[^/]*\\.tsx|[^/]*\\.ts|index\\.html)',
    );
  });
});
